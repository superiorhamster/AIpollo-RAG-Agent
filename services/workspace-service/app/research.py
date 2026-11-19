"""Normalize Crossref bibliographic records and export stable BibTeX."""

from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class Discovery(BaseModel):
    query: Short


class Reference(BaseModel):
    doi: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=220,
                                          pattern=r"^10\.[0-9]{4,9}/[^ \x00-\x1f]+$")]
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=600)]
    authors: list[Short] = Field(default_factory=list, max_length=35)
    publication_year: int | None = Field(default=None, ge=1500, le=2200)
    tags: list[Short] = Field(default_factory=list, max_length=12)


def normalize(entry: dict) -> Reference:
    year = (entry.get("issued") or {}).get("date-parts", [[]])[0]
    return Reference(
        doi=entry["DOI"], title=(entry.get("title") or [entry["DOI"]])[0][:600],
        authors=[
            name[:200] for person in (entry.get("author") or [])[:35]
            if (name := " ".join(part for part in (person.get("given"), person.get("family")) if part).strip())
        ],
        publication_year=year[0] if year and 1500 <= year[0] <= 2200 else None,
    )


def bibtex(refs: list[Reference]) -> str:
    def escape(value: str) -> str:
        return "".join({"\\": r"\textbackslash{}", "{": r"\{", "}": r"\}", "\n": " ",
                        "%": r"\%", "&": r"\&", "_": r"\_"}.get(char, char) for char in value)

    records = []
    for index, item in enumerate(refs, start=1):
        fields = {"title": item.title, "doi": item.doi, "author": " and ".join(item.authors)}
        if item.publication_year:
            fields["year"] = str(item.publication_year)
        body = ",\n".join(f"  {name} = {{{escape(value)}}}" for name, value in fields.items() if value)
        records.append("@article{source" + str(index) + ",\n" + body + "\n}")
    return "\n\n".join(records) + "\n"
