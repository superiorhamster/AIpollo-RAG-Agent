"""Keep each indexed passage on a single page of the displayed PDF."""

import re
from collections.abc import Iterable, Iterator

from rag_index import Chunk

CHUNK_SIZE = 1500


def passages(text: str) -> Iterator[str]:
    remaining = "\n".join(" ".join(line.split()) for line in text.splitlines() if line.strip())
    while len(remaining) > CHUNK_SIZE:
        split = max(
            remaining.rfind(" ", CHUNK_SIZE // 2, CHUNK_SIZE + 1),
            remaining.rfind("\n", CHUNK_SIZE // 2, CHUNK_SIZE + 1),
        )
        if split < 0:
            split = CHUNK_SIZE
        yield remaining[:split]
        remaining = remaining[split:].lstrip()
    if remaining:
        yield remaining


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


def group_blocks(blocks: Iterable[Chunk]) -> Iterator[Chunk]:
    pending: list[Chunk] = []
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


def join_blocks(blocks: list[Chunk]) -> Chunk:
    first = blocks[0]
    return Chunk(
        page=first.page, section=first.section, text="\n".join(block.text for block in blocks),
        region=regions_union(block.region for block in blocks),
    )


def heading(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()[:300]
