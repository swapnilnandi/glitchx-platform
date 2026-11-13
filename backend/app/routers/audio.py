import io
import os
import wave
import base64
import logging
from google import genai
from google.genai import types
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Body
from fastapi.responses import Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.core.config import settings
from app.core.security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/audio", tags=["Audio"])

api_key = getattr(settings, "GEMINI_API_KEY", None) or os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=api_key) if (genai is not None and api_key) else None


class TTSRequest(BaseModel):
    text: str


@router.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    current_user: str = Depends(get_current_user)
):
    if client is None:
        raise HTTPException(status_code=500, detail="Gemini client is not initialized.")

    contents = await file.read(10 * 1024 * 1024 + 1)
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio file is too large (max 10 MB).")
    if not contents or len(contents) < 200:
        return {"transcription": "[Candidate remained silent]", "text": "[Candidate remained silent]"}

    mime_type = file.content_type or "audio/webm"

    def _call_gemini_stt():
        audio_part = types.Part.from_bytes(data=contents, mime_type=mime_type)
        response = client.models.generate_content(
            model=getattr(settings, "GEMINI_MODEL", "gemini-3.1-flash-lite"),
            contents=[
                audio_part,
                "Transcribe this interview audio clip verbatim. "
                "Return ONLY the spoken transcription without extra commentary or formatting. "
                "If the audio contains no speech or is completely silent, respond strictly with: [Candidate remained silent]"
            ]
        )
        return (response.text or "").strip()

    try:
        transcription = await run_in_threadpool(_call_gemini_stt)
        if not transcription:
            transcription = "[Candidate remained silent]"
        return {"transcription": transcription, "text": transcription}
    except Exception as e:
        logger.error(f"[Gemini STT Error] {e}")
        raise HTTPException(status_code=502, detail="Speech-to-text failed. Please try again.")


@router.get("/tts")
async def text_to_speech_get(text: str, current_user: str = Depends(get_current_user)):
    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="Text parameter cannot be empty.")
    if len(text) > 1000:
        raise HTTPException(status_code=413, detail="Text too long (max 1000 characters).")
    return await generate_tts_audio_response(text.strip())


async def generate_tts_audio_response(text_content: str):
    if client is None:
        raise HTTPException(status_code=500, detail="Gemini client is not initialized.")

    def _call_gemini_tts():
        candidate_models = [
            "gemini-2.5-flash-preview-tts",
            "gemini-2.5-pro-preview-tts",
            getattr(settings, "GEMINI_MODEL", "gemini-2.5-flash")
        ]
        last_error = None
        for model_name in candidate_models:
            clean_name = model_name.replace("models/", "")
            try:
                resp = client.models.generate_content(
                    model=clean_name,
                    contents=text_content,
                    config=types.GenerateContentConfig(
                        response_modalities=["AUDIO"],
                        speech_config=types.SpeechConfig(
                            voice_config=types.VoiceConfig(
                                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Kore")
                            )
                        )
                    )
                )
                if resp.candidates and resp.candidates[0].content:
                    for part in resp.candidates[0].content.parts:
                        if hasattr(part, "inline_data") and part.inline_data and part.inline_data.data:
                            return part.inline_data.data
            except Exception as err:
                last_error = err
                continue
        raise RuntimeError(f"TTS failed: {last_error}")

    try:
        pcm_bytes = await run_in_threadpool(_call_gemini_tts)
        if isinstance(pcm_bytes, str):
            pcm_bytes = base64.b64decode(pcm_bytes)

        if not pcm_bytes:
            raise HTTPException(status_code=500, detail="No audio returned from Gemini TTS.")

        if pcm_bytes.startswith(b"RIFF"):
            wav_data = pcm_bytes
        else:
            wav_buffer = io.BytesIO()
            with wave.open(wav_buffer, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(24000)
                wf.writeframes(pcm_bytes)
            wav_data = wav_buffer.getvalue()

        return Response(content=wav_data, media_type="audio/wav")
    except Exception as e:
        logger.error(f"[Google TTS Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))