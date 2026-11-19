import hashlib
import secrets
from datetime import datetime, timezone
from uuid import UUID, uuid4

import jwt
from fastapi import Request, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from rag_http import ACCESS_COOKIE, ACCESS_FORMAT, REFRESH_COOKIE, REFRESH_FORMAT, REFRESH_PATH

ISSUER = "rag-auth"
AUDIENCE = "rag-api"


def access_claims(token: str | None, key: bytes) -> tuple[UUID, UUID] | None:
    if not token or not ACCESS_FORMAT.fullmatch(token):
        return None
    try:
        claims = jwt.decode(token, key, algorithms=["HS256"], issuer=ISSUER, audience=AUDIENCE,
                            options={"require": ["iss", "aud", "exp", "iat", "sub", "sid", "jti", "token_use"]})
        if claims["token_use"] == "access":
            return UUID(claims["sid"]), UUID(claims["sub"])
    except (jwt.InvalidTokenError, ValueError, TypeError, AttributeError):
        pass
    return None


def refresh_digest(token: str | None) -> str | None:
    if token and REFRESH_FORMAT.fullmatch(token):
        return hashlib.sha256(token.encode()).hexdigest()
    return None


async def new_refresh(connection: AsyncConnection, session_id: UUID) -> str:
    token = secrets.token_urlsafe(32)
    await connection.execute(text("""
        INSERT INTO identity.refresh_tokens (token_digest, session_id) VALUES (:digest, :sid)
    """), {"digest": refresh_digest(token), "sid": session_id})
    return token


async def refresh_session_id(connection: AsyncConnection, digest: str) -> UUID | None:
    return await connection.scalar(text("""
        SELECT session_id FROM identity.refresh_tokens WHERE token_digest = :digest
    """), {"digest": digest})


async def revoke_browser_session(connection: AsyncConnection, request: Request) -> UUID | None:
    digest = refresh_digest(request.cookies.get(REFRESH_COOKIE))
    session_id = await refresh_session_id(connection, digest) if digest else None
    if session_id is None:
        claims = access_claims(request.cookies.get(ACCESS_COOKIE), request.app.state.jwt_key)
        if claims is None:
            return None
        session_id = claims[0]
    return await connection.scalar(text("""
        UPDATE identity.auth_sessions SET revoked_at = clock_timestamp()
        WHERE session_id = :sid AND revoked_at IS NULL AND expires_at > clock_timestamp()
        RETURNING user_id
    """), {"sid": session_id})


def set_cookies(response: Response, request: Request, session_id: UUID, user_id: UUID,
                expires_at: datetime, refresh: str) -> None:
    now = int(datetime.now(timezone.utc).timestamp())
    end = int(expires_at.timestamp())
    access_end = min(end, now + request.app.state.access_ttl)
    token = jwt.encode({
        "sub": str(user_id), "sid": str(session_id), "jti": str(uuid4()),
        "iss": ISSUER, "aud": AUDIENCE, "iat": now, "exp": access_end, "token_use": "access",
    }, request.app.state.jwt_key, algorithm="HS256")
    settings = {"httponly": True, "samesite": "strict", "secure": request.app.state.secure_cookie}
    response.set_cookie(ACCESS_COOKIE, token, path="/", max_age=max(0, access_end - now), **settings)
    response.set_cookie(REFRESH_COOKIE, refresh, path=REFRESH_PATH, max_age=max(0, end - now), **settings)


def clear_cookies(response: Response, request: Request) -> None:
    for name, path in ((ACCESS_COOKIE, "/"), (REFRESH_COOKIE, REFRESH_PATH), ("rag_session", "/")):
        response.delete_cookie(name, path=path, httponly=True, samesite="strict",
                               secure=request.app.state.secure_cookie)
