"""Promote an existing account from the deployment operator's shell."""

import argparse
import asyncio
from uuid import UUID, uuid4

from sqlalchemy import text

from rag_db import open_database


async def promote(user_id: UUID) -> None:
    engine = open_database()
    try:
        async with engine.begin() as connection:
            role = await connection.scalar(text("""
                SELECT role FROM identity.accounts WHERE user_id = :user_id FOR UPDATE
            """), {"user_id": user_id})
            if role is None:
                raise SystemExit("Account could not be found.")
            if role == "ADMIN":
                print("Account already has the ADMIN role.")
                return
            await connection.execute(text("UPDATE identity.accounts SET role = 'ADMIN' WHERE user_id = :user_id"),
                                     {"user_id": user_id})
            await connection.execute(text("UPDATE identity.auth_sessions SET revoked_at = clock_timestamp() WHERE user_id = :user_id AND revoked_at IS NULL"), {"user_id": user_id})
            await connection.execute(text("""
                INSERT INTO identity.audit (request_id, action, outcome, target_id)
                VALUES (:request_id, 'account.promoted', 'succeeded', :user_id)
            """), {"request_id": uuid4(), "user_id": user_id})
        print("Account promoted. Sign in again to use the ADMIN role.")
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("user_id", type=UUID)
    args = parser.parse_args()
    asyncio.run(promote(args.user_id))


if __name__ == "__main__":
    main()
