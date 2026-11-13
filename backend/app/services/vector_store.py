"""Resume vector search (the "R" of RAG) - ChromaDB + LangChain + Gemini embeddings.

Normal path   : LangChain `Chroma` vector store, embeddings from Gemini (GoogleGenerativeAIEmbeddings).
Safety net    : if LangChain / the embedding model / the API is unavailable, the SAME public functions
                fall back to plain ChromaDB with its built-in embeddings (the old behaviour), and after
                one failure the LangChain path is paused for a few minutes so users never wait on it.
                If both fail, query_resume_context() returns "" and the caller uses the full resume text.

Public API (unchanged): add_resume_chunks_to_vector_store(), query_resume_context().

Environment (all optional):
  RAG_BACKEND=langchain | legacy      (legacy = never use Gemini embeddings)
  GEMINI_EMBEDDING_MODEL              default models/gemini-embedding-001
  CHROMA_PATH                         default <backend>/chroma_db   (absolute, independent of the start folder)
"""
import logging
import os
import threading
import time
from pathlib import Path

import chromadb
from chromadb.config import Settings as ChromaSettings   # noqa: F401  (kept for compatibility)

from app.core.config import settings

logger = logging.getLogger("uvicorn.error")

CHROMA_PATH = os.getenv("CHROMA_PATH") or str(Path(__file__).resolve().parents[2] / "chroma_db")
RAG_BACKEND = os.getenv("RAG_BACKEND", "langchain").strip().lower()
EMBEDDING_MODEL = os.getenv("GEMINI_EMBEDDING_MODEL", "models/gemini-embedding-001")
LC_COLLECTION = os.getenv("RAG_COLLECTION", "resume_chunks_gemini")
LC_PAUSE_SECONDS = 300

# One persistent client shared by both paths (two clients on one folder can conflict)
chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)
collection = chroma_client.get_or_create_collection(name="resume_embeddings")     # legacy collection

_lc_store = None
_lc_paused_until = 0.0
_lc_lock = threading.RLock()


def chunk_resume_text(text: str, size: int = 600, step: int = 500) -> list:
    """Same chunking the upload endpoint uses (overlapping windows)."""
    return [text[i:i + size] for i in range(0, len(text), step) if text[i:i + size].strip()]


# ---------------------------------------------------------------------------
# LangChain + Gemini embeddings path
# ---------------------------------------------------------------------------
def _api_key():
    return settings.GEMINI_API_KEY or os.getenv("GEMINI_API_KEY")


def _lc_available() -> bool:
    return RAG_BACKEND == "langchain" and bool(_api_key()) and time.monotonic() >= _lc_paused_until


def _pause_lc(err: Exception) -> None:
    global _lc_paused_until
    _lc_paused_until = time.monotonic() + LC_PAUSE_SECONDS
    logger.warning(f"[RAG] LangChain/Gemini embeddings unavailable, using plain ChromaDB for "
                   f"{LC_PAUSE_SECONDS}s: {err}")


def _get_lc_store():
    global _lc_store
    with _lc_lock:
        if _lc_store is None:
            from langchain_chroma import Chroma
            from langchain_google_genai import GoogleGenerativeAIEmbeddings
            embeddings = GoogleGenerativeAIEmbeddings(model=EMBEDDING_MODEL, google_api_key=_api_key())
            _lc_store = Chroma(
                collection_name=LC_COLLECTION,
                embedding_function=embeddings,
                client=chroma_client,
            )
        return _lc_store


def _lc_user_ids(store, user_id: str) -> list:
    return (store.get(where={"user_id": user_id}) or {}).get("ids", []) or []


def _lc_replace(user_id: str, chunks: list) -> None:
    store = _get_lc_store()
    with _lc_lock:
        old_ids = _lc_user_ids(store, user_id)
        if old_ids:
            store.delete(ids=old_ids)
        store.add_texts(
            texts=chunks,
            metadatas=[{"user_id": user_id, "chunk_index": i} for i in range(len(chunks))],
            ids=[f"{user_id}_chunk_{i}" for i in range(len(chunks))],
        )


def _lc_query(user_id: str, query: str, n_results: int, resume_text) -> str:
    store = _get_lc_store()
    count = len(_lc_user_ids(store, user_id))

    if count == 0 and resume_text and resume_text.strip():
        # Resume was uploaded before this vector store existed (or indexing failed): index it now, once.
        with _lc_lock:
            if len(_lc_user_ids(store, user_id)) == 0:
                _lc_replace(user_id, chunk_resume_text(resume_text))
        count = len(_lc_user_ids(store, user_id))

    if count == 0:
        return ""

    docs = store.similarity_search(query, k=min(n_results, count), filter={"user_id": user_id})
    return "\n".join(d.page_content for d in docs)


# ---------------------------------------------------------------------------
# Plain ChromaDB path (previous behaviour, kept as the safety net)
# ---------------------------------------------------------------------------
def _legacy_replace(user_id: str, chunks: list) -> None:
    ids = [f"{user_id}_chunk_{i}" for i in range(len(chunks))]
    metadatas = [{"user_id": user_id, "chunk_index": i} for i in range(len(chunks))]

    # Remove existing vector entries for this user before storing new ones
    try:
        collection.delete(where={"user_id": user_id})
    except Exception:
        pass

    collection.add(documents=chunks, ids=ids, metadatas=metadatas)


def _legacy_query(user_id: str, query: str, n_results: int) -> str:
    try:
        # Check actual stored chunk count for this user to avoid ChromaDB index bounds error
        user_entries = collection.get(where={"user_id": user_id})
        total_user_docs = len(user_entries.get("ids", []))
        if total_user_docs == 0:
            return ""

        results = collection.query(
            query_texts=[query],
            n_results=min(n_results, total_user_docs),
            where={"user_id": user_id}
        )
        documents = results.get("documents", [[]])[0]
        return "\n".join(documents) if documents else ""
    except Exception as e:
        print(f"⚠️ Vector store query error: {e}")
        return ""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def add_resume_chunks_to_vector_store(user_id: str, chunks: list) -> None:
    """Stores candidate resume text chunks (replacing any earlier resume of this user)."""
    if not chunks:
        return

    if _lc_available():
        try:
            _lc_replace(user_id, chunks)
            return
        except Exception as e:                   # noqa: BLE001
            _pause_lc(e)

    _legacy_replace(user_id, chunks)


def query_resume_context(user_id: str, query: str, n_results: int = 3, resume_text=None) -> str:
    """Top relevant resume chunks for `query`. Returns "" when nothing is available."""
    if not query or not query.strip():
        return ""

    if _lc_available():
        try:
            return _lc_query(user_id, query, n_results, resume_text)
        except Exception as e:                   # noqa: BLE001
            _pause_lc(e)

    return _legacy_query(user_id, query, n_results)
