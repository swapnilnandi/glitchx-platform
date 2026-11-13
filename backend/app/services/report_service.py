"""One shared report generator (was copy-pasted in routers/interview.py and workers/report_worker.py)."""
import json

from app.services import interview_graph as _graph_module
from app.services.interview_graph import run_sync


async def agenerate_comprehensive_report(
    role: str,
    difficulty: str,
    history: list,
    total_score: float,
    percentage: float
) -> dict:
    if percentage >= 90:
        overall_rating = "Outstanding"
    elif percentage >= 75:
        overall_rating = "Excellent"
    elif percentage >= 50:
        overall_rating = "Good"
    else:
        overall_rating = "Needs Improvement"

    prompt = f"""
You are an expert interviewer and hiring director for the profession "{role}", conducting a detailed post-interview evaluation.
Judge every answer by the standards of THAT profession (real-world knowledge, correct practice, safety and ethics where relevant,
practical judgement and communication). Do NOT apply software-engineering criteria unless the role is a software role.

ROLE: {role}
DIFFICULTY: {difficulty}
TOTAL SCORE: {total_score} out of 80 (10 for the Introduction + 70 for the role-specific questions)
OVERALL PERCENTAGE: {percentage}%
OVERALL RATING: {overall_rating}

TRANSCRIPT & SCORES OF QUESTIONS:
{json.dumps(history, indent=2)}

TASK:
Perform a deep, constructive analysis for EACH question present in the transcript:
1. For attempted questions:
   - "where_marks_deducted": Pinpoint exact omissions, vague explanations, errors, or missed considerations (for example safety, procedure or ethics where relevant to the profession). (If full marks, state "Full marks awarded; exceptional response.")
   - "how_to_improve": Provide 1-2 concrete, actionable ways the candidate could enhance this specific answer.
   - "ideal_answer": Write a crisp, accurate model answer (2-3 sentences max) that demonstrates mastery.
2. For unattempted questions (marked "[Interview ended early: ...]" or with 0 score):
   - "where_marks_deducted": State "Question unattempted as interview was ended early."
   - "how_to_improve": State "Attempt this question to earn marks towards the 80-point evaluation."
   - "ideal_answer": Provide the model answer demonstrating what was expected.

Also provide:
- "summary": A 2-3 sentence overview of their role knowledge, practical judgement, problem-solving, and communication.
- "strengths": A list of 2-3 core strengths demonstrated.
- "areas_for_improvement": A list of 2-3 prioritized topics to study or practice.

Return ONLY valid JSON:
{{
    "summary": "Executive summary text here...",
    "strengths": ["Strength 1", "Strength 2"],
    "areas_for_improvement": ["Area 1", "Area 2"],
    "questions_analysis": [
        {{
            "question_number": 0,
            "step_type": "intro",
            "question": "The question text",
            "candidate_answer": "Candidate's response",
            "score": 8.5,
            "where_marks_deducted": "Detailed reason marks were deducted...",
            "how_to_improve": "Clear improvement advice...",
            "ideal_answer": "The ideal answer..."
        }}
    ]
}}
"""
    try:
        ai_evaluation = await _graph_module.acall_gemini_json(prompt)
        q_analysis = ai_evaluation.get("questions_analysis", [])

        # Sync answers with history so candidate answers are never lost
        history_map = {int(h.get("question_number", -1)): h for h in history}
        valid_items = []
        for item in q_analysis:
            try:
                qn = int(item.get("question_number", -1))
            except (TypeError, ValueError):
                continue
            hist_item = history_map.get(qn, {})
            if history_map and not hist_item:
                continue
            if hist_item:
                awarded = hist_item.get("final_score")
                if awarded is None:
                    awarded = hist_item.get("main_score", 0.0)
                item["score"] = round(float(awarded or 0.0), 2)
            valid_items.append(item)
            ans = (
                hist_item.get("answer")
                or hist_item.get("candidate_answer")
                or item.get("candidate_answer")
                or "[No answer recorded]"
            )
            item["candidate_answer"] = ans
            item["answer"] = ans
            if not item.get("question"):
                item["question"] = hist_item.get("question") or hist_item.get("prompt") or f"Question {qn}"
        q_analysis = valid_items

        return {
            "rating": overall_rating,
            "summary": ai_evaluation.get("summary", f"Completed {role} interview at {difficulty} difficulty."),
            "strengths": ai_evaluation.get("strengths", ["Solid foundational knowledge"]),
            "areas_for_improvement": ai_evaluation.get("areas_for_improvement", ["Review skipped and edge-case topics"]),
            "questions_analysis": q_analysis
        }
    except Exception as e:
        print(f"[Worker Report Gen Error]: {e}")
        fallback_analysis = []
        for h in history:
            q_num = h.get("question_number", 0)
            score_val = float(h.get("final_score") or h.get("main_score", 0.0))
            is_unattempted = "unattempted" in str(h.get("remark", "")).lower() or score_val == 0.0
            ans = h.get("answer") or h.get("candidate_answer") or "[No answer recorded]"

            fallback_analysis.append({
                "question_number": q_num,
                "step_type": h.get("step_type", "question"),
                "question": h.get("question") or h.get("prompt", f"Question {q_num}"),
                "candidate_answer": ans,
                "answer": ans,
                "score": score_val,
                "where_marks_deducted": "Question was unattempted due to early interview exit." if is_unattempted else ("Answer lacked specific, practical detail." if score_val < 8 else "Minor omissions."),
                "how_to_improve": "Attempt all questions for full marks." if is_unattempted else "Add a concrete real-world example and name the key terms, tools or procedures of your profession.",
                "ideal_answer": "Consult the standard guidelines or reference material of your profession for a complete model answer."
            })
        return {
            "rating": overall_rating,
            "summary": f"Completed {role} interview with an overall score of {total_score} / 80 ({percentage}%).",
            "strengths": ["Demonstrated core capabilities"],
            "areas_for_improvement": ["Complete all questions to reach maximum potential"],
            "questions_analysis": fallback_analysis
        }


def generate_comprehensive_report(*args, **kwargs) -> dict:
    """Synchronous wrapper kept for scripts / tests."""
    return run_sync(agenerate_comprehensive_report(*args, **kwargs))
