import json
import logging
from typing import Any, Optional
import redis.asyncio as aioredis
from app.core.config import settings

logger = logging.getLogger("uvicorn.error")

redis_client: Optional[aioredis.Redis] = None


async def init_redis():
    """Initializes the persistent Redis connection pool."""
    global redis_client
    try:
        try:
            # waits (up to 10 s) for a free connection instead of raising "Too many connections" under load
            pool = aioredis.BlockingConnectionPool.from_url(
                settings.REDIS_URL,
                decode_responses=False,
                max_connections=200,
                timeout=10
            )
            redis_client = aioredis.Redis(connection_pool=pool)
        except Exception:
            redis_client = aioredis.from_url(
                settings.REDIS_URL,
                decode_responses=False,
                max_connections=200
            )
        await redis_client.ping()
        logger.info("Redis cache client connected successfully.")
    except Exception as e:
        logger.warning(f"Redis connection failed (caching disabled/degraded): {e}")
        redis_client = None


async def get_redis_client() -> Optional[aioredis.Redis]:
    """Ensures Redis client is connected on-demand for scripts, workers, and tests."""
    global redis_client
    if redis_client is None:
        await init_redis()
    return redis_client


async def close_redis():
    """Closes Redis connections on server shutdown."""
    global redis_client
    if redis_client:
        await redis_client.aclose()
        redis_client = None
        logger.info("Redis connection closed cleanly.")


async def get_json(key: str) -> Optional[Any]:
    client = await get_redis_client()
    if not client:
        return None
    try:
        raw = await client.get(key)
        return json.loads(raw.decode("utf-8")) if raw else None
    except Exception as err:
        logger.warning(f"[Redis Get Error] {key}: {err}")
        return None


async def set_json(key: str, data: Any, expire_seconds: int = 7200):
    client = await get_redis_client()
    if not client:
        return
    try:
        payload = json.dumps(data)
        await client.set(key, payload, ex=expire_seconds)
    except Exception as err:
        logger.warning(f"[Redis Set Error] {key}: {err}")


async def delete_key(key: str):
    client = await get_redis_client()
    if not client:
        return
    try:
        await client.delete(key)
    except Exception as err:
        logger.warning(f"[Redis Del Error] {key}: {err}")


async def get_bytes(key: str) -> Optional[bytes]:
    client = await get_redis_client()
    if not client:
        return None
    try:
        return await client.get(key)
    except Exception:
        return None


async def set_bytes(key: str, data: bytes, expire_seconds: int = 86400):
    client = await get_redis_client()
    if not client:
        return
    try:
        await client.set(key, data, ex=expire_seconds)
    except Exception:
        pass