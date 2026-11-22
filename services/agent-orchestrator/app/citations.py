"""Citation representations and bounded attribution for Ask."""

import json
from collections import Counter
from itertools import groupby
from uuid import UUID, uuid5

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .generation import json_output


def encode(value):
    return json.dumps(value, ensure_ascii=False)


def legacy(item):
    return {key: item[key] for key in ("chunk_id", "document_id", "name", "text", "page", "section", "region")
            if key in item} | {"segment_ids": None}


def labels(item):
    return [{"id": segment["id"], "text": item["text"][segment["start"]:segment["end"]]}
            for segment in item.get("citation_segments_v1") or []]


def merge_boxes(boxes):
    merged = []
    for l, t, r, b in sorted(set(map(tuple, boxes)), key=lambda box: (box[1], box[0], box[3], box[2])):
        for index, (a, c, d, e) in enumerate(merged):
            height = min(b - t, e - c)
            if min(b, e) - max(t, c) >= .7 * height and max(l, a) - min(r, d) <= .5 * height:
                merged[index] = (min(a, l), min(c, t), max(d, r), max(e, b))
                break
        else:
            merged.append((l, t, r, b))
    return merged


def anchors(item, selected):
    segments = [seg for seg in item["citation_segments_v1"] if seg["id"] in selected]
    results = []
    for _, parts in groupby(enumerate(segments), lambda row: (
            row[1]["ordinal"] - row[0], row[1]["page"], row[1]["precision"])):
        group = [segment for _, segment in parts]
        identifiers = [segment["id"] for segment in group]
        precision = group[0]["precision"]
        boxes = merge_boxes(box for segment in group for box in segment["rects"])
        if len(boxes) > 16:
            boxes, precision = [], "page"
        results.append(legacy(item) | {
            "page": group[0]["page"],
            "text": item["text"][group[0]["start"]:group[-1]["end"]],
            "region": boxes[0] if len(boxes) == 1 else None,
            "regions": boxes, "precision": precision, "segment_ids": identifiers,
            "citation_id": str(uuid5(UUID(item["chunk_id"]), "citation:v1:" + ",".join(identifiers))),
        })
    return results


def resolve(ids, allowlist):
    ordered = {}
    for identifier in ids:
        item, is_segment = allowlist[identifier]
        key = item["chunk_id"], is_segment
        ordered.setdefault(key, (item, []))[1].append(identifier)
    return [citation for (_, is_segment), (item, selected) in ordered.items()
            for citation in (anchors(item, selected) if is_segment else [legacy(item)])]


def attribution_input(claims, evidence, fits):
    parents = {}
    targets = []
    lookup = {}
    for ci, claim in enumerate(claims):
        for pi, citation in enumerate(claim["citations"]):
            parent = citation["chunk_id"]
            item = evidence[parent]
            segments = labels(item)
            if not segments:
                continue
            target = f"c{ci}:p{pi}"
            row = {"target": target, "claim": claim["text"], "parent": parent}
            candidate = {"parents": parents | {parent: segments}, "targets": targets + [row]}
            if not fits(encode(candidate)):
                continue
            parents, targets = candidate["parents"], candidate["targets"]
            lookup[target] = (ci, pi, item, {part["id"] for part in segments})
    return encode({"parents": parents, "targets": targets}), lookup


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target: str
    segment_ids: list[UUID] | None = Field(max_length=6)


def attributed(claims, output, lookup):
    envelope = json.loads(json_output(output))
    if not isinstance(envelope, dict) or set(envelope) != {"attributions"}:
        raise ValueError("Invalid attribution envelope")
    records = envelope["attributions"]
    if not isinstance(records, list):
        raise ValueError("Invalid attributions")
    counts = Counter(row["target"] for row in records if isinstance(row, dict)
                     and isinstance(row.get("target"), str))
    valid = {}
    for row in records:
        try:
            selection = Selection.model_validate(row)
        except ValidationError:
            continue
        if selection.target not in lookup or counts[selection.target] != 1 or not selection.segment_ids:
            continue
        ci, pi, item, allowed = lookup[selection.target]
        ids = {str(identifier) for identifier in selection.segment_ids}
        if ids <= allowed:
            valid[ci, pi] = item, ids
    result = []
    for ci, claim in enumerate(claims):
        citations = []
        total = len(claim["citations"])
        for pi, original in enumerate(claim["citations"]):
            match = valid.get((ci, pi))
            if match and total + len(match[1]) - 1 <= 6:
                item, ids = match
                total += len(ids) - 1
                citations.extend(anchors(item, ids))
            else:
                citations.append(original)
        result.append(claim | {"citations": citations})
    return result
