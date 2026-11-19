"""Seed the isolated identity_001 database before testing the upgrade."""

import hashlib

from argon2 import PasswordHasher
from sqlalchemy import create_engine, text

from rag_db import database_url

with create_engine(database_url(), hide_parameters=True).begin() as connection:
    identifier = "c1e468cf-0649-4935-8a18-17c0eaa7ee0b"
    connection.execute(text("""
        INSERT INTO identity.accounts (user_id, email, password_hash)
        VALUES (:uid, 'legacy-session@example.com', :password_hash)
    """), {"uid": identifier, "password_hash": PasswordHasher().hash("Phase1!a")})
    connection.execute(text("""
        INSERT INTO identity.sessions (token_digest, user_id, expires_at)
        VALUES (:digest, :uid, now() + interval '1 hour')
    """), {"digest": hashlib.sha256(b"a" * 43).hexdigest(), "uid": identifier})
