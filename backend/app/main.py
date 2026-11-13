import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

# Safe Prometheus import (prevents startup crash if module is absent)
try:
    from prometheus_fastapi_instrumentator import Instrumentator
    HAS_PROMETHEUS = True
except ImportError:
    HAS_PROMETHEUS = False

from app.core.limiter import limiter
from app.routers import auth, interview, audio, websocket
from app.services.database import init_db_indexes
from app.services.rabbitmq import rabbitmq_client
from app.services.redis_service import init_redis, close_redis

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting GLITCHX Interview API server...")

    # 1. Initialize MongoDB database indexes
    try:
        init_db_indexes()
        logger.info("Database indexes initialized successfully.")
    except Exception as e:
        logger.warning(f"Database index warning on startup: {e}")

    # 2. Connect to Redis (Caching & Rate Limiting)
    try:
        await init_redis()
    except Exception as e:
        logger.warning(f"Redis initialization warning on startup: {e}")

    # 3. Connect to RabbitMQ (Message Broker)
    try:
        await rabbitmq_client.connect()
        logger.info("RabbitMQ client connected successfully.")
    except Exception as e:
        logger.error(f"RabbitMQ connection failed on startup: {e}")

    yield

    # Shutdown sequence
    logger.info("Shutting down GLITCHX Interview API server...")
    try:
        await rabbitmq_client.close()
        logger.info("RabbitMQ connection closed cleanly.")
    except Exception as e:
        logger.warning(f"Error while closing RabbitMQ: {e}")

    await close_redis()


def _docs_kwargs() -> dict:
    """In production (APP_ENV=production) the interactive API docs are not published."""
    if os.getenv("APP_ENV", "").lower() == "production":
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {}


app = FastAPI(
    **_docs_kwargs(),
    title="GLITCHX Interview API",
    version="1.0.0",
    description="Backend service for AI-driven technical interview evaluations.",
    lifespan=lifespan
)

# Prometheus Metrics Instrumentation (Exposes /metrics for prometheus.yml)
if HAS_PROMETHEUS:
    Instrumentator().instrument(app).expose(app, endpoint="/metrics")
    logger.info("Prometheus /metrics endpoint instrumented successfully.")
else:
    logger.warning("prometheus_fastapi_instrumentator not installed; /metrics is disabled.")

# Register Limiter on app state
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)

# Allowed CORS origins
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000"
]
# PRODUCTION: set CORS_ORIGINS="https://your-site.com,https://www.your-site.com" in backend/.env
ALLOWED_ORIGINS += [o.strip().rstrip("/") for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


# Rate Limit Exception Handler
@app.exception_handler(RateLimitExceeded)
async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    logger.warning(f"Rate limit exceeded on {request.method} {request.url.path}")
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={
            "detail": "Rate limit exceeded. Please slow down.",
            "error": str(exc.detail)
        }
    )


# Validation Exception Handler
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError
):
    logger.warning(
        f"Validation error on {request.method} {request.url.path}: {exc.errors()}"
    )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": "Invalid request payload or format.",
            "errors": exc.errors()
        }
    )


# Generic Unhandled Exception Handler
@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.error(f"Server error on {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error occurred."},
        headers=({"Access-Control-Allow-Origin": request.headers["origin"]}
                 if request.headers.get("origin") in ALLOWED_ORIGINS else {})
    )


# Mount application routers
app.include_router(auth.router)
app.include_router(interview.router)
app.include_router(audio.router)
app.include_router(websocket.router)


@app.get("/", tags=["Health Check"])
def root():
    return {
        "status": "online",
        "service": "GLITCHX Backend",
        "version": "1.0.0"
    }