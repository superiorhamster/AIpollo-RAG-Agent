"""Keep each indexed passage on a single page of the displayed PDF."""

import re
from collections.abc import Iterable, Iterator

from rag_index import IndexedChunk

CHUNK_SIZE = 1500


def normalized(text: str) -> str:
    return "\n".join(" ".join(line.split()) for line in text.splitlines() if line.strip())


def passage_spans(text: str) -> Iterator[tuple[int, int]]:
    remaining = text
    offset = 0
    while len(remaining) > CHUNK_SIZE:
        split = max(
            remaining.rfind(" ", CHUNK_SIZE // 2, CHUNK_SIZE + 1),
            remaining.rfind("\n", CHUNK_SIZE // 2, CHUNK_SIZE + 1),
        )
        if split < 0:
            split = CHUNK_SIZE
        yield offset, offset + split
        tail = remaining[split:]
        remaining = tail.lstrip()
        offset += split + len(tail) - len(remaining)
    if remaining:
        yield offset, offset + len(remaining)


def passages(text: str) -> Iterator[str]:
    value = normalized(text)
    for start, end in passage_spans(value):
        yield value[start:end]


def regions_union(
    regions: Iterable[tuple[float, float, float, float] | None],
) -> tuple[float, float, float, float] | None:
    boxes = [region for region in regions if region is not None]
    if not boxes:
        return None
    return (
        min(box[0] for box in boxes), min(box[1] for box in boxes),
        max(box[2] for box in boxes), max(box[3] for box in boxes),
    )


def group_blocks(blocks: Iterable[IndexedChunk]) -> Iterator[IndexedChunk]:
    pending: list[IndexedChunk] = []
    length = 0
    for block in blocks:
        part_length = len(block.text)
        if pending and (
            block.page != pending[0].page
            or block.section != pending[0].section
            or length + part_length + 1 > CHUNK_SIZE
        ):
            yield join_blocks(pending)
            pending = []
            length = 0
        pending.append(block)
        length += part_length + 1
    if pending:
        yield join_blocks(pending)


def join_blocks(blocks: list[IndexedChunk]) -> IndexedChunk:
    first = blocks[0]
    offset = 0
    segments = []
    for block in blocks:
        if not block.citation_segments_v1:
            segments = []
            break
        for segment in block.citation_segments_v1:
            segments.append(segment.model_copy(update={
                "start": segment.start + offset, "end": segment.end + offset, "ordinal": len(segments),
            }))
        offset += len(block.text) + 1
    return IndexedChunk(
        citation_segments_v1=segments if 0 < len(segments) <= 32 else None,
        page=first.page, section=first.section, text="\n".join(block.text for block in blocks),
        region=regions_union(block.region for block in blocks),
    )


def heading(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()[:300]
