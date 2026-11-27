"""Owner-scoped, deterministic Learning Plan persistence."""

import hashlib
import json
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from rag_http import ApiError

from .learning_blueprint import BlueprintDraft, BlueprintError, content_snapshot, materialize

PLAN_FIELDS = "plan_id, content_version, state_revision, blueprint, updated_at"
PLAN_SCOPE = "workspace_id=:workspace AND owner_id=:owner AND plan_id=:plan AND deleted_at IS NULL"


class SelectionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selected_plan_id: UUID | None
    selection_revision: int = Field(strict=True, ge=0)


class CardDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: Literal["accepted", "rejected"]


async def read_card(connection: AsyncConnection, scope: dict) -> dict:
    cursor = await connection.execute(text("""
        SELECT card_id, plan_id, kind, base_revision, payload, status
        FROM orchestration.learning_plan_cards
        WHERE workspace_id=:workspace AND owner_id=:owner AND card_id=:card
    """), scope)
    card = cursor.mappings().one_or_none()
    if card is None:
        raise ApiError(404, "not_found", "Learning Plan card is unavailable.")
    return dict(card)


async def decide_card(connection: AsyncConnection, scope: dict, data: CardDecision) -> dict:
    card = await read_card(connection, scope)
    keys = {**scope, "plan": card["plan_id"]}
    plan = await read_learning_plan(connection, keys, lock=True)
    card = await read_card(connection, scope)
    if card["status"] == data.outcome:
        return card
    if card["status"] != "pending" or card["base_revision"] != plan["state_revision"]:
        raise ApiError(409, "stale_learning_card", "This Learning Plan suggestion is no longer current.")
    await connection.execute(text("""
        UPDATE orchestration.learning_plan_cards SET status=:outcome
        WHERE workspace_id=:workspace AND owner_id=:owner AND card_id=:card
    """), {**keys, "outcome": data.outcome})
    if data.outcome == "accepted":
        blueprint = card["payload"]["proposal"]
        plan = await revise_learning_plan(connection, keys, plan["state_revision"], None,
                                          validated_blueprint=blueprint)
    await connection.execute(text("""
        INSERT INTO orchestration.learning_plan_events
            (workspace_id, owner_id, event_id, plan_id, kind, state_revision, metadata)
        VALUES (:workspace, :owner, gen_random_uuid(), :plan, :kind, :revision,
                jsonb_build_object('card_id', CAST(:card AS uuid)))
    """), {**keys, "kind": "card_" + data.outcome, "revision": plan["state_revision"]})
    return {**card, "status": data.outcome}


async def store_card(connection: AsyncConnection, scope: dict, revision: int, kind: str, payload: dict) -> UUID:
    plan = await read_learning_plan(connection, scope, lock=True)
    if plan["state_revision"] != revision:
        raise ApiError(409, "stale_learning_plan", "The Learning Plan changed before publication.")
    identifier = uuid4()
    await connection.execute(text("""
        INSERT INTO orchestration.learning_plan_cards
            (workspace_id, owner_id, plan_id, card_id, kind, base_revision, payload)
        VALUES (:workspace, :owner, :plan, :card, :kind, :revision, CAST(:payload AS jsonb))
    """), {**scope, "card": identifier, "kind": kind, "revision": revision, "payload": json.dumps(payload)})
    return identifier


async def read_selection(connection: AsyncConnection, scope: dict) -> dict:
    rows = await connection.execute(text("""
        SELECT plan.plan_id AS selected_plan_id, chat.selection_revision,
               (chat.selected_learning_plan_id IS NOT NULL AND plan.plan_id IS NULL) AS unavailable
        FROM orchestration.conversations chat
        LEFT JOIN orchestration.learning_plans plan
          ON plan.workspace_id=chat.workspace_id AND plan.owner_id=chat.user_id
         AND plan.plan_id=chat.selected_learning_plan_id AND plan.deleted_at IS NULL
        WHERE chat.workspace_id=:workspace AND chat.user_id=:owner AND chat.conversation_id=:conversation
    """), scope)
    selection = rows.mappings().one_or_none()
    if selection is None:
        raise ApiError(404, "not_found", "Conversation is unavailable.")
    return dict(selection)


async def update_selection(connection: AsyncConnection, scope: dict, data: SelectionUpdate) -> dict:
    current = await read_selection(connection, scope)
    if current["selection_revision"] != data.selection_revision:
        raise ApiError(409, "stale_plan_selection", "Reload the conversation selection.")
    if data.selected_plan_id is not None:
        await read_learning_plan(connection, {**scope, "plan": data.selected_plan_id}, lock=True)
    result = await connection.execute(text("""
        UPDATE orchestration.conversations
        SET selected_learning_plan_id=:plan, selection_revision=selection_revision+1
        WHERE workspace_id=:workspace AND user_id=:owner AND conversation_id=:conversation
          AND selection_revision=:revision
        RETURNING selected_learning_plan_id AS selected_plan_id, selection_revision, false AS unavailable
    """), {**scope, "plan": data.selected_plan_id, "revision": data.selection_revision})
    selection = result.mappings().one_or_none()
    if selection is None:
        raise ApiError(409, "stale_plan_selection", "Reload the conversation selection.")
    return dict(selection)


async def read_learning_plans(connection: AsyncConnection, workspace: UUID, owner: UUID) -> list[dict]:
    rows = await connection.execute(text(f"""
        SELECT {PLAN_FIELDS} FROM orchestration.learning_plans
        WHERE workspace_id=:workspace AND owner_id=:owner AND deleted_at IS NULL
        ORDER BY updated_at DESC, plan_id
    """), {"workspace": workspace, "owner": owner})
    return [dict(row) for row in rows.mappings()]


async def create_learning_plan(
    connection: AsyncConnection, workspace: UUID, owner: UUID, key: UUID, draft: BlueprintDraft
) -> dict:
    identity = {"workspace": workspace, "owner": owner, "key": key}
    request_hash = hashlib.sha256(draft.model_dump_json().encode()).hexdigest()
    await connection.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:scope, 5007))"), {
        "scope": f"{workspace}:{owner}:{key}",
    })
    existing = await connection.execute(text(f"""
        SELECT {PLAN_FIELDS}, create_hash, deleted_at FROM orchestration.learning_plans
        WHERE workspace_id=:workspace AND owner_id=:owner AND create_key=:key
    """), identity)
    replay = existing.mappings().one_or_none()
    if replay is not None:
        if replay["deleted_at"] is not None:
            raise ApiError(404, "not_found", "Learning Plan is unavailable.")
        if replay["create_hash"] != request_hash:
            raise ApiError(409, "idempotency_conflict", "The request key is already used.")
        return {field: replay[field] for field in PLAN_FIELDS.split(", ")}
    try:
        blueprint = materialize(draft)
    except BlueprintError as exc:
        raise ApiError(422, exc.code, "The Learning Plan blueprint is invalid.") from exc
    values = {
        **identity, "plan": uuid4(), "event": uuid4(), "hash": request_hash,
        "blueprint": json.dumps(blueprint), "content": json.dumps(content_snapshot(blueprint)),
        "title": blueprint["title"],
    }
    row = await connection.execute(text(f"""
        INSERT INTO orchestration.learning_plans
            (workspace_id, owner_id, plan_id, create_key, create_hash, blueprint)
        VALUES (:workspace, :owner, :plan, :key, :hash, CAST(:blueprint AS jsonb))
        RETURNING {PLAN_FIELDS}
    """), values)
    await connection.execute(text("""
        INSERT INTO orchestration.learning_plan_versions
            (workspace_id, owner_id, plan_id, content_version, content)
        VALUES (:workspace, :owner, :plan, 1, CAST(:content AS jsonb))
    """), values)
    await connection.execute(text("""
        INSERT INTO orchestration.learning_plan_events
            (workspace_id, owner_id, event_id, plan_id, kind, state_revision, metadata)
        VALUES (:workspace, :owner, :event, :plan, 'created', 1,
                jsonb_build_object('content_version', 1, 'title', CAST(:title AS text)))
    """), values)
    return dict(row.mappings().one())


async def read_learning_plan(connection: AsyncConnection, scope: dict, *, lock: bool = False) -> dict:
    locking = " FOR UPDATE" if lock else ""
    rows = await connection.execute(text(f"""
        SELECT {PLAN_FIELDS} FROM orchestration.learning_plans WHERE {PLAN_SCOPE}{locking}
    """), scope)
    current = rows.mappings().one_or_none()
    if current is None:
        raise ApiError(404, "not_found", "Learning Plan is unavailable.")
    return dict(current)


async def revise_learning_plan(
    connection: AsyncConnection, scope: dict, revision: int, draft: BlueprintDraft | None,
    *, validated_blueprint: dict | None = None,
) -> dict:
    current = await read_learning_plan(connection, scope, lock=True)
    if current["state_revision"] != revision:
        raise ApiError(409, "stale_learning_plan", "Reload the Learning Plan before trying again.")
    base = current["blueprint"]
    try:
        blueprint = validated_blueprint if validated_blueprint is not None else (
            materialize(draft, base) if draft is not None else base
        )
    except BlueprintError as exc:
        raise ApiError(422, exc.code, "The Learning Plan blueprint is invalid.") from exc
    deleted = draft is None and validated_blueprint is None
    if not deleted and blueprint == base:
        return current

    content = content_snapshot(blueprint)
    content_changed = content != content_snapshot(base)
    kind = "deleted" if deleted else "edited" if content_changed else "progress_changed"
    previous_progress = {item["id"]: item["progress"] for item in base["objectives"]}
    progress = [{"objective_id": item["id"], "progress": item["progress"]} for item in blueprint["objectives"]
                if item["id"] in previous_progress and item["progress"] != previous_progress[item["id"]]]
    values = {
        **scope, "blueprint": json.dumps(blueprint), "content": json.dumps(content),
        "version": current["content_version"] + int(content_changed), "revision": revision + 1,
        "deleted": deleted, "kind": kind, "event": uuid4(),
        "event_metadata": json.dumps({
            "content_version": current["content_version"] + int(content_changed),
            "title": blueprint["title"], "progress": progress,
        }),
    }
    result = await connection.execute(text(f"""
        UPDATE orchestration.learning_plans SET blueprint=CAST(:blueprint AS jsonb),
            content_version=:version, state_revision=:revision, updated_at=now(),
            deleted_at=CASE WHEN :deleted THEN now() ELSE NULL END
        WHERE {PLAN_SCOPE} RETURNING {PLAN_FIELDS}
    """), values)
    if content_changed:
        await connection.execute(text("""
            INSERT INTO orchestration.learning_plan_versions
                (workspace_id, owner_id, plan_id, content_version, content)
            VALUES (:workspace, :owner, :plan, :version, CAST(:content AS jsonb))
        """), values)
    await connection.execute(text("""
        INSERT INTO orchestration.learning_plan_events
            (workspace_id, owner_id, event_id, plan_id, kind, state_revision, metadata)
        VALUES (:workspace, :owner, :event, :plan, :kind, :revision,
                CAST(:event_metadata AS jsonb))
    """), values)
    await connection.execute(text("""
        WITH invalidated AS (
            UPDATE orchestration.learning_plan_cards SET status='invalidated'
            WHERE workspace_id=:workspace AND owner_id=:owner AND plan_id=:plan AND status='pending'
            RETURNING card_id
        )
        INSERT INTO orchestration.learning_plan_events
            (workspace_id, owner_id, event_id, plan_id, kind, state_revision, metadata)
        SELECT :workspace, :owner, gen_random_uuid(), :plan, 'card_invalidated', :revision,
               jsonb_build_object('card_id', card_id)
        FROM invalidated
    """), values)
    return dict(result.mappings().one())
