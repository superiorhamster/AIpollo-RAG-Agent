"""Inputs and result validation for the workspace interaction API."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

from rag_index import Chunk, SourceSelection

Capability = Literal["LEARN", "RESEARCH", "WRITE"]
Task = Literal[
    "answer", "explanation", "study_guide", "quiz", "flashcards", "mind_map",
    "comparison", "screening", "extraction", "evidence_table", "synthesis",
    "draft", "rewrite", "summary", "citation_review",
]
TASKS = {
    "LEARN": {"answer", "explanation", "study_guide", "quiz", "flashcards", "mind_map"},
    "RESEARCH": {"answer", "comparison", "screening", "extraction", "evidence_table", "synthesis"},
    "WRITE": {"answer", "draft", "rewrite", "summary", "citation_review"},
}
Query = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=1800)]


class Objective(SourceSelection):
    query: Query
    capability: Capability = "LEARN"
    task: Task = "answer"

    @model_validator(mode="after")
    def valid_capability(self):
        if self.task not in TASKS[self.capability]:
            raise ValueError("Choose a task for the selected capability")
        return self


class EditPlan(Objective):
    expected_version: int = Field(ge=1)


class Version(BaseModel):
    plan_version: int = Field(ge=1)


class StartRun(BaseModel):
    mode: Literal["ASK", "AGENT", "PLAN"]
    objective: Objective | None = None
    plan_id: UUID | None = None
    plan_version: int | None = Field(default=None, ge=1)
    conversation_id: UUID | None = None

    @model_validator(mode="after")
    def require_mode_inputs(self):
        if self.mode == "PLAN":
            if self.plan_id is None or self.plan_version is None or self.objective is not None:
                raise ValueError("Plan runs require a plan and version")
        elif self.objective is None or self.plan_id is not None or self.plan_version is not None:
            raise ValueError("Direct runs require an objective")
        if self.mode != "ASK" and self.conversation_id is not None:
            raise ValueError("Only Ask accepts a conversation")
        return self


FIELD_KEYS = {
    "quiz": {"question", "options", "answer"},
    "flashcards": {"front", "back"},
    "mind_map": {"parent", "child", "relationship"},
    "screening": {"source", "decision", "reason"},
    "extraction": {"source", "field", "value"},
    "evidence_table": {"source", "method", "outcome", "limitations"},
}
FieldText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=600)]


class Claim(BaseModel):
    text: str = Field(min_length=1, max_length=1800)
    evidence: list[UUID] = Field(min_length=1, max_length=6)
    fields: dict[FieldText, FieldText] = Field(default_factory=dict, max_length=12)


class GeneratedAnswer(BaseModel):
    claims: list[Claim] = Field(max_length=12)

class Citation(Chunk):
    document_id: UUID
    chunk_id: UUID
    name: str


class CitedClaim(BaseModel):
    text: str
    fields: dict[FieldText, FieldText] = Field(default_factory=dict)
    citations: list[Citation]


class Answer(BaseModel):
    kind: Task = "answer"
    claims: list[CitedClaim]
    insufficient_evidence: bool


class RunView(BaseModel):
    run_id: UUID
    interaction: Literal["ASK", "AGENT", "PLAN"]
    conversation_id: UUID | None
    plan_id: UUID | None
    plan_version: int | None
    request_id: UUID
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    step: str | None
    result: Answer | None
    error_code: str | None
    query: str
    created_at: datetime
    updated_at: datetime


class Step(BaseModel):
    tool: str
    action: str


class PlanView(BaseModel):
    plan_id: UUID
    plan_version: int
    objective: Objective
    accepted_at: datetime | None
    state: Literal["REVIEW", "ACCEPTED", "CANCELLED"]
    steps: list[Step]
    expected_outputs: list[str]


class Conversation(BaseModel):
    conversation_id: UUID
    created_at: datetime
    name: str
