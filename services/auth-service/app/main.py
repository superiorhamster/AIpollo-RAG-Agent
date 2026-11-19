import asyncio
import hashlib
import logging
import hmac
import os
import re
import smtplib
import ssl
from email.message import EmailMessage
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Literal
from uuid import UUID, uuid4

from argon2 import PasswordHasher, Type
from argon2.exceptions import VerificationError
from fastapi import BackgroundTasks, Depends, FastAPI, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field, StringConstraints, field_validator
from redis.exceptions import RedisError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool

from rag_db import database_ready, install_database_errors, open_database
from rag_http import ACCESS_COOKIE, REFRESH_COOKIE, ApiError, health_response, install_http, request_id, require_service, unauthorized
from rag_limits import open_redis, require_budget

from app.sessions import (
    access_claims, clear_cookies, new_refresh, refresh_digest, refresh_session_id,
    revoke_browser_session, set_cookies,
)

SERVICE = "auth-service"
PASSWORD_HASHER = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1, type=Type.ID)


class Login(BaseModel):
    email: EmailStr
    password: Annotated[str, Field(min_length=1, max_length=128)]


class Registration(Login):
    password: Annotated[str, Field(min_length=8, max_length=128)]

    @field_validator("password")
    @classmethod
    def validate_password(cls, password: str) -> str:
        if not all(re.search(pattern, password) for pattern in (
            r"[A-Z]", r"[0-9]", r"[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]",
        )):
            raise ValueError("Use an uppercase letter, a number, and a special character.")
        return password


class Identity(BaseModel):
    user_id: UUID
    role: Literal["USER", "ADMIN"]


class Account(Identity):
    email: str


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.shared_token = os.environ["AUTH_WORKSPACE_TOKEN"].encode()
    if len(app.state.shared_token) < 32:
        raise ValueError("AUTH_WORKSPACE_TOKEN must contain at least 32 bytes.")
    app.state.secure_cookie = os.environ["WEB_ORIGIN"].startswith("https://")
    app.state.jwt_key = os.environ["AUTH_JWT_SIGNING_KEY"].encode()
    if len(app.state.jwt_key) < 32:
        raise ValueError("AUTH_JWT_SIGNING_KEY must contain at least 32 bytes.")
    app.state.access_ttl = int(os.environ.get("AUTH_ACCESS_TTL_SECONDS", "300"))
    app.state.session_ttl = int(os.environ.get("AUTH_SESSION_TTL_SECONDS", "43200"))
    if not 1 <= app.state.access_ttl <= 300 or not 1 <= app.state.session_ttl <= 43200:
        raise ValueError("Access and session lifetimes must stay within 300 and 43200 seconds respectively.")
    app.state.account_limit = int(os.environ.get("AUTH_ACCOUNT_LIMIT", "10"))
    app.state.rate_window = int(os.environ.get("AUTH_RATE_WINDOW_SECONDS", "900"))
    if min(app.state.account_limit, app.state.rate_window) < 1:
        raise ValueError("Auth limits must be positive.")
    app.state.hash_slots = asyncio.Semaphore(4)
    app.state.dummy_hash = await run_in_threadpool(PASSWORD_HASHER.hash, secrets.token_urlsafe(32))
    app.state.database = open_database()
    app.state.redis = open_redis(os.environ["REDIS_URL"])
    try:
        yield
    finally:
        await app.state.redis.aclose()
        await app.state.database.dispose()


app = FastAPI(title=SERVICE, lifespan=lifespan, docs_url=None, redoc_url=None)
install_http(app)
install_database_errors(app)


@app.get("/healthz")
async def health() -> dict[str, str]:
    return {"service": SERVICE, "status": "ok"}


@app.get("/readyz")
async def readiness() -> Response:
    try:
        ready = await database_ready(app.state.database, "identity", "identity_003") and await app.state.redis.ping()
    except RedisError:
        ready = False
    return health_response(SERVICE, ready)


async def write_audit(
    connection: AsyncConnection,
    correlation_id: str,
    action: str,
    actor_id: UUID | None = None,
    outcome: str = "succeeded",
) -> None:
    await connection.execute(text("""
        INSERT INTO identity.audit (request_id, actor_id, action, outcome, target_id)
        VALUES (:request_id, :actor_id, :action, :outcome, :actor_id)
    """), {"request_id": correlation_id, "actor_id": actor_id, "action": action, "outcome": outcome})


async def current_account(request: Request) -> Account:
    claims = access_claims(request.cookies.get(ACCESS_COOKIE), app.state.jwt_key)
    if claims is None:
        raise unauthorized()
    session_id, user_id = claims
    async with app.state.database.connect() as connection:
        result = await connection.execute(text("""
            SELECT a.user_id, a.email, a.role
            FROM identity.auth_sessions AS s JOIN identity.accounts AS a USING (user_id)
            WHERE s.session_id = :sid AND s.user_id = :user_id
              AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp() AND a.disabled_at IS NULL
        """), {"sid": session_id, "user_id": user_id})
        account = result.mappings().one_or_none()
    if account is None:
        raise unauthorized()
    return Account.model_validate(account)


async def limit_account(action: str, email: str) -> None:
    key = hashlib.sha256(email.encode()).hexdigest()
    await require_budget(app.state.redis, f"identity:{action}:{key}", app.state.account_limit, app.state.rate_window)


@app.post("/v1/auth/register", status_code=204)
async def register(data: Registration, request: Request) -> Response:
    email = data.email.casefold()
    await limit_account("register", email)
    async with app.state.hash_slots:
        password_hash = await run_in_threadpool(PASSWORD_HASHER.hash, data.password)
    async with app.state.database.begin() as connection:
        user_id = await connection.scalar(text("""
            INSERT INTO identity.accounts (user_id, email, password_hash)
            VALUES (:user_id, :email, :password_hash)
            ON CONFLICT (email) DO NOTHING RETURNING user_id
        """), {"user_id": uuid4(), "email": email, "password_hash": password_hash})
        if user_id is not None:
            await write_audit(connection, request_id(request), "account.registered", user_id)
    return Response(status_code=204)


@app.post("/v1/auth/login")
async def login(data: Login, request: Request, response: Response) -> Account:
    email = data.email.casefold()
    await limit_account("login", email)
    async with app.state.database.connect() as connection:
        result = await connection.execute(text("""
            SELECT user_id, password_hash FROM identity.accounts WHERE email = :email AND disabled_at IS NULL
        """), {"email": email})
        credentials = result.mappings().one_or_none()

    password_hash = credentials["password_hash"] if credentials else app.state.dummy_hash
    try:
        async with app.state.hash_slots:
            verified = await run_in_threadpool(PASSWORD_HASHER.verify, password_hash, data.password)
    except VerificationError:
        verified = False
    if not verified or credentials is None:
        async with app.state.database.begin() as connection:
            await write_audit(connection, request_id(request), "session.login", outcome="denied")
        raise ApiError(401, "invalid_credentials", "Email or password is incorrect.")

    session_id = uuid4()
    async with app.state.database.begin() as connection:
        result = await connection.execute(text("""
            SELECT user_id, email, role, password_hash FROM identity.accounts
            WHERE user_id = :user_id AND disabled_at IS NULL FOR UPDATE
        """), {"user_id": credentials["user_id"]})
        current = result.mappings().one_or_none()
        if current is None or current["password_hash"] != password_hash:
            raise ApiError(401, "invalid_credentials", "Email or password is incorrect.")
        account = Account.model_validate(current)
        await revoke_browser_session(connection, request)
        expires_at = await connection.scalar(text("""
            INSERT INTO identity.auth_sessions (session_id, user_id, expires_at)
            VALUES (:sid, :user_id, clock_timestamp() + make_interval(secs => :ttl))
            RETURNING expires_at
        """), {"sid": session_id, "user_id": account.user_id, "ttl": app.state.session_ttl})
        refresh_token = await new_refresh(connection, session_id)
        await write_audit(connection, request_id(request), "session.login", account.user_id)

    set_cookies(response, request, session_id, account.user_id, expires_at, refresh_token)
    response.delete_cookie("rag_session", httponly=True, samesite="strict", secure=app.state.secure_cookie)
    return account


def rejected_refresh(request: Request) -> Response:
    error = unauthorized()
    response = JSONResponse({**error.detail, "request_id": request_id(request)}, error.status_code)
    clear_cookies(response, request)
    return response


@app.post("/v1/auth/refresh", status_code=204)
async def refresh(request: Request) -> Response:
    digest = refresh_digest(request.cookies.get(REFRESH_COOKIE))
    if digest is None:
        return rejected_refresh(request)
    async with app.state.database.begin() as connection:
        session_id = await refresh_session_id(connection, digest)
        if session_id is None:
            return rejected_refresh(request)
        # Lock the session first and read the token in a separate statement so concurrent
        # requests see the previous rotation after waiting for the lock.
        result = await connection.execute(text("""
            SELECT user_id, expires_at, revoked_at
            FROM identity.auth_sessions WHERE session_id = :sid FOR UPDATE
        """), {"sid": session_id})
        session = result.mappings().one_or_none()
        now = await connection.scalar(text("SELECT clock_timestamp()"))
        if session is None or session["revoked_at"] is not None or session["expires_at"] <= now:
            return rejected_refresh(request)
        user_id = session["user_id"]
        consumed_at = await connection.scalar(text("""
            SELECT consumed_at FROM identity.refresh_tokens WHERE token_digest = :digest
        """), {"digest": digest})
        if consumed_at is not None:
            await connection.execute(text("""
                UPDATE identity.auth_sessions SET revoked_at = clock_timestamp() WHERE session_id = :sid
            """), {"sid": session_id})
            await write_audit(connection, request_id(request), "session.refresh_reuse", user_id, "denied")
            return rejected_refresh(request)
        await connection.execute(text("""
            UPDATE identity.refresh_tokens SET consumed_at = clock_timestamp() WHERE token_digest = :digest
        """), {"digest": digest})
        refresh_token = await new_refresh(connection, session_id)
        await write_audit(connection, request_id(request), "session.refresh", user_id)

    response = Response(status_code=204)
    set_cookies(response, request, session_id, user_id, session["expires_at"], refresh_token)
    return response


@app.post("/v1/auth/logout", status_code=204)
async def logout(request: Request) -> Response:
    async with app.state.database.begin() as connection:
        user_id = await revoke_browser_session(connection, request)
        if user_id is not None:
            await write_audit(connection, request_id(request), "session.logout", user_id)
    response = Response(status_code=204)
    clear_cookies(response, request)
    return response


@app.get("/v1/auth/me")
async def me(account: Annotated[Account, Depends(current_account)]) -> Account:
    return account


@app.get("/v1/auth/admin-access", status_code=204)
async def admin_access(request: Request, account: Annotated[Account, Depends(current_account)]) -> Response:
    if account.role != "ADMIN":
        async with app.state.database.begin() as connection:
            await write_audit(connection, request_id(request), "admin.access", account.user_id, "denied")
        raise ApiError(403, "forbidden", "Administrator access is required.")
    return Response(status_code=204)


async def workspace_caller(request: Request) -> None:
    candidate = request.headers.get("X-Workspace-Service-Token", "").encode()
    if not hmac.compare_digest(candidate, app.state.shared_token):
        raise unauthorized()


@app.get("/internal/v1/session", dependencies=[Depends(workspace_caller)], include_in_schema=False)
async def internal_session(account: Annotated[Account, Depends(current_account)]) -> Identity:
    return Identity(user_id=account.user_id, role=account.role)


@app.get("/internal/v1/users/{user_id}", status_code=204, dependencies=[Depends(workspace_caller)], include_in_schema=False)
async def internal_user(user_id: UUID) -> Response:
    async with app.state.database.connect() as connection:
        found = await connection.scalar(text("SELECT user_id FROM identity.accounts WHERE user_id = :id AND disabled_at IS NULL"), {"id": user_id})
    if found is None:
        raise ApiError(404, "not_found", "Account could not be found.")
    return Response(status_code=204)


class AccountUpdate(BaseModel):
    role: Literal["USER", "ADMIN"]
    disabled: bool


async def admin_caller(request: Request) -> Account:
    require_service(request, "X-Admin-Service-Token", os.environ["ADMIN_DOMAIN_TOKEN"])
    actor = await current_account(request)
    if actor.role != "ADMIN":
        raise ApiError(403, "forbidden", "Administrator access is required.")
    return actor


Admin = Annotated[Account, Depends(admin_caller)]


@app.get("/internal/v1/admin/accounts", include_in_schema=False)
async def admin_accounts(_actor: Admin):
    async with app.state.database.connect() as connection:
        rows = await connection.execute(text("""
            SELECT user_id, email, role, disabled_at IS NOT NULL AS disabled
            FROM identity.accounts ORDER BY email, user_id LIMIT 200
        """))
        return [dict(row) for row in rows.mappings()]


@app.patch("/internal/v1/admin/accounts/{user_id}", include_in_schema=False)
async def admin_update(user_id: UUID, data: AccountUpdate, actor: Admin, request: Request):
    async with app.state.database.begin() as connection:
        await connection.execute(text("SELECT pg_advisory_xact_lock(710109)"))
        still_admin = await connection.scalar(text("""
            SELECT 1 FROM identity.accounts WHERE user_id=:id AND role='ADMIN' AND disabled_at IS NULL
        """), {"id": actor.user_id})
        if not still_admin:
            raise ApiError(403, "forbidden", "Administrator access is required.")
        if user_id == actor.user_id and (data.disabled or data.role != "ADMIN"):
            raise ApiError(409, "self_admin_change", "Another administrator must change your own access.")
        row = await connection.execute(text("""
            UPDATE identity.accounts
            SET role=:role, disabled_at=CASE WHEN :disabled THEN COALESCE(disabled_at, now()) ELSE NULL END
            WHERE user_id=:id RETURNING user_id, role, email, disabled_at IS NOT NULL AS disabled
        """), {"id": user_id, "role": data.role, "disabled": data.disabled})
        account = row.mappings().one_or_none()
        if account is None:
            raise ApiError(404, "not_found", "Account could not be found.")
        await connection.execute(text("""
            UPDATE identity.auth_sessions SET revoked_at=now() WHERE user_id=:id AND revoked_at IS NULL
        """), {"id": user_id})
        await connection.execute(text("""
            INSERT INTO identity.audit (request_id, actor_id, action, outcome, target_id)
            VALUES (:request, :actor, 'admin.account_updated', 'success', :target)
        """), {"request": request_id(request), "actor": actor.user_id, "target": user_id})
        return dict(account)


@app.get("/internal/v1/admin/audit", include_in_schema=False)
async def admin_audit(_actor: Admin):
    async with app.state.database.connect() as connection:
        rows = await connection.execute(text("""
            SELECT request_id, actor_id, action, outcome, target_id, occurred_at
            FROM identity.audit ORDER BY occurred_at DESC LIMIT 200
        """))
        return [dict(row) for row in rows.mappings()]


class ResetRequest(BaseModel):
    email: EmailStr


class PasswordReset(Registration):
    token: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{43}$")]


def send_reset(email: str, token: str) -> None:
    message = EmailMessage()
    message["From"] = os.environ["SMTP_FROM"]
    message["To"] = email
    message["Subject"] = "Reset your Super Agentic RAG password"
    link = os.environ["WEB_ORIGIN"].rstrip("/") + "/reset-password?token=" + token
    message.set_content(f"Open this link within 20 minutes to reset your password.\n\n{link}")
    with smtplib.SMTP_SSL(os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORT", "465")),
                          timeout=6, context=ssl.create_default_context()) as smtp:
        if os.environ.get("SMTP_USER"):
            smtp.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"])
        smtp.send_message(message)


def send_reset_safely(email: str, token: str) -> None:
    try:
        send_reset(email, token)
    except (ValueError, OSError, smtplib.SMTPException, KeyError):
        logging.getLogger(__name__).warning("Password recovery delivery failed")


@app.post("/v1/auth/password-reset", status_code=204)
async def request_reset(data: ResetRequest, tasks: BackgroundTasks) -> Response:
    email = data.email.casefold()
    await limit_account("reset-request", email)
    if not os.environ.get("SMTP_HOST") or not os.environ.get("SMTP_FROM"):
        return Response(status_code=204)
    token = secrets.token_urlsafe(32)
    async with app.state.database.begin() as connection:
        user_id = await connection.scalar(text("""
            SELECT user_id FROM identity.accounts WHERE email=:email AND disabled_at IS NULL
        """), {"email": email})
        if user_id is None:
            return Response(status_code=204)
        await connection.execute(text("""
            INSERT INTO identity.password_resets (user_id, token_digest, expires_at)
            VALUES (:id, :digest, now() + interval '20 minutes')
            ON CONFLICT (user_id) DO UPDATE SET token_digest=EXCLUDED.token_digest, expires_at=EXCLUDED.expires_at
        """), {"id": user_id, "digest": hashlib.sha256(token.encode()).hexdigest()})
    tasks.add_task(send_reset_safely, email, token)
    return Response(status_code=204)


@app.post("/v1/auth/password-reset/confirm", status_code=204)
async def confirm_reset(data: PasswordReset, request: Request) -> Response:
    email = data.email.casefold()
    await limit_account("reset-confirm", email)
    digest = hashlib.sha256(data.token.encode()).hexdigest()
    invalid = ApiError(400, "invalid_reset", "The password reset link is invalid or expired.")
    async with app.state.hash_slots:
        new_hash = await run_in_threadpool(PASSWORD_HASHER.hash, data.password)
    async with app.state.database.begin() as connection:
        user_id = await connection.scalar(text("""
            SELECT a.user_id FROM identity.accounts a JOIN identity.password_resets r USING (user_id)
            WHERE a.email=:email AND a.disabled_at IS NULL AND r.token_digest=:digest AND r.expires_at>now()
            FOR UPDATE OF a, r
        """), {"email": email, "digest": digest})
        if user_id is None:
            raise invalid
        await connection.execute(text("UPDATE identity.accounts SET password_hash=:hash WHERE user_id=:id"),
                                 {"id": user_id, "hash": new_hash})
        await connection.execute(text("DELETE FROM identity.password_resets WHERE user_id=:id"), {"id": user_id})
        await connection.execute(text("UPDATE identity.auth_sessions SET revoked_at=now() WHERE user_id=:id AND revoked_at IS NULL"),
                                 {"id": user_id})
        await write_audit(connection, request_id(request), "account.password_reset", user_id)
    return Response(status_code=204)
