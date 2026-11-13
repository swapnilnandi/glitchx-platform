import sys
from pathlib import Path

# Add project root (backend folder) to Python path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import asyncio
import json
from datetime import datetime, timezone
import aio_pika

from app.core.config import settings
from app.services.database import (
    interviews_collection,
    past_interviews_collection
)
from app.services.redis_service import set_json
from app.services.report_service import agenerate_comprehensive_report, generate_comprehensive_report
from app.services.interview_graph import call_gemini_json   # kept so test/fake-AI scripts can still patch it

_ORIGINAL_SYNC_REPORT = generate_comprehensive_report


async def _make_report(*args) -> dict:
    if generate_comprehensive_report is not _ORIGINAL_SYNC_REPORT:   # replaced by a test script
        return await asyncio.to_thread(generate_comprehensive_report, *args)
    return await agenerate_comprehensive_report(*args)


async def process_report_task(message: aio_pika.IncomingMessage):
    async with message.process():
        data = json.loads(message.body.decode())
        interview_id = data.get("interview_id")
        user_id = data.get("user_id")
        role = data.get("role", "Software Engineer")
        difficulty = data.get("difficulty", "Medium")
        history = data.get("history", [])
        total_earned = float(data.get("total_earned") or data.get("total_score", 0.0))
        percentage = float(data.get("percentage", 0.0))
        max_possible_score = float(data.get("max_possible_score", 80.0))

        print("\n" + "=" * 60)
        print(f"⚙️  [WORKER PICKED UP TASK] Generating Report for Interview: {interview_id}")
        print(f"👤 Candidate: {user_id} | Role: {role} ({difficulty}) | Score: {total_earned} / 80")
        print("=" * 60)

        detailed_eval = await _make_report(
            role,
            difficulty,
            history,
            total_earned,
            percentage
        )

        analysis_list = detailed_eval.get("questions_analysis", [])

        final_report = {
            "interview_id": interview_id,
            "user_id": user_id,
            "completed": True,
            "role": role,
            "difficulty": difficulty,
            "final_score": total_earned,
            "total_score": total_earned,
            "total_earned": total_earned,
            "max_score": 80,
            "max_possible_score": max_possible_score,
            "score_display": f"{total_earned} / 80",
            "percentage": percentage,
            "rating": detailed_eval.get("rating", "Good"),
            "summary": detailed_eval.get("summary", ""),
            "strengths": detailed_eval.get("strengths", []),
            "areas_for_improvement": detailed_eval.get("areas_for_improvement", []),
            "questions": analysis_list,
            "questions_analysis": analysis_list,
            "history": history,
            "completed_at": datetime.now(timezone.utc).isoformat()
        }

        # 1. Update MongoDB past_interviews_collection
        await asyncio.to_thread(
            past_interviews_collection.update_one,
            {"interview_id": interview_id, "user_id": user_id},
            {"$set": final_report},
            upsert=True
        )

        # 2. Update MongoDB interviews_collection
        await asyncio.to_thread(
            interviews_collection.update_one,
            {"interview_id": interview_id, "user_id": user_id},
            {
                "$set": {
                    "final_report": final_report,
                    "interview_active": False,
                    "completed": True
                }
            }
        )

        # 3. Update Redis cache so Report.jsx loads immediately without waiting
        try:
            cache_key = f"report:{interview_id}"
            await set_json(cache_key, final_report, expire_seconds=86400)
        except Exception as redis_err:
            print(f"[Worker Redis Sync Warning]: {redis_err}")

        print("\n" + "✅" * 30)
        print(f"🎯 [WORKER FINISHED] Final Report Stored in MongoDB & Redis for {interview_id}")
        print("✅" * 30 + "\n")


async def start_worker():
    print(f"🚀 [RabbitMQ Worker] Connecting to {settings.RABBITMQ_URL}...")
    connection = await aio_pika.connect_robust(settings.RABBITMQ_URL)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=1)

    queue = await channel.declare_queue(settings.REPORT_QUEUE_NAME, durable=True)
    print(f"👂 [RabbitMQ Worker] Listening on queue: '{settings.REPORT_QUEUE_NAME}'...")

    await queue.consume(process_report_task)
    await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(start_worker())
    except KeyboardInterrupt:
        print("\n[RabbitMQ Worker Stopped]")