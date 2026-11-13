import os
import hashlib
import asyncio
import logging
import edge_tts

from app.services.redis_service import get_bytes, set_bytes
logger = logging.getLogger("uvicorn.error")

# High-quality Microsoft Neural Voices (Free, no API key needed):
# Options: "en-US-JennyNeural" (female), "en-US-GuyNeural" (male), "en-US-AriaNeural" (female)
TTS_VOICE = "en-US-GuyNeural"

# In-memory fallback cache
_LOCAL_AUDIO_CACHE: dict[str, bytes] = {}


async def _synthesize_edge_audio(text: str) -> bytes:
    """Synthesizes speech using Microsoft Edge's free Neural TTS engine."""
    communicate = edge_tts.Communicate(text, TTS_VOICE)
    audio_data = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_data.extend(chunk["data"])
    return bytes(audio_data)


async def generate_cached_tts_audio(text: str) -> bytes:
    """
    Retrieves synthesized audio from Redis RAM cache in < 1ms.
    If not cached, generates audio via Edge-TTS and stores it in Redis for 24 hours.
    """
    clean_text = (text or "").strip()
    if not clean_text:
        return b""

    # Generate unique hash key based on the text + voice
    text_hash = hashlib.md5(f"{TTS_VOICE}:{clean_text}".encode("utf-8")).hexdigest()
    cache_key = f"tts:audio:{text_hash}"

    # 1. Check Redis Cache (< 1ms)
    try:
        cached_audio = await get_bytes(cache_key)
        if cached_audio:
            return cached_audio
    except Exception:
        pass

    # 2. Check Local RAM fallback
    if text_hash in _LOCAL_AUDIO_CACHE:
        return _LOCAL_AUDIO_CACHE[text_hash]

    # 3. Cache Miss: Generate via Edge-TTS (Free)
    try:
        audio_content = await _synthesize_edge_audio(clean_text)
    except Exception as e:
        logger.error(f"[Edge-TTS Synthesis Error]: {e}")
        return b""

    # 4. Save to Redis (expires in 24 hours) & local RAM
    try:
        await set_bytes(cache_key, audio_content, expire_seconds=86400)
    except Exception:
        pass

    if len(_LOCAL_AUDIO_CACHE) < 100:
        _LOCAL_AUDIO_CACHE[text_hash] = audio_content

    return audio_content


def generate_tts_audio(text: str) -> bytes:
    """Synchronous fallback for HTTP endpoints."""
    clean_text = (text or "").strip()
    if not clean_text:
        return b""
    try:
        return asyncio.run(_synthesize_edge_audio(clean_text))
    except Exception as e:
        logger.error(f"[Sync TTS Error]: {e}")
        return b""