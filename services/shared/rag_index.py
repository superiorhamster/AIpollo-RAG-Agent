"""Internal transport models for document indexing."""

from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, FiniteFloat, StringConstraints

MAX_CHUNKS = 2000
EMBED_BATCH = 16
MAX_DIMENSIONS = 4096
MAX_PDF_BYTES = 25 * 1024 * 1024
Fingerprint = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
Text = Annotated[str, StringConstraints(min_length=1, max_length=1800)]
Vector = Annotated[list[FiniteFloat], Field(min_length=1, max_length=MAX_DIMENSIONS)]


class Chunk(BaseModel):
    page: int = Field(ge=1, le=300)
    section: str = Field(default="", max_length=300)
    text: Text
    region: tuple[FiniteFloat, FiniteFloat, FiniteFloat, FiniteFloat] | None = None


class EmbeddingConfig(BaseModel):
    fingerprint: Fingerprint
    dimensions: int = Field(ge=1, le=MAX_DIMENSIONS)


class EmbeddingBatch(BaseModel):
    texts: list[Text] = Field(min_length=1, max_length=EMBED_BATCH)
    fingerprint: Fingerprint


class EmbeddingResult(BaseModel):
    vectors: list[Vector] = Field(min_length=1, max_length=EMBED_BATCH)


class IndexBatch(BaseModel):
    config: EmbeddingConfig
    generation: UUID
    offset: int = Field(ge=0, lt=MAX_CHUNKS)
    chunks: list[Chunk] = Field(min_length=1, max_length=EMBED_BATCH)
    vectors: list[Vector] = Field(min_length=1, max_length=EMBED_BATCH)


class SourceSelection(BaseModel):
    document_ids: list[UUID] = Field(min_length=1, max_length=100)


class GenerationSelection(SourceSelection):
    fingerprint: Fingerprint


class ActiveIndex(BaseModel):
    document_id: UUID
    index_generation: UUID
