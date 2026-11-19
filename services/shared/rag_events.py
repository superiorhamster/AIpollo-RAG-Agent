"""RabbitMQ transport for service-owned transactional outboxes."""

import asyncio
import json
import logging
import os
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID, uuid4

import aio_pika
from aio_pika.abc import AbstractExchange, AbstractIncomingMessage
from pydantic import BaseModel, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

EXCHANGE = "rag.documents"
LOG = logging.getLogger(__name__)


class Event(BaseModel):
    event_id: UUID
    event_type: Literal[
        "document.uploaded.v1", "document.deletion_requested.v1",
        "workspace.deletion_requested.v1", "workspace.documents_deleted.v1",
    ]
    schema_version: Literal[1] = 1
    occurred_at: datetime
    workspace_id: UUID
    actor_id: UUID
    request_id: UUID
    document_id: UUID | None = None
    media_type: str | None = None


async def enqueue(connection: AsyncConnection, schema: str, **fields: object) -> None:
    event = Event(event_id=uuid4(), occurred_at=datetime.now(timezone.utc), **fields)
    await connection.execute(text(f"""
        INSERT INTO {schema}.outbox (event_id, event_type, payload)
        VALUES (:id, :kind, CAST(:payload AS jsonb))
    """), {"id": event.event_id, "kind": event.event_type, "payload": event.model_dump_json()})


async def publish_one(database: AsyncEngine, schema: str, exchange: AbstractExchange) -> bool:
    async with database.begin() as connection:
        result = await connection.execute(text(f"""
            SELECT event_id, event_type, payload FROM {schema}.outbox
            ORDER BY created_at, event_id LIMIT 1 FOR UPDATE SKIP LOCKED
        """))
        item = result.mappings().one_or_none()
        if item is None:
            return False
        payload = item["payload"]
        await exchange.publish(aio_pika.Message(
            json.dumps(payload).encode(),
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            message_id=str(item["event_id"]),
            correlation_id=payload["request_id"],
        ), routing_key=item["event_type"], mandatory=True, timeout=5)
        await connection.execute(text(f"DELETE FROM {schema}.outbox WHERE event_id = :id"),
                                 {"id": item["event_id"]})
    return True


async def run_broker(
    database: AsyncEngine,
    queue_name: str,
    handle: Callable[[Event], Awaitable[None]],
    outbox_schema: str | None = None,
) -> None:
    async def receive(message: AbstractIncomingMessage) -> None:
        try:
            event = Event.model_validate_json(message.body)
            if event.event_type != message.routing_key:
                raise ValueError("Unexpected event routing key")
        except (ValidationError, ValueError):
            LOG.warning("Discarded invalid document lifecycle message")
            await message.reject(requeue=False)
            return
        try:
            await handle(event)
        except Exception:
            LOG.warning("Retrying lifecycle event %s", event.event_id)
            await asyncio.sleep(2)
            await message.nack(requeue=True)
        else:
            await message.ack()

    delay = 1
    while True:
        try:
            connection = await aio_pika.connect(
                host="rabbitmq", virtualhost="rag-documents",
                login=os.environ["BROKER_USER"], password=os.environ["BROKER_PASSWORD"],
                timeout=5,
            )
            async with connection:
                channel = await connection.channel(publisher_confirms=True, on_return_raises=True)
                await channel.set_qos(prefetch_count=1)
                queue = await channel.get_queue(queue_name, ensure=False)
                await queue.consume(receive)
                exchange = await channel.get_exchange(EXCHANGE, ensure=False)
                delay = 1
                while not channel.is_closed:
                    sent = bool(outbox_schema and await publish_one(database, outbox_schema, exchange))
                    if not sent:
                        await asyncio.sleep(0.5)
        except Exception as exc:
            LOG.warning("Lifecycle broker unavailable (%s)", type(exc).__name__)
        await asyncio.sleep(delay)
        delay = min(delay * 2, 30)
