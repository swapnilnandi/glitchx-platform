import os
import time
import asyncio
import logging
from app.core.config import settings
from app.services import llm            # shared model list, per-minute budget and cool-downs

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None

logger = logging.getLogger(__name__)

SILENT = "[Candidate remained silent]"
MIME_BY_EXTENSION = {
    ".webm": "audio/webm", ".wav": "audio/wav", ".mp3": "audio/mp3",
    ".mp4": "audio/mp4", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".aac": "audio/aac",
}
STT_ROUNDS = 2                                                   # passes over the model list before giving up
STT_QUEUE_MAX_WAIT_SECONDS = float(os.getenv("STT_QUEUE_MAX_WAIT_SECONDS", "20"))
STT_TIMEOUT_SECONDS = int(os.getenv("STT_TIMEOUT_SECONDS", "60"))   # one transcription call may take at most this long

# Initialize Google GenAI client
api_key = getattr(settings, "GEMINI_API_KEY", None) or os.getenv("GEMINI_API_KEY")


def _make_client():
    if genai is None or not api_key:
        return None
    try:   # a hard time limit, so a stuck request can never hang an interview for minutes
        return genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=STT_TIMEOUT_SECONDS * 1000))
    except Exception:
        return genai.Client(api_key=api_key)


gemini_client = _make_client()


def _stt_models() -> list:
    """Optional dedicated model first (STT_MODEL), then the same model chain as the text calls."""
    names = []
    dedicated = os.getenv("STT_MODEL", "").strip().replace("models/", "")
    if dedicated:
        names.append(dedicated)
    for m in llm.get_model_names():
        if m not in names:
            names.append(m)
    return names


def _transcribe_sync(file_path: str) -> str:
    """
    Synchronously transcribes the audio file with Gemini native audio understanding.
    Tries each configured model in turn (rate-limited / missing models are skipped), shares the
    per-minute request budget with the text calls, and raises only when every model failed.
    """
    if not os.path.exists(file_path):
        logger.error(f"Audio file not found: {file_path}")
        return SILENT

    if gemini_client is None:
        raise RuntimeError("Gemini client is not initialized in audio_service.")

    with open(file_path, "rb") as f:
        audio_bytes = f.read()

    if not audio_bytes or len(audio_bytes) < 500:
        return SILENT

    # Determine MIME type (defaulting to audio/webm)
    mime_type = MIME_BY_EXTENSION.get(os.path.splitext(file_path.lower())[1], "audio/webm")

    models = _stt_models()
    last_error = None

    for round_no in range(STT_ROUNDS):
        tried = set()
        while True:
            pool = [m for m in models if not llm._is_cooling(m)] or models
            candidates = [m for m in pool if m not in tried]
            if not candidates:
                break
            claim = llm._claim_slot(candidates, STT_QUEUE_MAX_WAIT_SECONDS)   # same per-minute budget as the text calls
            if claim is None:
                raise last_error or RuntimeError("Speech-to-text is busy - please retry in a moment.")
            model, wait = claim
            tried.add(model)
            if wait > 0:
                time.sleep(wait)
            try:
                response = gemini_client.models.generate_content(
                    model=model,
                    contents=[
                        types.Part.from_bytes(data=audio_bytes, mime_type=mime_type),
                        "Transcribe this interview audio recording verbatim. "
                        "Output ONLY the spoken words. Do not include any explanations, prefixes, or conversational filler. "
                        "If the audio has no speech or is completely silent, return exactly: [Candidate remained silent]"
                    ]
                )
                transcription = (response.text or "").strip()
                return transcription if transcription else SILENT
            except Exception as e:              # noqa: BLE001
                last_error = e
                logger.error(f"[Gemini Audio Transcription Error] model={model}: {e}")
                llm._classify_error(model, e, round_no, [])      # puts missing / out-of-quota models on cool-down
        if round_no + 1 < STT_ROUNDS:
            time.sleep(0.5 * (round_no + 1))

    # real failures must reach the caller; only genuine silence returns the marker
    raise last_error or RuntimeError("Speech-to-text failed.")


async def transcribe_audio_file(file_path: str) -> str:
    """
    Asynchronously transcribes an audio file in a thread pool.
    """
    return await asyncio.to_thread(_transcribe_sync, file_path)