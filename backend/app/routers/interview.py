import io
import asyncio
import os
import uuid
import json
import anyio
import hashlib
from datetime import datetime, timedelta, timezone

from fastapi import (
    APIRouter,
    UploadFile,
    File,
    Form,
    Depends,
    HTTPException,
    Query,
    Request
)
from fastapi.responses import Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from pypdf import PdfReader

from app.core.config import settings
from app.core.limiter import limiter
from app.services.database import (
    interviews_collection,
    resumes_collection,
    past_interviews_collection
)
from app.services.redis_service import (
    get_json,
    set_json,
    get_bytes,
    set_bytes,
    delete_key
)
from app.services.vector_store import (
    add_resume_chunks_to_vector_store,
    query_resume_context
)
from app.services.interview_graph import (
    interview_graph,
    AIUnavailableError,
    QUESTION_TIME_LIMIT_SECONDS,
    call_gemini_json                  # not used here any more; kept so test/fake-AI scripts can still patch it
)
from app.services.interview_service import (
    advance_interview,
    get_session,
    StateConflictError,
    get_user_past_questions,          # re-exported: routers/websocket.py imports it from here
    get_silence_timeout_for_question
)
from app.services.report_service import (
    agenerate_comprehensive_report,
    generate_comprehensive_report     # sync wrapper, kept for scripts / tests
)

_ORIGINAL_SYNC_REPORT = generate_comprehensive_report


async def _make_report(**kwargs) -> dict:
    if generate_comprehensive_report is not _ORIGINAL_SYNC_REPORT:   # replaced by a test script
        return await run_in_threadpool(lambda: generate_comprehensive_report(**kwargs))
    return await agenerate_comprehensive_report(**kwargs)
from app.services.audio_service import transcribe_audio_file
from app.services.tts_service import generate_tts_audio
from app.services.rabbitmq import rabbitmq_client
from app.core.security import get_current_user, get_current_user_from_token

def extract_docx_text(data: bytes) -> str:
    """Pull readable text out of a .docx (a zip file containing word/document.xml)."""
    import re, zipfile
    from xml.sax.saxutils import unescape
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        xml = z.read("word/document.xml").decode("utf-8", errors="ignore")
    xml = re.sub(r"</w:p>", "\n", xml)
    return unescape(re.sub(r"<[^>]+>", "", xml)).strip()


router = APIRouter(
    prefix="/interviews",
    tags=["Interviews"]
)

DISCONNECT_TIMEOUT_SECONDS = 120  # 2 minutes maximum disconnect wait


MAX_ANSWER_CHARS = 10_000
MAX_ROLE_CHARS = 100
MAX_RESUME_BYTES = 5 * 1024 * 1024
MAX_AUDIO_BYTES = 10 * 1024 * 1024
PROCESSING_LOCK_SECONDS = 240      # longer than the slowest allowed answer (Gemini time limits add up to about 2 minutes)


class InterviewResponseRequest(BaseModel):
    interview_id: str = Field(min_length=1, max_length=100)
    answer: str = Field(max_length=MAX_ANSWER_CHARS)
    duration_seconds: int = Field(default=0, ge=0, le=86_400)
    offline_seconds: int = Field(default=0, ge=0, le=86_400)


class EndInterviewRequest(BaseModel):
    interview_id: str = Field(min_length=1, max_length=100)
    reason: str = Field(default="user_ended", max_length=100)


class DisconnectEventRequest(BaseModel):
    interview_id: str = Field(min_length=1, max_length=100)
    disconnected_at: str | None = None


class ResumeEventRequest(BaseModel):
    interview_id: str = Field(min_length=1, max_length=100)
    offline_seconds: int = Field(default=0, ge=0, le=86_400)


def acquire_answer_lock(interview_id: str, user_id: str) -> bool:
    """Only ONE answer per interview may be processed at a time (double-click, two tabs,
    silence-timer racing a manual submit). A stale lock (crashed worker) expires."""
    now = datetime.now(timezone.utc)
    stale = (now - timedelta(seconds=PROCESSING_LOCK_SECONDS)).isoformat()
    got = interviews_collection.find_one_and_update(
        {"interview_id": interview_id, "user_id": user_id,
         "$or": [{"processing": {"$ne": True}}, {"processing_started_at": {"$lt": stale}}]},
        {"$set": {"processing": True, "processing_started_at": now.isoformat()}},
    )
    return got is not None


def release_answer_lock(interview_id: str) -> None:
    try:
        interviews_collection.update_one({"interview_id": interview_id}, {"$set": {"processing": False}})
    except Exception as e:
        print(f"[Lock Release Warning] {e}")


def finalize_and_score_interview(interview: dict, reason: str = "completed") -> dict:
    history = list(interview.get("history", []))
    answered_q_nums = set()
    for h in history:
        q_num = h.get("question_number")
        if q_num is not None:
            answered_q_nums.add(int(q_num))

    for q_num in range(8):
        if q_num not in answered_q_nums:
            is_intro = (q_num == 0)
            history.append({
                "question_number": q_num,
                "step_type": "intro" if is_intro else "question",
                "question": "Candidate Introduction (Unattempted)" if is_intro else f"Question {q_num} (Unattempted)",
                "prompt": f"Unattempted - Interview Ended ({reason})",
                "answer": f"[Interview ended early: {reason}]",
                "duration_seconds": 0,
                "main_score": 0.0,
                "follow_up_score": None,
                "final_score": 0.0,
                "selected_skill": "",
                "remark": f"Unattempted ({reason})"
            })

    history.sort(key=lambda x: x.get("question_number", 0))

    total_earned = 0.0
    seen_q = set()
    for h in reversed(history):
        q_num = h.get("question_number")
        if q_num not in seen_q and h.get("final_score") is not None:
            total_earned += float(h["final_score"])
            seen_q.add(q_num)

    total_earned = round(total_earned, 2)
    max_possible = 80.0
    percentage = round((total_earned / max_possible) * 100, 2)

    return {
        "history": history,
        "total_earned": total_earned,
        "max_possible": max_possible,
        "percentage": percentage
    }


# ---------------------------------------------------------------------------
# AUDIO TRANSCRIPTION & TTS
# ---------------------------------------------------------------------------
_ALLOWED_AUDIO_EXT = {".webm", ".mp4", ".m4a", ".ogg", ".wav", ".mp3", ".aac"}


def _audio_suffix(upload) -> str:
    """File ending for the temp file, taken only from a SAFE list (phones record mp4, desktops webm)."""
    ext = os.path.splitext((upload.filename or "").lower())[1]
    if ext in _ALLOWED_AUDIO_EXT:
        return ext
    ctype = (upload.content_type or "").lower()
    for key, suffix in (("mp4", ".mp4"), ("mpeg", ".mp3"), ("ogg", ".ogg"), ("wav", ".wav"), ("aac", ".aac")):
        if key in ctype:
            return suffix
    return ".webm"


@router.post("/audio/transcribe")
@limiter.limit("20/minute")
async def transcribe_audio(
    request: Request,
    file: UploadFile = File(...),
    current_user: str = Depends(get_current_user)
):
    contents = await file.read(MAX_AUDIO_BYTES + 1)
    if len(contents) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio file is too large (max 10 MB).")
    if not contents:
        raise HTTPException(status_code=400, detail="Empty audio file.")

    temp_filename = f"temp_{uuid.uuid4().hex}{_audio_suffix(file)}"
    try:
        with open(temp_filename, "wb") as f:
            f.write(contents)

        transcription = await transcribe_audio_file(temp_filename)
        transcription = (transcription or "").strip()
        if not transcription:
            transcription = "[Candidate remained silent]"

        return {"transcription": transcription, "text": transcription}
    except Exception as e:
        # Do NOT pretend the candidate was silent - let the client retry
        print(f"❌ [AUDIO TRANSCRIPTION FAILED]: {e}")
        raise HTTPException(status_code=502, detail="Speech-to-text failed. Please try again.")
    finally:
        if os.path.exists(temp_filename):
            os.remove(temp_filename)


@router.get("/tts")
@limiter.limit("30/minute")
async def get_tts_audio(
    request: Request,
    text: str,
    current_user: str = Depends(get_current_user)
):
    clean_text = (text or "").strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")
    if len(clean_text) > 1000:
        raise HTTPException(status_code=413, detail="Text too long (max 1000 characters).")

    cache_key = f"tts:{hashlib.md5(clean_text.encode('utf-8')).hexdigest()}"
    cached_audio = await get_bytes(cache_key)
    if cached_audio:
        return Response(content=cached_audio, media_type="audio/mpeg")

    try:
        audio_bytes = await run_in_threadpool(generate_tts_audio, clean_text)
        if not audio_bytes:
            raise RuntimeError("TTS returned no audio")
        await set_bytes(cache_key, audio_bytes, expire_seconds=86400)
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        print(f"[TTS Error] {e}")
        raise HTTPException(status_code=500, detail="Failed to synthesize speech.")


# ---------------------------------------------------------------------------
# INTERVIEW LIFECYCLE
# ---------------------------------------------------------------------------
@router.post("/start")
@limiter.limit("5/minute")
async def start_interview(
    request: Request,
    role: str = Form(...),
    difficulty: str = Form("Medium"),
    resume: UploadFile | None = File(None),
    current_user: str = Depends(get_current_user)
):
    role = (role or "").strip()
    if not role:
        raise HTTPException(status_code=400, detail="Role is required.")
    if len(role) > MAX_ROLE_CHARS:
        raise HTTPException(status_code=400, detail=f"Role must be at most {MAX_ROLE_CHARS} characters.")

    text = ""
    if resume and resume.filename:
        contents = await resume.read(MAX_RESUME_BYTES + 1)
        if len(contents) > MAX_RESUME_BYTES:
            raise HTTPException(status_code=413, detail="Resume is too large (max 5 MB).")
        filename_lower = resume.filename.lower()
        if filename_lower.endswith(".pdf"):
            try:
                reader = PdfReader(io.BytesIO(contents))
                text = "".join(page.extract_text() or "" for page in reader.pages)
            except Exception as e:
                print(f"[PDF Resume Error] {e}")
        elif filename_lower.endswith(".docx"):
            try:
                text = extract_docx_text(contents)
            except Exception as e:
                print(f"[DOCX Resume Error] {e}")
        elif filename_lower.endswith(".txt"):
            try:
                text = contents.decode("utf-8", errors="ignore")
            except Exception as e:
                print(f"[Resume Decode Error] {e}")

        if text.strip():
            await set_json(f"resume:{current_user}", text, expire_seconds=86400)
            await run_in_threadpool(resumes_collection.update_one, 
                {"user_id": current_user},
                {"$set": {"resume_text": text}},
                upsert=True
            )
            chunks = [text[i:i + 600] for i in range(0, len(text), 500)]
            try:
                await run_in_threadpool(add_resume_chunks_to_vector_store, current_user, chunks)
            except Exception as e:
                print(f"[Resume Vector Error] {e}")

    if not text.strip():
        cached_resume = await get_json(f"resume:{current_user}")
        if cached_resume:
            text = cached_resume
        else:
            resume_doc = await run_in_threadpool(resumes_collection.find_one, {"user_id": current_user})
            if resume_doc:
                text = resume_doc.get("resume_text", "")
                await set_json(f"resume:{current_user}", text, expire_seconds=86400)

    interview_id = str(uuid.uuid4())
    norm_diff = (difficulty or "medium").lower().strip()
    if norm_diff not in ("easy", "medium", "hard"):
        norm_diff = "medium"

    initial_prompt = (
        f"Welcome to your {role} interview. "
        "Please introduce yourself and provide a brief overview "
        "of your background and qualifications."
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    session_doc = {
        "interview_id": interview_id,
        "user_id": current_user,
        "role": role,
        "difficulty": norm_diff.capitalize(),
        "interview_active": True,
        "completed": False,
        "question_number": 0,
        "step_type": "intro",
        "current_prompt": initial_prompt,
        "current_main_score": 0.0,
        "current_follow_up_score": 0.0,
        "current_rating": "",
        "selected_skill": "",
        "history": [],
        "question_started_at": now_iso,
        "accumulated_pause_seconds": 0,
        "disconnect_started_at": None,
        "max_time_limit_seconds": QUESTION_TIME_LIMIT_SECONDS,
        "silence_timeout_seconds": get_silence_timeout_for_question(0),
        "created_at": now_iso
    }

    await run_in_threadpool(interviews_collection.insert_one, session_doc)
    session_doc.pop("_id", None)
    await set_json(f"session:{interview_id}", session_doc, expire_seconds=7200)

    return {
        "interview_id": interview_id,
        "id": interview_id,
        "initial_prompt": initial_prompt,
        "current_prompt": initial_prompt,
        "question_number": 0,
        "step_type": "intro",
        "role": role,
        "difficulty": norm_diff.capitalize(),
        "max_time_limit_seconds": QUESTION_TIME_LIMIT_SECONDS,
        "silence_timeout_seconds": get_silence_timeout_for_question(0),
        "disconnect_timeout_seconds": DISCONNECT_TIMEOUT_SECONDS
    }


@router.get("/current/{interview_id}")
async def get_current_interview(
    interview_id: str,
    current_user: str = Depends(get_current_user)
):
    cached = await get_json(f"session:{interview_id}")
    if cached and cached.get("user_id") == current_user:
        q_num = cached.get("question_number", 0)
        cached["silence_timeout_seconds"] = get_silence_timeout_for_question(q_num)
        cached["max_time_limit_seconds"] = QUESTION_TIME_LIMIT_SECONDS
        cached["disconnect_timeout_seconds"] = DISCONNECT_TIMEOUT_SECONDS
        return cached

    interview = await run_in_threadpool(interviews_collection.find_one, {
        "interview_id": interview_id,
        "user_id": current_user
    })

    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found.")

    q_num = interview.get("question_number", 0)
    response_data = {
        "interview_id": interview.get("interview_id", interview_id),
        "user_id": current_user,
        "current_prompt": interview.get("current_prompt", ""),
        "question_number": q_num,
        "step_type": interview.get("step_type", "intro"),
        "interview_active": interview.get("interview_active", True),
        "completed": interview.get("completed", False),
        "role": interview.get("role", ""),
        "difficulty": interview.get("difficulty", "Medium"),
        "current_main_score": interview.get("current_main_score", 0.0),
        "current_follow_up_score": interview.get("current_follow_up_score", 0.0),
        "current_rating": interview.get("current_rating", ""),
        "selected_skill": interview.get("selected_skill", ""),
        "history": interview.get("history", []),
        "question_started_at": interview.get("question_started_at"),
        "accumulated_pause_seconds": interview.get("accumulated_pause_seconds", 0),
        "disconnect_started_at": interview.get("disconnect_started_at"),
        "max_time_limit_seconds": QUESTION_TIME_LIMIT_SECONDS,
        "silence_timeout_seconds": get_silence_timeout_for_question(q_num),
        "disconnect_timeout_seconds": DISCONNECT_TIMEOUT_SECONDS
    }
    await set_json(f"session:{interview_id}", response_data, expire_seconds=7200)
    return response_data


# ---------------------------------------------------------------------------
# NETWORK DISCONNECT & RECONNECT (2-MINUTE WINDOW)
# ---------------------------------------------------------------------------
async def get_current_user_header_or_query(request: Request) -> str:
    """Authorization header normally; ?token= for navigator.sendBeacon (it cannot set headers)."""
    auth_header = request.headers.get("authorization", "")
    token = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else request.query_params.get("token", "")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return get_current_user_from_token(token)


@router.post("/disconnect-event")
async def report_disconnect_event(
    request: Request,
    current_user: str = Depends(get_current_user_header_or_query)
):
    body = await request.body()
    try:
        data = json.loads(body.decode("utf-8")) if body else {}
    except Exception:
        data = {}

    interview_id = data.get("interview_id") if isinstance(data, dict) else None
    if not isinstance(interview_id, str) or not interview_id or len(interview_id) > 100:
        return {"status": "ignored"}  # also blocks NoSQL operator injection like {"$ne": null}

    interview = await get_json(f"session:{interview_id}")
    if not interview or interview.get("user_id") != current_user:
        interview = await run_in_threadpool(interviews_collection.find_one, {
            "interview_id": interview_id,
            "user_id": current_user
        })

    if not interview or not interview.get("interview_active", True):
        return {"status": "ignored"}

    now_iso = datetime.now(timezone.utc).isoformat()
    interview["disconnect_started_at"] = now_iso
    await set_json(f"session:{interview_id}", interview, expire_seconds=7200)
    await run_in_threadpool(interviews_collection.update_one, 
        {"interview_id": interview_id, "user_id": current_user},
        {"$set": {"disconnect_started_at": now_iso}}
    )
    return {"status": "disconnect_recorded", "timestamp": now_iso}


@router.post("/resume-connection")
async def resume_connection(
    payload: ResumeEventRequest,
    current_user: str = Depends(get_current_user)
):
    interview = await get_json(f"session:{payload.interview_id}")
    if not interview or interview.get("user_id") != current_user:
        interview = await run_in_threadpool(interviews_collection.find_one, {
            "interview_id": payload.interview_id,
            "user_id": current_user
        })

    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found.")

    if not interview.get("interview_active", True):
        return {
            "status": "interview_ended",
            "interview_complete": True,
            "message": "Interview is already finalized."
        }

    now = datetime.now(timezone.utc)
    disconnect_str = interview.get("disconnect_started_at")
    server_offline_seconds = 0
    if disconnect_str:
        try:
            d_time = datetime.fromisoformat(disconnect_str)
            server_offline_seconds = int((now - d_time).total_seconds())
        except Exception:
            pass

    actual_offline_seconds = max(payload.offline_seconds, server_offline_seconds)

    if actual_offline_seconds > DISCONNECT_TIMEOUT_SECONDS:
        final_data = finalize_and_score_interview(interview, reason="Network Disconnected > 2 Minutes")
        now_iso = now.isoformat()

        summary_doc = {
            "interview_id": payload.interview_id,
            "user_id": current_user,
            "role": interview.get("role", "Candidate"),
            "difficulty": interview.get("difficulty", "Medium"),
            "total_score": final_data["total_earned"],
            "total_earned": final_data["total_earned"],
            "max_score": 80,
            "max_possible_score": final_data["max_possible"],
            "score_display": f"{final_data['total_earned']} / 80",
            "percentage": final_data["percentage"],
            "rating": "Evaluated",
            "completed": True,
            "interview_active": False,
            "disconnect_timeout": True,
            "history": final_data["history"],
            "completed_at": now_iso
        }
        await run_in_threadpool(past_interviews_collection.update_one, 
            {"interview_id": payload.interview_id, "user_id": current_user},
            {"$set": summary_doc},
            upsert=True
        )

        try:
            await rabbitmq_client.publish_task(
                queue_name=settings.REPORT_QUEUE_NAME,
                payload={**summary_doc, "completed_early": True}
            )
        except Exception as q_err:
            print(f"[RabbitMQ Disconnect Publish Warning]: {q_err}")

        await delete_key(f"session:{payload.interview_id}")

        await run_in_threadpool(interviews_collection.update_one, 
            {"interview_id": payload.interview_id, "user_id": current_user},
            {
                "$set": {
                    "interview_active": False,
                    "step_type": "complete",
                    "completed": True,
                    "total_earned": final_data["total_earned"],
                    "percentage": final_data["percentage"],
                    "history": final_data["history"],
                    "disconnect_timeout": True,
                    "completed_at": now_iso
                }
            }
        )

        return {
            "status": "interview_ended",
            "interview_complete": True,
            "offline_seconds": actual_offline_seconds,
            "message": "Reconnection window of 2 minutes expired. Interview ended."
        }

    current_acc_pause = int(interview.get("accumulated_pause_seconds") or 0)
    new_acc_pause = current_acc_pause + actual_offline_seconds

    interview["accumulated_pause_seconds"] = new_acc_pause
    interview["disconnect_started_at"] = None

    await set_json(f"session:{payload.interview_id}", interview, expire_seconds=7200)
    await run_in_threadpool(interviews_collection.update_one, 
        {"interview_id": payload.interview_id},
        {
            "$set": {
                "accumulated_pause_seconds": new_acc_pause,
                "disconnect_started_at": None
            }
        }
    )

    return {
        "status": "resumed",
        "interview_complete": False,
        "offline_seconds": actual_offline_seconds,
        "accumulated_pause_seconds": new_acc_pause,
        "message": "Successfully reconnected. Timer resumed."
    }


# ---------------------------------------------------------------------------
# RESPOND INTERVIEW
# ---------------------------------------------------------------------------
@router.post("/respond")
@limiter.limit("20/minute")
async def respond_interview(
    request: Request,
    payload: InterviewResponseRequest,
    current_user: str = Depends(get_current_user)
):
    got_lock = False
    try:
        # Taking the lock is shielded: if the client disconnects at this very moment the thread still takes the
        # lock, so we must also be sure to see that result and release it below (it used to leak here).
        with anyio.CancelScope(shield=True):
            got_lock = await run_in_threadpool(acquire_answer_lock, payload.interview_id, current_user)
        if not got_lock:
            exists = await run_in_threadpool(interviews_collection.find_one,
                {"interview_id": payload.interview_id, "user_id": current_user}, {"_id": 1})
            if not exists:
                raise HTTPException(status_code=404, detail="Active interview session not found.")
            raise HTTPException(status_code=409, detail="Your previous answer is still being processed.")
        return await _respond_interview_impl(request, payload, current_user)
    finally:
        if got_lock:
            with anyio.CancelScope(shield=True):          # a timed-out / disconnected client must not leave the lock stuck
                await run_in_threadpool(release_answer_lock, payload.interview_id)


async def _respond_interview_impl(
    request: Request,
    payload: InterviewResponseRequest,
    current_user: str
):
    interview = await get_session(payload.interview_id, current_user, authoritative=True)

    if not interview:
        raise HTTPException(status_code=404, detail="Active interview session not found.")

    if not interview.get("interview_active", True):
        raise HTTPException(status_code=400, detail="This interview session is already completed.")

    try:
        result = await advance_interview(
            interview,
            payload.interview_id,
            current_user,
            payload.answer,
            payload.duration_seconds,
            graph=interview_graph
        )
    except StateConflictError:
        raise HTTPException(
            status_code=409,
            detail="This answer was already processed. Please reload the interview to continue."
        )
    except AIUnavailableError:
        # Nothing was saved: the same answer can simply be submitted again.
        raise HTTPException(
            status_code=503,
            detail="The interviewer is busy right now. Your answer was not lost - please press Retry.",
            headers={"Retry-After": "10"}
        )

    result.pop("session", None)
    return result


# ---------------------------------------------------------------------------
# END INTERVIEW
# ---------------------------------------------------------------------------
@router.post("/end")
async def end_interview(
    payload: EndInterviewRequest,
    current_user: str = Depends(get_current_user)
):
    interview = await get_json(f"session:{payload.interview_id}")
    if not interview or interview.get("user_id") != current_user:
        interview = await run_in_threadpool(interviews_collection.find_one, {
            "interview_id": payload.interview_id,
            "user_id": current_user
        })

    if not interview:
        raise HTTPException(status_code=404, detail="Interview session not found.")

    if not interview.get("interview_active", True) or interview.get("completed", False):
        return {
            "status": "already_completed",
            "message": "This interview is already completed.",
            "interview_id": payload.interview_id
        }

    role = interview.get("role", "Candidate")
    difficulty = interview.get("difficulty", "Medium")
    final_data = finalize_and_score_interview(interview, reason="Candidate Ended Early")
    now_iso = datetime.now(timezone.utc).isoformat()

    summary_doc = {
        "interview_id": payload.interview_id,
        "user_id": current_user,
        "role": role,
        "difficulty": difficulty,
        "total_score": final_data["total_earned"],
        "total_earned": final_data["total_earned"],
        "max_score": 80,
        "max_possible_score": final_data["max_possible"],
        "score_display": f"{final_data['total_earned']} / 80",
        "percentage": final_data["percentage"],
        "rating": "Evaluated",
        "completed": True,
        "interview_active": False,
        "completed_early": True,
        "history": final_data["history"],
        "completed_at": now_iso
    }
    await run_in_threadpool(past_interviews_collection.update_one, 
        {"interview_id": payload.interview_id, "user_id": current_user},
        {"$set": summary_doc},
        upsert=True
    )

    try:
        await rabbitmq_client.publish_task(
            queue_name=settings.REPORT_QUEUE_NAME,
            payload={**summary_doc, "completed_early": True}
        )
    except Exception as q_err:
        print(f"[RabbitMQ Publish Warning]: {q_err}")

    await delete_key(f"session:{payload.interview_id}")

    await run_in_threadpool(interviews_collection.update_one, 
        {"interview_id": payload.interview_id, "user_id": current_user},
        {
            "$set": {
                "interview_active": False,
                "step_type": "complete",
                "completed": True,
                "total_earned": final_data["total_earned"],
                "percentage": final_data["percentage"],
                "history": final_data["history"],
                "completed_at": now_iso
            }
        }
    )

    return {
        "status": "success",
        "interview_complete": True,
        "interview_id": payload.interview_id,
        "total_earned": final_data["total_earned"],
        "max_score": 80,
        "percentage": final_data["percentage"],
        "message": "Interview ended early by user. Remaining questions scored as 0."
    }


# ---------------------------------------------------------------------------
# HISTORY: STRICT ISOLATION (NO ONGOING INTERVIEWS EVER SHOWN)
# ---------------------------------------------------------------------------
@router.get("/history")
async def get_interview_history(
    limit: int = Query(100, ge=1, le=200),
    skip: int = Query(0, ge=0),
    current_user: str = Depends(get_current_user)
):
    # Only return completed interviews where interview_active is False
    def _query():
        return list(
            past_interviews_collection.find(
                {
                    "user_id": current_user,
                    "completed": True,
                    "interview_active": {"$ne": True}
                },
                {"_id": 0}
            ).sort("completed_at", -1).skip(skip).limit(limit)
        )
    records = await run_in_threadpool(_query)      # never block the event loop on a (remote) database

    return {
        "status": "success",
        "interviews": records
    }


# ---------------------------------------------------------------------------
# REPORT ENDPOINT
# ---------------------------------------------------------------------------

def apply_awarded_marks(report: dict) -> dict:
    """Single source of truth: the marks shown in a report are ALWAYS the marks awarded during the interview,
    whoever (this API, the background worker, an older cached copy) produced the report."""
    history = report.get("history") or []
    if not history:
        return report
    awarded = {}
    for h in sorted(history, key=lambda x: int(x.get("question_number", 0) or 0)):
        try:
            qn = int(h.get("question_number"))
        except (TypeError, ValueError):
            continue
        val = h.get("final_score")
        if val is None:
            val = h.get("main_score", 0.0)
        awarded[qn] = round(float(val or 0.0), 2)
    for key in ("questions", "questions_analysis"):
        for item in report.get(key) or []:
            try:
                qn = int(item.get("question_number"))
            except (TypeError, ValueError):
                continue
            if qn in awarded:
                item["score"] = awarded[qn]
    return report

# one report generation per interview at a time; shared by every request that asks for it
REPORT_TASKS: dict = {}
REPORT_WAIT_SECONDS = float(os.getenv("REPORT_WAIT_SECONDS", "25"))


@router.get("/report/{interview_id}")
async def get_full_interview_report(
    interview_id: str,
    current_user: str = Depends(get_current_user)
):
    cache_key = f"report:{interview_id}"
    cached_report = await get_json(cache_key)

    if (
        cached_report
        and cached_report.get("user_id") == current_user
        and (cached_report.get("questions") or cached_report.get("questions_analysis"))
    ):
        return {"status": "success", "report": apply_awarded_marks(cached_report)}

    report = await run_in_threadpool(past_interviews_collection.find_one, 
        {"interview_id": interview_id, "user_id": current_user},
        {"_id": 0}
    )

    if report and (report.get("questions") or report.get("questions_analysis")):
        apply_awarded_marks(report)
        await set_json(cache_key, report, expire_seconds=86400)
        return {"status": "success", "report": report}

    session_doc = report or await run_in_threadpool(interviews_collection.find_one, 
        {"interview_id": interview_id, "user_id": current_user},
        {"_id": 0}
    )

    if not session_doc:
        raise HTTPException(status_code=404, detail="Interview session not found.")

    if session_doc.get("interview_active", False) and not session_doc.get("completed", False):
        raise HTTPException(status_code=409, detail="Interview is still in progress.")

    history = session_doc.get("history", [])
    if not history:
        return {
            "status": "processing",
            "message": "Your report is currently being analyzed by AI. Please wait a few moments..."
        }

    task = REPORT_TASKS.get(interview_id)
    if task is None or (task.done() and task.exception() is not None):
        task = asyncio.create_task(_build_and_store_report(interview_id, current_user, session_doc, history))
        REPORT_TASKS[interview_id] = task
    try:
        # Wait for fast cases, but never hold the browser request for minutes (proxies cut at ~60 s).
        report_doc = await asyncio.wait_for(asyncio.shield(task), timeout=REPORT_WAIT_SECONDS)
    except asyncio.TimeoutError:
        return {
            "status": "processing",
            "message": "Your report is being prepared by the AI. This page will refresh by itself..."
        }
    except Exception as gen_err:
        print(f"[Direct Report Evaluation Error]: {gen_err}")
        REPORT_TASKS.pop(interview_id, None)
        return {
            "status": "processing",
            "message": "Report generation in progress. Please refresh in a few seconds."
        }
    REPORT_TASKS.pop(interview_id, None)
    await set_json(f"report:{interview_id}", report_doc, expire_seconds=86400)
    return {"status": "success", "report": report_doc}


async def _build_and_store_report(interview_id: str, current_user: str, session_doc: dict, history: list) -> dict:
    total_earned = float(session_doc.get("total_earned") or session_doc.get("total_score") or 0.0)
    percentage = float(session_doc.get("percentage") or round((total_earned / 80.0) * 100, 2))
    role = session_doc.get("role", "Software Engineer")
    difficulty = session_doc.get("difficulty", "Medium")

    evaluated = await _make_report(
        role=role,
        difficulty=difficulty,
        history=history,
        total_score=total_earned,
        percentage=percentage
    )
    analysis_items = evaluated.get("questions_analysis", [])
    for item in analysis_items:
        if "answer" not in item and "candidate_answer" in item:
            item["answer"] = item["candidate_answer"]
        elif "candidate_answer" not in item and "answer" in item:
            item["candidate_answer"] = item["answer"]

    report_doc = {
        **session_doc,
        "interview_id": interview_id,
        "user_id": current_user,
        "role": role,
        "difficulty": difficulty,
        "total_score": total_earned,
        "total_earned": total_earned,
        "max_score": 80,
        "max_possible_score": 80.0,
        "score_display": f"{total_earned} / 80",
        "percentage": percentage,
        "rating": evaluated.get("rating", "Good"),
        "summary": evaluated.get("summary", ""),
        "strengths": evaluated.get("strengths", []),
        "areas_for_improvement": evaluated.get("areas_for_improvement", []),
        "questions": analysis_items,
        "questions_analysis": analysis_items,
        "history": history,
        "completed": True,
        "interview_active": False,
        "completed_at": session_doc.get("completed_at", datetime.now(timezone.utc).isoformat())
    }
    apply_awarded_marks(report_doc)
    await run_in_threadpool(
        past_interviews_collection.update_one,
        {"interview_id": interview_id, "user_id": current_user},
        {"$set": report_doc},
        upsert=True
    )
    return report_doc