from fastapi import Header, HTTPException, status

from .config import get_settings


def require_api_key(x_scrappify_key: str | None = Header(default=None)) -> None:
    expected = get_settings().scrappify_api_key
    if expected and x_scrappify_key != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
