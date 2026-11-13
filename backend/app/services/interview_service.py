"""Shared interview-turn logic (was duplicated in routers/websocket.py and routers/interview.py).

advance_interview() takes the stored session + the candidate's answer, runs the LangGraph
(evaluate -> follow-up / next question / finish), saves everything and returns the result.
It does NOT touch the per-interview answer lock - the caller owns that.
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import anyio
from fastapi.concurrency import run_in_threadpool

from app.core.config import settings
from app.services.database import (
    interviews_collection,
    resumes_collection,
    past_interviews_collection
)
from app.services.redis_service import get_json, set_json, delete_key
from app.services.vector_store import query_resume_context
from app.services.interview_graph import (
    interview_graph,
    InterviewGraphState,
    QUESTION_TIME_LIMIT_SECONDS
)
from app.services.rabbitmq import rabbitmq_client

logger = logging.getLogger("uvicorn.error")

MAX_POSSIBLE_SCORE = 80.0


class StateConflictError(Exception):
    """The interview changed (another tab / a retried request answered it) after we read it. Nothing was saved."""


def get_silence_timeout_for_question(question_number: int) -> int:
    return 30 if question_number >= 7 else 10


def _is_real_question(q: str) -> bool:
    low = (q or "").strip().lower()
    return bool(low) and not low.startswith(("welcome", "candidate intro")) and "(unattempted)" not in low


def get_user_past_questions(user_id: str) -> list:
    past_questions = set()
    try:
        records = past_interviews_collection.find(
            {"user_id": user_id},
            {"history": 1, "questions": 1, "questions_analysis": 1}
        )
        for doc in records:
            for item in doc.get("history", []):
                q = (item.get("question") or item.get("prompt") or "").strip()
                if _is_real_question(q):
                    past_questions.add(q)
            for item in doc.get("questions", []) or doc.get("questions_analysis", []):
                q = (item.get("question") or "").strip()
                if _is_real_question(q):
                    past_questions.add(q)
    except Exception as e:
        print(f"[Past Questions Lookup Warning]: {e}")
    return list(past_questions)


def build_rag_query(role: str, question: str, answer: str, is_silent: bool) -> str:
    """Search text for the resume lookup: the role + what was just asked + what the candidate just said."""
    parts = [f"{role} candidate experience, projects, responsibilities, achievements, challenges and skills"]
    if question:
        parts.append(f"Related to this interview question: {question[:200]}")
    if answer and not is_silent:
        parts.append(f"Candidate just said: {answer[:300]}")
    return ". ".join(parts)


async def get_session(interview_id: str, user_id: str, authoritative: bool = False) -> Optional[Dict[str, Any]]:
    """The stored interview.

    authoritative=False : Redis cache first (fast; fine for read-only screens).
    authoritative=True  : MongoDB first. Use this whenever the result will be CHANGED and saved: the Redis copy can be
                          behind MongoDB (a failed or skipped cache write), and answering from an old copy loses answers.
    """
    if not authoritative:
        cached = await get_json(f"session:{interview_id}")
        if cached and cached.get("user_id") == user_id:
            return cached
    session = await run_in_threadpool(interviews_collection.find_one, {
        "interview_id": interview_id,
        "user_id": user_id
    })
    if session:
        session.pop("_id", None)
        return session
    if authoritative:                      # not in MongoDB at all: last resort, the cache
        cached = await get_json(f"session:{interview_id}")
        if cached and cached.get("user_id") == user_id:
            return cached
    return None


async def get_resume_text(user_id: str) -> str:
    cached = await get_json(f"resume:{user_id}")
    if cached:
        return cached
    doc = await run_in_threadpool(resumes_collection.find_one, {"user_id": user_id}) or {}
    text = doc.get("resume_text", "")
    await set_json(f"resume:{user_id}", text, expire_seconds=86400)
    return text


async def advance_interview(
    interview: Dict[str, Any],
    interview_id: str,
    user_id: str,
    answer: str,
    client_duration_seconds: int = 0,
    graph=None
) -> Dict[str, Any]:
    """Raises AIUnavailableError (nothing saved) when the answer could not be marked.

    `graph` defaults to the compiled LangGraph; the routers pass their own reference so tests can swap it.
    """
    current_step = interview.get("step_type", "intro")
    current_q = int(interview.get("question_number", 0))
    current_prompt = interview.get("current_prompt", "")
    role = interview.get("role", "Candidate")
    difficulty = interview.get("difficulty", "Medium")
    previous_history = interview.get("history", [])

    candidate_answer = (answer or "").strip()
    is_silent = (not candidate_answer or candidate_answer.lower().startswith("[candidate remained silent"))
    if is_silent:
        candidate_answer = "[Candidate remained silent]"

    # Server-side clock: never trust the client's duration alone
    duration = int(client_duration_seconds or 0)
    started_at_str = interview.get("question_started_at")
    if started_at_str:
        try:
            started_at = datetime.fromisoformat(started_at_str)
            raw_elapsed = int((datetime.now(timezone.utc) - started_at).total_seconds())
            paused = int(interview.get("accumulated_pause_seconds") or 0)
            duration = max(duration, max(0, raw_elapsed - paused))
        except Exception:
            pass

    full_resume = await get_resume_text(user_id)
    if current_q == 5 or (current_q == 6 and current_step == "question"):
        targeted = await run_in_threadpool(
            query_resume_context,
            user_id=user_id,
            query=build_rag_query(role, current_prompt, candidate_answer, is_silent),
            n_results=4,
            resume_text=full_resume
        )
        resume_context = targeted.strip() if targeted and targeted.strip() else full_resume
    else:
        resume_context = full_resume

    past_session_questions = await run_in_threadpool(get_user_past_questions, user_id)

    graph_input: InterviewGraphState = {
        "interview_id": interview_id,
        "user_id": user_id,
        "role": role,
        "difficulty": difficulty,
        "resume_text": resume_context,
        "resume_context": resume_context,
        "step_type": current_step,
        "question_number": current_q,
        "current_question": current_prompt,
        "current_prompt": current_prompt,
        "answer": candidate_answer,
        "candidate_answer": candidate_answer,
        "duration_seconds": duration,
        "answer_duration_seconds": duration,
        "is_silent": is_silent,
        "main_score": float(interview.get("current_main_score", 0.0)),
        "current_main_score": float(interview.get("current_main_score", 0.0)),
        "follow_up_score": float(interview.get("current_follow_up_score", 0.0)),
        "current_follow_up_score": float(interview.get("current_follow_up_score", 0.0)),
        "current_rating": interview.get("current_rating", ""),
        "next_remark": interview.get("current_rating", ""),
        "selected_skill": interview.get("selected_skill", ""),
        "history": previous_history,
        "past_session_questions": past_session_questions,
        "run_graph": True
    }

    active_graph = graph or interview_graph
    if hasattr(active_graph, "ainvoke"):
        result_state = await active_graph.ainvoke(graph_input)      # AIUnavailableError propagates
    else:                                                           # a plain synchronous graph object
        result_state = await asyncio.to_thread(active_graph.invoke, graph_input)

    next_step = result_state.get("next_step_type") or result_state.get("step_type", "question")
    next_q = int(result_state.get("question_number", current_q))
    next_prompt = result_state.get("next_question") or result_state.get("current_prompt", "")
    remark_text = result_state.get("next_remark") or result_state.get("current_rating", "")
    new_selected_skill = result_state.get("selected_skill", "")
    time_limit_exceeded = bool(result_state.get("time_limit_exceeded", False))

    # NOTE: never use `a or b` here - a real score of 0.0 is falsy and would be replaced
    main_score = float(result_state.get("main_score", 0.0))
    follow_up_score = float(result_state.get("follow_up_score", 0.0))

    if current_step == "follow_up":
        final_question_score = round((main_score * 0.7) + (follow_up_score * 0.3), 2)
    else:
        final_question_score = round(main_score, 2)

    history_entry = {
        "question_number": current_q,
        "step_type": current_step,
        "question": current_prompt,
        "prompt": current_prompt,
        "answer": candidate_answer,
        "duration_seconds": duration,
        "main_score": main_score,
        "follow_up_score": follow_up_score if current_step == "follow_up" else None,
        "final_score": final_question_score,
        "selected_skill": interview.get("selected_skill", ""),
        "remark": remark_text
    }

    updated_history = previous_history + [history_entry]
    is_complete = (next_step == "complete" or bool(result_state.get("complete", False)) or time_limit_exceeded)
    now_iso = datetime.now(timezone.utc).isoformat()

    silence_timeout = get_silence_timeout_for_question(next_q)

    updated_session = {
        "interview_id": interview_id,
        "user_id": user_id,
        "role": role,
        "difficulty": difficulty,
        "question_number": next_q,
        "step_type": next_step,
        "current_prompt": next_prompt,
        "interview_active": not is_complete,
        "completed": is_complete,
        "current_main_score": main_score,
        "current_follow_up_score": follow_up_score,
        "current_rating": remark_text,
        "selected_skill": new_selected_skill,
        "history": updated_history,
        "question_started_at": now_iso,
        "accumulated_pause_seconds": 0,
        "disconnect_started_at": None,
        "max_time_limit_seconds": QUESTION_TIME_LIMIT_SECONDS,
        "silence_timeout_seconds": silence_timeout
    }

    async def _persist():
        # 1) Save to MongoDB FIRST (the source of truth) - and only if nobody changed this interview since we read it.
        #    A stale copy (retried request, second tab, old cache) must never overwrite newer answers.
        guard = {"interview_id": interview_id, "user_id": user_id}
        if "question_number" in interview:
            guard["question_number"] = interview["question_number"]
        if "step_type" in interview:
            guard["step_type"] = interview["step_type"]
        saved = await run_in_threadpool(
            interviews_collection.update_one,
            guard,
            {"$set": updated_session}
        )
        if getattr(saved, "matched_count", 1) == 0:
            raise StateConflictError("This interview moved on while your answer was being processed.")

        # 2) Only now the side effects
        if is_complete:
            total_earned = 0.0
            seen_q = set()
            for h in reversed(updated_history):
                q_num = h.get("question_number")
                if q_num not in seen_q and h.get("final_score") is not None:
                    total_earned += float(h["final_score"])
                    seen_q.add(q_num)

            total_earned = round(total_earned, 2)
            percentage = round((total_earned / MAX_POSSIBLE_SCORE) * 100, 2)

            summary_doc = {
                "interview_id": interview_id,
                "user_id": user_id,
                "role": role,
                "difficulty": difficulty,
                "total_score": total_earned,
                "total_earned": total_earned,
                "max_score": 80,
                "max_possible_score": MAX_POSSIBLE_SCORE,
                "score_display": f"{total_earned} / 80",
                "percentage": percentage,
                "rating": remark_text or "Evaluated",
                "completed": True,
                "interview_active": False,
                "history": updated_history,
                "completed_at": now_iso
            }
            await run_in_threadpool(
                past_interviews_collection.update_one,
                {"interview_id": interview_id, "user_id": user_id},
                {"$set": summary_doc},
                upsert=True
            )
            try:
                await rabbitmq_client.publish_task(
                    queue_name=settings.REPORT_QUEUE_NAME,
                    payload={**summary_doc, "time_limit_exceeded": time_limit_exceeded}
                )
            except Exception as q_err:
                print(f"[RabbitMQ Publish Warning]: {q_err}")

            await delete_key(f"session:{interview_id}")

        if not is_complete:
            await set_json(f"session:{interview_id}", updated_session, expire_seconds=7200)

    # Once saving has started it must FINISH, even if the browser disconnects or times out right now
    # (otherwise the interview could end up saved but without its summary / report job).
    with anyio.CancelScope(shield=True):
        await _persist()

    return {
        "interview_id": interview_id,
        "question_number": next_q,
        "step_type": next_step,
        "next_prompt": next_prompt,
        "current_prompt": next_prompt,
        "next_question": next_prompt,
        "remark": remark_text,
        "score": final_question_score,
        "main_score": main_score,
        "follow_up_score": follow_up_score if current_step == "follow_up" else None,
        "interview_complete": is_complete,
        "time_limit_exceeded": time_limit_exceeded,
        "max_time_limit_seconds": QUESTION_TIME_LIMIT_SECONDS,
        "silence_timeout_seconds": silence_timeout,
        "session": updated_session
    }