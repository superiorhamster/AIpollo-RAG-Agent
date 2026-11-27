"""Canonical Learning Plan admission shared by manual and generated writes."""

import json
from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

BLUEPRINT_LIMIT = 9 * 1024
RequiredText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Day = Annotated[int, Field(strict=True, ge=1, le=7)]
Progress = Literal["pending", "completed"]


class ObjectiveDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID | None = None
    day: Day
    goal: RequiredText
    activities: list[RequiredText]
    progress: Progress = "pending"


class BlueprintDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: RequiredText
    days: Day
    objectives: list[ObjectiveDraft] = Field(min_length=1)


class PlanRevision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int = Field(strict=True, ge=1)


class PlanUpdate(PlanRevision):
    blueprint: BlueprintDraft


class BlueprintError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def canonical_bytes(blueprint: dict) -> bytes:
    return json.dumps(blueprint, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


def materialize(draft: BlueprintDraft, base: dict | None = None) -> dict:
    """Preserve known objective identity and initialize server-assigned objectives."""
    known = {item["id"] for item in base["objectives"]} if base else set()
    seen = set()
    days = set()
    blueprint = draft.model_dump(mode="json")
    for objective in blueprint["objectives"]:
        identifier = objective["id"]
        if identifier is None:
            identifier = str(uuid4())
            objective.update(id=identifier, progress="pending")
        elif identifier not in known or identifier in seen:
            raise BlueprintError("invalid_objective_identity")
        seen.add(identifier)
        days.add(objective["day"])
    if days != set(range(1, draft.days + 1)):
        raise BlueprintError("invalid_day_coverage")
    if len(canonical_bytes(blueprint)) > BLUEPRINT_LIMIT:
        raise BlueprintError("blueprint_capacity_exceeded")
    return blueprint


def content_snapshot(blueprint: dict) -> dict:
    """Persist content versions independently of progress-only changes."""
    return {
        **blueprint,
        "objectives": [
            {key: value for key, value in objective.items() if key != "progress"}
            for objective in blueprint["objectives"]
        ],
    }
