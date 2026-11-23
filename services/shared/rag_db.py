"""Database connection and migration setup. Each caller supplies its own schema."""

import asyncio
import logging
import os

from alembic import context
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import URL, create_engine, pool, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from rag_http import request_id


def database_url() -> URL:
    return URL.create(
        "postgresql+psycopg", username=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"],
        host=os.environ.get("DB_HOST", "postgres"), port=int(os.environ.get("DB_PORT", "5432")),
        database=os.environ["DB_NAME"],
    )


def open_database() -> AsyncEngine:
    return create_async_engine(
        database_url(), hide_parameters=True, pool_pre_ping=True,
        pool_timeout=3, connect_args={"connect_timeout": 3},
    )


def install_database_errors(app: FastAPI) -> None:
    @app.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, exc: SQLAlchemyError) -> JSONResponse:
        logging.getLogger(__name__).warning("Database failure request_id=%s error=%s", request_id(request), type(exc).__name__)
        return JSONResponse({
            "code": "unavailable",
            "message": "The database operation could not be completed.",
            "request_id": request_id(request),
        }, 503)


async def database_ready(engine: AsyncEngine, schema: str, revision: str) -> bool:
    try:
        async with asyncio.timeout(2), engine.connect() as connection:
            version = await connection.scalar(text(f"SELECT version_num FROM {schema}.alembic_version"))
            return version == revision
    except (SQLAlchemyError, TimeoutError):
        return False


def migrate(schema: str, lock_id: int) -> None:
    engine = create_engine(database_url(), hide_parameters=True, poolclass=pool.NullPool)
    try:
        with engine.begin() as connection:
            connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_id})
            context.configure(connection=connection, version_table_schema=schema)
            context.run_migrations()
    finally:
        engine.dispose()
