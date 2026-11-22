"""Inputs and result validation for the workspace interaction API."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator, model_serializer

from rag_index import Chunk, SourceSelection

Capability = Literal["LEARN", "RESEARCH", "WRITE"]
Task = Literal[
    "answer", "explanation", "study_guide", "quiz", "flashcards", "mind_map", "socratic_tutor",
    "comparison", "screening", "extraction", "evidence_table", "synthesis",
    "draft", "rewrite", "summary", "citation_review",
]
TASKS = {
    "LEARN": {"socratic_tutor", "answer", "explanation", "study_guide", "quiz", "flashcards", "mind_map"},
    "RESEARCH": {"answer", "comparison", "screening", "extraction", "evidence_table", "synthesis"},
    "WRITE": {"answer", "draft", "rewrite", "summary", "citation_review"},
}
Query = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=1800)]


class Objective(SourceSelection):
    query: Query
    capability: Capability = "LEARN"
    task: Task = "answer"
    tutor_action: Literal["guide", "hint", "solution"] | None = None

    @model_serializer(mode="wrap")
    def serialize_objective(self, handler):
        data = handler(self)
        if self.tutor_action is None:
            data.pop("tutor_action", None)
        return data

    @model_validator(mode="after")
    def valid_capability(self):
        if self.tutor_action is not None and self.task != "socratic_tutor":
            raise ValueError("Tutor actions require the Socratic task")
        if self.task not in TASKS[self.capability]:
            raise ValueError("Choose a task for the selected capability")
        return self


class WorkflowStep(BaseModel, extra="forbid"):
    step_id: UUID
    tool: Literal["retrieve", "compose"]
    action: str = Field(min_length=2, max_length=600)
    objective: Objective
    expected_output: str = Field(min_length=2, max_length=600)


class PlanDefinition(Objective):
    steps: list[WorkflowStep] | None = Field(default=None, min_length=1, max_length=6)

    @model_validator(mode="after")
    def validate_steps(self):
        if self.task == "socratic_tutor" or any(step.objective.task == "socratic_tutor" for step in self.steps or []):
            raise ValueError("Socratic tutoring requires an Ask conversation")
        if self.steps is None:
            return self
        if len({step.step_id for step in self.steps}) != len(self.steps):
            raise ValueError("Step IDs must be unique")
        for step in self.steps:
            if step.objective.capability != self.capability:
                raise ValueError("Step capability must match the plan")
            if not set(step.objective.document_ids).issubset(self.document_ids):
                raise ValueError("Step sources must belong to the plan")
        if self.steps[-1].tool != "compose":
            raise ValueError("A workflow must finish with a composed output")
        return self


class EditPlan(PlanDefinition):
    expected_version: int = Field(ge=1)


class Version(BaseModel):
    plan_version: int = Field(ge=1)


class StartRun(BaseModel):
    mode: Literal["ASK", "AGENT", "PLAN"]
    objective: Objective | None = None
    plan_id: UUID | None = None
    plan_version: int | None = Field(default=None, ge=1)
    conversation_id: UUID | None = None
    retry_of_run_id: UUID | None = None

    @model_validator(mode="after")
    def require_mode_inputs(self):
        if self.mode == "PLAN":
            if self.plan_id is None or self.plan_version is None or self.objective is not None:
                raise ValueError("Plan runs require a plan and version")
        elif self.objective is None or self.plan_id is not None or self.plan_version is not None:
            raise ValueError("Direct runs require an objective")
        if self.objective and self.objective.task == "socratic_tutor" and self.mode != "ASK":
            raise ValueError("Socratic tutoring requires Ask mode")
        if self.mode != "ASK" and self.conversation_id is not None:
            raise ValueError("Only Ask accepts a conversation")
        if self.mode != "ASK" and self.retry_of_run_id is not None:
            raise ValueError("Only Ask accepts a retry parent")
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


class AskClaim(Claim):
    evidence: list[UUID] = Field(max_length=6)
    source: Literal["document", "conversation"] = "document"

    @model_validator(mode="after")
    def validate_provenance(self):
        if bool(self.evidence) != (self.source == "document"):
            raise ValueError("Only document claims require evidence, and chat claims must have none")
        return self


class GeneratedAskAnswer(BaseModel):
    claims: list[AskClaim] = Field(max_length=12)


class GeneratedTutorAnswer(GeneratedAskAnswer):
    question: str | None = Field(default=None, min_length=2, max_length=600)


class SearchRewrite(BaseModel, extra="forbid"):
    query: Query


class Citation(Chunk):
    document_id: UUID
    chunk_id: UUID
    name: str


class CitedClaim(BaseModel):
    text: str
    fields: dict[FieldText, FieldText] = Field(default_factory=dict)
    citations: list[Citation]
    source: Literal["document", "conversation"] = "document"


class Answer(BaseModel):
    tutor_question: str | None = None
    kind: Task = "answer"
    claims: list[CitedClaim]
    insufficient_evidence: bool


class RunView(BaseModel):
    run_id: UUID
    retry_of_run_id: UUID | None = None
    interaction: Literal["ASK", "AGENT", "PLAN"]
    conversation_id: UUID | None
    plan_id: UUID | None
    plan_version: int | None
    request_id: UUID
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    step: str | None
    result: Answer | None
    error_code: str | None
    retryable: bool = False
    objective: Objective | None = None
    query: str
    created_at: datetime
    updated_at: datetime


class StepResult(BaseModel):
    cost: int = Field(ge=0)
    answer: Answer | None = None
    evidence: list[Citation] | None = None


class RunStepView(BaseModel):
    step_id: UUID
    position: int = Field(ge=0, le=5)
    status: Literal["running", "succeeded"]
    result: StepResult | None
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
    steps: list[Step | WorkflowStep]
    expected_outputs: list[str]


class Conversation(BaseModel):
    conversation_id: UUID
    created_at: datetime
    name: str
