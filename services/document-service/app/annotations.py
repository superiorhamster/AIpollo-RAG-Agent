"""Validated personal annotations; independent of PDF engine object identities."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator

Coordinate = Annotated[FiniteFloat, Field(ge=0, le=1_000_000)]
Region = tuple[FiniteFloat, FiniteFloat, FiniteFloat, FiniteFloat]

class Point(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: Coordinate
    y: Coordinate

class Box(Point):
    width: Annotated[FiniteFloat, Field(gt=0, le=1_000_000)]
    height: Annotated[FiniteFloat, Field(gt=0, le=1_000_000)]

class Quad(BaseModel):
    model_config = ConfigDict(extra="forbid")
    upperLeft: Point
    upperRight: Point
    lowerLeft: Point
    lowerRight: Point

class EmbedSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    subtype: Literal["highlight", "text", "square"]
    rect: Box
    quadPoints: list[Quad] = Field(default_factory=list, max_length=128)
    color: str = Field(default="#ffcf40", pattern=r"^#[0-9a-fA-F]{6}$")
    opacity: Annotated[FiniteFloat, Field(ge=0, le=1)] = 0.4

    @model_validator(mode="after")
    def markup_geometry(self) -> "EmbedSnapshot":
        if self.subtype == "highlight" and not self.quadPoints:
            raise ValueError("A text highlight requires its text quadrilaterals")
        return self

class AnnotationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page: int = Field(ge=1, le=100_000)
    body: str = Field(default="", max_length=3000)
    region: Region | None = None
    regions: list[Region] = Field(default_factory=list, max_length=128)
    embedpdf: EmbedSnapshot | None = None

    @model_validator(mode="after")
    def require_content(self) -> "AnnotationInput":
        if self.regions:
            self.region = (min(r[0] for r in self.regions), min(r[1] for r in self.regions),
                           max(r[2] for r in self.regions), max(r[3] for r in self.regions))
        for left, top, right, bottom in self.regions + ([self.region] if self.region else []):
            if not (0 <= left < right <= 1 and 0 <= top < bottom <= 1):
                raise ValueError("The region must be a valid normalized rectangle")
        self.body = self.body.strip()
        if not self.body and self.region is None:
            raise ValueError("Add a note or a highlight")
        return self
