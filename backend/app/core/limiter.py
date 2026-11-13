import hashlib
from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from app.core.config import settings
from app.core.security import get_current_user_from_token


def get_user_or_ip(request: Request) -> str:
    """
    Limits by hashed token/user identifier if authenticated;
    otherwise falls back to remote client IP.
    """
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.replace("Bearer ", "").strip()
        try:
            # Key by the real user, not the token: a fresh login must not reset the limit
            user = get_current_user_from_token(token)
            return f"user:{hashlib.md5(user.encode('utf-8')).hexdigest()}"
        except Exception:
            return f"ip:{get_remote_address(request)}"
    
    return f"ip:{get_remote_address(request)}"


# Backed by the exact same Redis Docker container on port 6379
limiter = Limiter(
    key_func=get_user_or_ip,
    storage_uri=settings.REDIS_URL,
    strategy="moving-window",
    in_memory_fallback=["100/minute"]  # Safe fallback if Redis restarts
)