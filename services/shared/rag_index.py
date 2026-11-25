"""Internal transport models for document indexing."""

from typing import Annotated, Literal
from uuid import UUID, uuid5

from pydantic import BaseModel, Field, FiniteFloat, StringConstraints

MAX_CHUNKS = 2000
EMBED_BATCH = 16
MAX_DIMENSIONS = 4096
MAX_PDF_BYTES = 25 * 1024 * 1024
Fingerprint = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
Text = Annotated[str, StringConstraints(min_length=1, max_length=1800)]
Vector = Annotated[list[FiniteFloat], Field(min_length=1, max_length=MAX_DIMENSIONS)]


Region = tuple[FiniteFloat, FiniteFloat, FiniteFloat, FiniteFloat]


class Segment(BaseModel):
    id: UUID | None = None
    ordinal: int = Field(default=0, ge=0, lt=32)
    start: int = Field(ge=0)
    end: int = Field(gt=0)
    page: int = Field(ge=1, le=300)
    partial: bool = False
    precision: Literal["line", "coarse", "page"] = "page"
    rects: list[Region] = Field(default_factory=list, max_length=8)


def point_id(generation: UUID, ordinal: int) -> UUID:
    return uuid5(generation, str(ordinal))


def segment_id(parent: UUID, ordinal: int) -> UUID:
    return uuid5(parent, f"sentence:v1:{ordinal}")


class Chunk(BaseModel):
    page: int = Field(ge=1, le=300)
    section: str = Field(default="", max_length=300)
    text: Text
    region: Region | None = None


class IndexedChunk(Chunk):
    citation_segments_v1: list[Segment] | None = Field(default=None, max_length=32)


class EmbeddingConfig(BaseModel):
    fingerprint: Fingerprint
    dimensions: int = Field(ge=1, le=MAX_DIMENSIONS)


class EmbeddingBatch(BaseModel):
    texts: list[Text] = Field(min_length=1, max_length=EMBED_BATCH)
    fingerprint: Fingerprint
    input_type: Literal["document", "query"] = "document"


class EmbeddingResult(BaseModel):
    vectors: list[Vector] = Field(min_length=1, max_length=EMBED_BATCH)


class IndexBatch(BaseModel):
    config: EmbeddingConfig
    generation: UUID
    offset: int = Field(ge=0, lt=MAX_CHUNKS)
    chunks: list[IndexedChunk] = Field(min_length=1, max_length=EMBED_BATCH)
    vectors: list[Vector] = Field(min_length=1, max_length=EMBED_BATCH)


class SourceSelection(BaseModel):
    document_ids: list[UUID] = Field(min_length=1, max_length=100)


class GenerationSelection(SourceSelection):
    fingerprint: Fingerprint


class ActiveIndex(BaseModel):
    document_id: UUID
    index_generation: UUID
