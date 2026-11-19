"""Integration checks through Compose HTTP and PostgreSQL endpoints."""

import hashlib
import os
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from uuid import uuid4

import httpx
import psycopg

GATEWAY = "http://api-gateway:8000"
WEB_ORIGIN = os.environ["WEB_ORIGIN"]
PASSWORD = "Phase1!a"
ADMIN_EMAIL = "phase01-admin@example.com"


def client() -> httpx.Client:
    return httpx.Client(base_url=GATEWAY, headers={"Origin": WEB_ORIGIN}, timeout=7, trust_env=False)


def credentials(prefix: str) -> dict[str, str]:
    return {"email": f"{prefix}-{uuid4().hex}@example.com", "password": PASSWORD}


def register_and_login(http: httpx.Client, data: dict[str, str]) -> str:
    registration = http.post("/v1/auth/register", json=data)
    registration.raise_for_status()
    assert registration.status_code == 204
    login = http.post("/v1/auth/login", json=data)
    login.raise_for_status()
    return login.json()["user_id"]


def database() -> psycopg.Connection:
    return psycopg.connect(
        host=os.environ["DB_HOST"], dbname=os.environ["DB_NAME"],
        user=os.environ["PHASE01_TEST_DB_USER"], password=os.environ["PHASE01_TEST_DB_PASSWORD"],
    )


class IdentityWorkspaceTests(unittest.TestCase):
    def check_status(self, response: httpx.Response, status: int) -> httpx.Response:
        self.assertEqual(response.status_code, status, response.text[:500])
        return response

    def test_registration_password_requirements(self):
        with client() as http:
            for password in ("Phase1!", "phase1!a", "Phase!!a", "Phase11a", "Phase1 a"):
                with self.subTest(password=password):
                    data = {**credentials("password-rule"), "password": password}
                    self.check_status(http.post("/v1/auth/register", json=data), 422)
            register_and_login(http, credentials("password-rule"))

    def test_registration_session_origin_throttling_and_expiry(self):
        with client() as auth, client() as anonymous:
            data = credentials("identity")
            request_id = str(uuid4())
            self.check_status(auth.post("/v1/auth/register", json=data, headers={"X-Request-ID": request_id}), 204)
            altered = {**data, "password": "Another1!", "role": "ADMIN"}
            self.check_status(auth.post("/v1/auth/register", json=altered), 204)
            wrong = self.check_status(auth.post("/v1/auth/login", json=altered), 401).json()
            unknown = self.check_status(auth.post("/v1/auth/login", json=credentials("unknown")), 401).json()
            self.assertEqual(wrong["code"], unknown["code"])
            self.assertEqual(wrong["message"], unknown["message"])

            login = self.check_status(auth.post("/v1/auth/login", json=data), 200)
            user_id = login.json()["user_id"]
            self.assertEqual(login.json()["role"], "USER")
            cookie_attributes = " ".join(login.headers.get_list("Set-Cookie")).lower()
            self.assertIn("httponly", cookie_attributes)
            self.assertIn("samesite=strict", cookie_attributes)
            first_session = auth.cookies.get("rag_access")
            self.assertTrue(first_session)
            self.check_status(anonymous.get("/v1/auth/me"), 401)
            self.check_status(auth.get("/v1/auth/admin-access", headers={"X-User-Role": "ADMIN"}), 403)
            self.check_status(auth.post("/v1/auth/logout", headers={"Origin": "https://elsewhere.example"}), 403)
            self.check_status(auth.post("/v1/auth/logout", headers={"Origin": "null"}), 403)
            self.check_status(auth.get("/v1/auth/me"), 200)

            self.check_status(auth.post("/v1/auth/login", json=data), 200)
            self.assertNotEqual(auth.cookies.get("rag_access"), first_session)
            self.check_status(anonymous.get("/v1/auth/me", headers={"Cookie": f"rag_access={first_session}"}), 401)

            token = auth.cookies.get("rag_access")
            with database() as db:
                db.execute("UPDATE identity.auth_sessions SET expires_at = now() - interval '1 second' WHERE user_id = %s", (user_id,))
                audit = db.execute("SELECT count(*) FROM identity.audit WHERE request_id = %s AND action = 'account.registered'",
                                   (request_id,)).fetchone()
                self.assertEqual(audit[0], 1)
            self.check_status(auth.get("/v1/auth/me"), 401)
            self.check_status(auth.get("/v1/workspaces"), 401)
            self.check_status(auth.post("/v1/auth/logout"), 204)
            self.assertNotIn("rag_access", auth.cookies)
            self.check_status(anonymous.get("/v1/auth/me", headers={"Cookie": f"rag_access={token}"}), 401)

            limited = credentials("limited")
            for _ in range(4):
                self.check_status(anonymous.post("/v1/auth/login", json=limited), 401)
            response = self.check_status(anonymous.post("/v1/auth/login", json=limited), 429)
            self.assertGreater(int(response.headers["Retry-After"]), 0)

    def test_refresh_rotation_reuse_and_promotion(self):
        with client() as browser, client() as anonymous:
            user_id = register_and_login(browser, credentials("refresh"))
            first = browser.cookies.get("rag_refresh")
            access = browser.cookies.get("rag_access")
            self.assertTrue(first)
            self.check_status(browser.post("/v1/auth/refresh", headers={"Origin": "https://elsewhere.example"}), 403)
            with database() as db:
                before = db.execute(
                    "SELECT expires_at FROM identity.auth_sessions WHERE user_id = %s", (user_id,),
                ).fetchone()[0]
                self.assertIsNotNone(db.execute(
                    "SELECT 1 FROM identity.refresh_tokens WHERE token_digest = %s",
                    (hashlib.sha256(first.encode()).hexdigest(),),
                ).fetchone())

            browser.cookies.delete("rag_access")
            response = self.check_status(browser.post("/v1/auth/refresh"), 204)
            self.assertIn("Path=/v1/auth", " ".join(response.headers.get_list("Set-Cookie")))
            second = browser.cookies.get("rag_refresh")
            self.assertNotEqual(first, second)
            self.assertNotEqual(access, browser.cookies.get("rag_access"))
            self.check_status(browser.get("/v1/auth/me"), 200)
            self.check_status(browser.post("/v1/auth/refresh"), 204)
            with database() as db:
                after = db.execute(
                    "SELECT expires_at FROM identity.auth_sessions WHERE user_id = %s", (user_id,),
                ).fetchone()[0]
            self.assertEqual(before, after)
            self.check_status(anonymous.post("/v1/auth/refresh", headers={"Cookie": f"rag_refresh={first}"}), 401)
            self.check_status(browser.get("/v1/auth/me"), 401)
            self.check_status(browser.post("/v1/auth/refresh"), 401)
            self.assertNotIn("rag_refresh", browser.cookies)
            with database() as db:
                self.assertIsNotNone(db.execute("""
                    SELECT 1 FROM identity.audit WHERE actor_id = %s AND action = 'session.refresh_reuse'
                """, (user_id,)).fetchone())
            self.check_status(anonymous.get("/v1/auth/me", headers={
                "Cookie": f"rag_access={os.environ['PHASE01_PROMOTED_ACCESS']}",
            }), 401)

    def test_concurrent_refresh_and_expired_session(self):
        with client() as browser:
            user_id = register_and_login(browser, credentials("refresh-race"))
            token = browser.cookies.get("rag_refresh")

            def exchange():
                with client() as http:
                    return http.post("/v1/auth/refresh", headers={"Cookie": f"rag_refresh={token}"})

            with ThreadPoolExecutor(max_workers=2) as workers:
                results = [future.result() for future in [workers.submit(exchange), workers.submit(exchange)]]
            self.assertEqual(sorted(response.status_code for response in results), [204, 401])
            rotated = next(response for response in results if response.status_code == 204)
            browser.cookies.update(rotated.cookies)
            self.check_status(browser.get("/v1/auth/me"), 401)
            self.check_status(browser.post("/v1/auth/refresh"), 401)

            user_id = register_and_login(browser, credentials("refresh-expiration"))
            with database() as db:
                db.execute(
                    "UPDATE identity.auth_sessions SET expires_at = now() - interval '1 second' WHERE user_id = %s",
                    (user_id,),
                )
            self.check_status(browser.post("/v1/auth/refresh"), 401)
            self.assertNotIn("rag_access", browser.cookies)

    def test_upgrade_preserves_legacy_account(self):
        with client() as http:
            self.check_status(http.get("/v1/auth/me", headers={"Cookie": "rag_session=" + "a" * 43}), 401)
            login = self.check_status(http.post("/v1/auth/login", json={
                "email": "legacy-session@example.com", "password": PASSWORD,
            }), 200)
            self.assertEqual(login.json()["user_id"], "c1e468cf-0649-4935-8a18-17c0eaa7ee0b")
            with database() as db:
                self.assertEqual(db.execute("SELECT count(*) FROM identity.sessions").fetchone()[0], 0)

    def test_workspace_acl_and_atomic_audit(self):
        with client() as owner, client() as viewer, client() as editor, client() as outsider, client() as admin:
            owner_id = register_and_login(owner, credentials("owner"))
            viewer_id = register_and_login(viewer, credentials("viewer"))
            editor_id = register_and_login(editor, credentials("editor"))
            register_and_login(outsider, credentials("outsider"))
            self.check_status(admin.post("/v1/auth/login", json={"email": ADMIN_EMAIL, "password": PASSWORD}), 200)
            self.check_status(admin.get("/v1/auth/admin-access"), 204)

            key = str(uuid4())
            correlation_id = str(uuid4())
            create_headers = {"Idempotency-Key": key, "X-Request-ID": correlation_id}
            with ThreadPoolExecutor(max_workers=2) as workers:
                requests = [
                    workers.submit(owner.post, "/v1/workspaces", json={"name": "Phase 01"}, headers=create_headers)
                    for _ in range(2)
                ]
                first, replay = [self.check_status(request.result(), 201) for request in requests]
            self.assertEqual(first.json(), replay.json())
            self.assertEqual(first.headers["X-Request-ID"], correlation_id)
            workspace_id = first.json()["workspace_id"]
            path = f"/v1/workspaces/{workspace_id}"
            self.check_status(owner.post("/v1/workspaces", json={"name": "Different"}, headers=create_headers), 409)
            self.assertEqual(owner.get("/v1/workspaces").json(), [first.json()])

            self.check_status(outsider.get(path, headers={"X-User-ID": owner_id, "X-User-Role": "ADMIN"}), 404)
            self.check_status(outsider.patch(path, json={"name": "Outsider"}), 404)
            self.check_status(outsider.get(path + "/members"), 404)
            self.check_status(admin.get(path), 404)
            self.assertEqual(outsider.get("/v1/workspaces").json(), [])
            self.check_status(owner.patch(path, json={"name": "Wrong origin"}, headers={"Origin": "http://web:3001"}), 403)
            self.check_status(owner.get(path), 200)

            member_path = path + "/members"
            self.check_status(owner.put(f"{member_path}/{owner_id}", json={"role": "VIEWER"}), 409)
            self.check_status(owner.put(f"{member_path}/{uuid4()}", json={"role": "VIEWER"}), 404)
            for user_id, role in [(viewer_id, "VIEWER"), (editor_id, "EDITOR")]:
                for _ in range(2):
                    response = self.check_status(owner.put(f"{member_path}/{user_id}", json={"role": role}), 200)
                    self.assertEqual(response.json()["role"], role)
            self.assertEqual(viewer.get(path).json()["role"], "VIEWER")
            self.assertEqual(editor.get(path).json()["role"], "EDITOR")
            self.check_status(viewer.get(member_path), 403)
            self.check_status(viewer.patch(path, json={"name": "Viewer attempt"}), 403)
            self.check_status(editor.delete(path), 403)
            self.check_status(editor.delete(f"{member_path}/{viewer_id}"), 403)
            self.check_status(editor.patch(path, json={"name": "Renamed"}), 200)
            self.assertEqual(viewer.get(path).json()["name"], "Renamed")

            for _ in range(2):
                self.check_status(owner.delete(f"{member_path}/{editor_id}"), 204)
            self.check_status(editor.patch(path, json={"name": "Revoked editor"}), 404)
            self.check_status(owner.delete(path), 202)
            self.check_status(viewer.get(path), 404)
            self.assertEqual(self.check_status(
                owner.post("/v1/workspaces", json={"name": "Phase 01"}, headers=create_headers), 201,
            ).json(), first.json())
            self.check_status(owner.get(path), 404)
            token = owner.cookies.get("rag_access")
            self.check_status(owner.post("/v1/auth/logout"), 204)
            self.check_status(outsider.get(path, headers={"Cookie": f"rag_access={token}"}), 401)

        with database() as db:
            actions = dict(db.execute("""
                SELECT action, count(*) FROM workspace.audit WHERE workspace_id = %s GROUP BY action
            """, (workspace_id,)).fetchall())
            self.assertEqual(actions, {
                "workspace.created": 1, "workspace.renamed": 1, "workspace.deleted": 1,
                "membership.granted": 2, "membership.revoked": 1,
            })

    def test_internal_routes_database_roles_and_public_contract(self):
        with client() as http:
            self.check_status(http.get("/internal/v1/session"), 404)
            browser = self.check_status(http.get("/openapi.json"), 200).json()
            self.assertIn("/v1/workspaces/{workspace_id}/members/{user_id}", browser["paths"])
            self.assertFalse(any(path.startswith("/internal") for path in browser["paths"]))
        with closing(httpx.Client(base_url="http://auth-service:8000", timeout=3, trust_env=False)) as internal:
            self.check_status(internal.get(f"/internal/v1/users/{uuid4()}"), 401)
        with database() as db:
            privileges = db.execute("""
                SELECT has_schema_privilege('rag_workspace', 'identity', 'USAGE'),
                       has_schema_privilege('rag_auth', 'workspace', 'USAGE'),
                       has_schema_privilege('rag_workspace', 'workspace', 'CREATE'),
                       has_table_privilege('rag_auth', 'identity.audit', 'UPDATE')
            """).fetchone()
            self.assertEqual(privileges, (False, False, False, False))


if __name__ == "__main__":
    if sys.argv[1:] == ["--seed-admin"]:
        with client() as http:
            user_id = register_and_login(http, {"email": ADMIN_EMAIL, "password": PASSWORD})
            print(user_id, http.cookies.get("rag_access"))
    else:
        unittest.main(verbosity=2)
