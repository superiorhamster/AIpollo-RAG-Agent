"""Check account suspension and one-use password recovery without real email or Redis."""

import asyncio
import os
from uuid import uuid4

import httpx
from sqlalchemy import text

import app.main as auth
from rag_db import open_database


class Budget:
    async def eval(self, *args, **kwargs):
        return (1, 900)


async def check_identity():
    database = open_database()
    auth.app.state.database = database
    auth.app.state.jwt_key = os.environ["AUTH_JWT_SIGNING_KEY"].encode()
    auth.app.state.secure_cookie = False
    auth.app.state.access_ttl = 300
    auth.app.state.session_ttl = 3600
    auth.app.state.redis = Budget()
    auth.app.state.account_limit = 10
    auth.app.state.rate_window = 900
    auth.app.state.hash_slots = asyncio.Semaphore(4)
    auth.app.state.dummy_hash = auth.PASSWORD_HASHER.hash("unused-test-data")
    os.environ["SMTP_HOST"] = "fixture"
    os.environ["SMTP_FROM"] = "sender@example.com"
    messages = []
    auth.send_reset = lambda email, token: messages.append((email, token))

    def ensure(response, expected):
        assert response.status_code == expected, response.text
        return response

    admin_email = f"operator-{uuid4().hex}@example.com"
    user_email = f"member-{uuid4().hex}@example.com"
    transport = httpx.ASGITransport(app=auth.app)
    async with (
        httpx.AsyncClient(base_url="http://auth", transport=transport) as admin,
        httpx.AsyncClient(base_url="http://auth", transport=transport) as member,
    ):
        for client, email in [(admin, admin_email), (member, user_email)]:
            ensure(await client.post("/v1/auth/register", json={"email": email, "password": "Start!123"}), 204)
        async with database.begin() as connection:
            await connection.execute(text("UPDATE identity.accounts SET role='ADMIN' WHERE email=:email"),
                                     {"email": admin_email})
        ensure(await admin.post("/v1/auth/login", json={"email": admin_email, "password": "Start!123"}), 200)
        account = ensure(await member.post("/v1/auth/login", json={"email": user_email, "password": "Start!123"}), 200).json()
        path = f"/internal/v1/admin/accounts/{account['user_id']}"
        service = {"X-Admin-Service-Token": os.environ["ADMIN_DOMAIN_TOKEN"]}
        ensure(await member.get("/internal/v1/admin/accounts", headers=service), 403)
        ensure(await admin.get("/internal/v1/admin/accounts"), 401)
        ensure(await admin.get("/internal/v1/admin/accounts", headers=service), 200)
        ensure(await admin.patch(path, json={"role": "USER", "disabled": True}, headers=service), 200)
        ensure(await member.get("/v1/auth/me"), 401)
        ensure(await member.post("/v1/auth/refresh"), 401)
        ensure(await admin.get("/internal/v1/admin/audit", headers=service), 200)
        ensure(await admin.patch(path, json={"role": "USER", "disabled": False}, headers=service), 200)

        reset = "/v1/auth/password-reset"
        ensure(await member.post(reset, json={"email": user_email}), 204)
        assert len(messages) == 1 and messages[0][0] == user_email
        body = {"email": user_email, "token": messages[0][1], "password": "Updated!1"}
        ensure(await member.post(reset + "/confirm", json=body), 204)
        ensure(await member.post(reset + "/confirm", json=body), 400)
        ensure(await member.post("/v1/auth/login", json={"email": user_email, "password": "Start!123"}), 401)
        ensure(await member.post("/v1/auth/login", json={"email": user_email, "password": "Updated!1"}), 200)
    await database.dispose()
    print("Admin scope, audit, account suspension, session revocation, and one-use password recovery passed.")


if __name__ == "__main__":
    asyncio.run(check_identity())
