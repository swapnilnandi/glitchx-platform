import base64
import logging
import time

import anyio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from fastapi.concurrency import run_in_threadpool

from app.routers.interview import acquire_answer_lock, release_answer_lock, get_user_past_questions  # noqa: F401 (re-export for tests)
from app.core.security import get_current_user_from_token
from app.services.database import interviews_collection
from app.services.redis_service import get_json, set_json
from app.services.interview_graph import interview_graph, AIUnavailableError
from app.services.interview_service import advance_interview, get_session, StateConflictError
from app.services.tts_service import generate_cached_tts_audio

logger = logging.getLogger("uvicorn.error")
router = APIRouter(tags=["WebSocket"])

MIN_SUBMIT_INTERVAL_SECONDS = 1.5


@router.websocket("/ws/interview/{interview_id}")
async def interview_websocket(websocket: WebSocket, interview_id: str):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Missing token")
        return

    try:
        current_user = get_current_user_from_token(token)
    except Exception as err:
        logger.warning(f"[WS Auth Failed] Session {interview_id}: {err}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token")
        return

    session_key = f"session:{interview_id}"
    interview = await get_json(session_key)

    if not interview or interview.get("user_id") != current_user:
        interview = await run_in_threadpool(interviews_collection.find_one, {
            "interview_id": interview_id,
            "user_id": current_user
        })
        if interview:
            interview.pop("_id", None)
            await set_json(session_key, interview, expire_seconds=7200)

    if not interview or not interview.get("interview_active", True):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Interview not found or already completed")
        return

    await websocket.accept()
    logger.info(f"[WS Connected] User {current_user} joined session {interview_id}")

    role = interview.get("role", "Candidate")

    last_submit_time = 0.0
    is_processing = False
    lock_held = False

    await websocket.send_json({
        "type": "connected",
        "interview_id": interview_id,
        "role": role,
        "question_number": interview.get("question_number", 0),
        "step_type": interview.get("step_type", "intro")
    })

    try:
        while True:
            data = await websocket.receive_json()
            if not isinstance(data, dict):
                continue
            action = data.get("action") or data.get("type")

            if action in ("submit_answer", "answer"):
                now = time.time()

                if is_processing:
                    await websocket.send_json({
                        "type": "warning",
                        "message": "Evaluation currently in progress. Please wait."
                    })
                    continue

                if (now - last_submit_time) < MIN_SUBMIT_INTERVAL_SECONDS:
                    await websocket.send_json({
                        "type": "warning",
                        "message": "Submitting too fast. Please take a breath."
                    })
                    continue

                is_processing = True
                last_submit_time = now
                step_message = None

                try:
                    with anyio.CancelScope(shield=True):             # never lose track of a lock we just took
                        lock_held = await run_in_threadpool(acquire_answer_lock, interview_id, current_user)
                    if not lock_held:
                        await websocket.send_json({
                            "type": "warning",
                            "message": "Your previous answer is still being processed."
                        })
                        continue

                    await websocket.send_json({"type": "evaluating"})

                    try:
                        duration_seconds = max(0, min(int(data.get("duration_seconds") or 0), 86_400))
                    except (TypeError, ValueError):
                        duration_seconds = 0
                    answer_text = str(data.get("answer") or "").strip()[:10_000]

                    # Always work on the LATEST stored state (another tab / the HTTP API may have moved on)
                    interview = await get_session(interview_id, current_user, authoritative=True)
                    if not interview or not interview.get("interview_active", True):
                        await websocket.send_json({
                            "type": "error",
                            "message": "This interview is no longer active."
                        })
                        continue

                    try:
                        result = await advance_interview(
                            interview, interview_id, current_user, answer_text, duration_seconds,
                            graph=interview_graph
                        )
                    except StateConflictError:
                        await websocket.send_json({
                            "type": "error",
                            "message": "This answer was already processed. Please reload the interview to continue."
                        })
                        continue
                    except AIUnavailableError:
                        await websocket.send_json({
                            "type": "error",
                            "message": "The interviewer is busy right now. Your answer was not lost - press Retry."
                        })
                        continue

                    audio_base64 = None
                    try:
                        if result["next_prompt"]:
                            audio_bytes = await generate_cached_tts_audio(result["next_prompt"])
                            if audio_bytes:
                                audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
                    except Exception as tts_err:
                        logger.warning(f"[TTS Audio Error]: {tts_err}")

                    step_message = {
                        "type": "interview_step",
                        "interview_id": interview_id,
                        "question_number": result["question_number"],
                        "step_type": result["step_type"],
                        "next_prompt": result["next_prompt"],
                        "current_prompt": result["next_prompt"],
                        "next_question": result["next_prompt"],
                        "remark": result["remark"],
                        "score": result["score"],
                        "main_score": result["main_score"],
                        "follow_up_score": result["follow_up_score"],
                        "interview_complete": result["interview_complete"],
                        "time_limit_exceeded": result["time_limit_exceeded"],
                        "audio_base64": audio_base64
                    }
                except WebSocketDisconnect:
                    raise
                except Exception as e:
                    # One failed answer must not kill the whole interview connection
                    logger.error(f"[WS Answer Error] Session {interview_id}: {e}", exc_info=True)
                    await websocket.send_json({
                        "type": "error",
                        "message": "Server error while processing your answer. Please press Retry."
                    })
                finally:
                    if lock_held:
                        with anyio.CancelScope(shield=True):
                            await run_in_threadpool(release_answer_lock, interview_id)
                        lock_held = False
                    is_processing = False

                # Tell the browser LAST: the new state is saved and the lock is free.
                if step_message is not None:
                    await websocket.send_json(step_message)

            elif action == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        logger.info(f"[WS Disconnected] Session {interview_id}")
    except Exception as e:
        logger.error(f"[WS Error] Session {interview_id}: {e}", exc_info=True)
        try:
            await websocket.send_json({"type": "error", "message": "Server error. Please try again."})
        except Exception:
            pass
    finally:
        if lock_held:
            with anyio.CancelScope(shield=True):
                await run_in_threadpool(release_answer_lock, interview_id)