from dotenv import load_dotenv

# Load .env into os.environ too: several settings (GEMINI_FALLBACK_MODELS, CORS_ORIGINS, APP_ENV,
# GEMINI_MAX_CONCURRENCY ...) are read with os.getenv and were silently ignored before.
load_dotenv()

from pydantic import Field, AliasChoices
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "GLITCHX Backend"
    
    # Database Settings
    MONGO_URI: str = Field(
        default="mongodb://localhost:27017", 
        validation_alias=AliasChoices("MONGO_URI", "MONGODB_URL")
    )
    DATABASE_NAME: str = "glitchx_db"

    # Redis Settings (In-memory caching and distributed rate limiting)
    REDIS_URL: str = Field(
        default="redis://localhost:6379/0",
        validation_alias=AliasChoices("REDIS_URL", "REDIS_URI")
    )

    # Authentication Settings
    SECRET_KEY: str = "your_super_secret_jwt_key_here"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    # Model API Keys & Configuration
    GEMINI_API_KEY: str | None = None
    OPENAI_API_KEY: str | None = None
    GEMINI_MODEL: str = "gemini-3.5-flash-lite"

    # RabbitMQ Settings
    RABBITMQ_URL: str = "amqp://guest:guest@localhost:5672/"
    REPORT_QUEUE_NAME: str = "interview_report_queue"

    # Prompt Templates
    QUESTION_GENERATION_PROMPT: str = """
You are an expert technical and behavioral interviewer for GLITCHX.
Your task is to generate interview question number {question_number} for the role of {role} at a {difficulty} difficulty level.
Candidate Resume Context (RAG): {resume_context}

Rules:
1. Questions 1-5 must be technical (tailored to resume context).
2. Questions 6-7 must be behavioral/scenario-based.
3. Keep prompts concise and direct for voice format delivery without fluff or greetings.
"""

    EVALUATION_PROMPT: str = """
Evaluate the candidate's response.
Question: {question}
Candidate Answer: {transcript}

Assign a numerical score (0.0 to 10.0), provide feedback, and determine if a follow-up is required (score < 5.0 and not question 7).
Output JSON format: {{"score": float, "feedback": "string", "followup_required": boolean}}
"""

    FINAL_REPORT_PROMPT: str = """
Synthesize complete technical interview performance into a final report.
Role: {role}
Difficulty: {difficulty}
Performance Data: {performance_data}

Output JSON format: {{"final_score_percentage": float, "letter_rating": "string", "narrative_report": "string"}}
"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False
    )


settings = Settings()