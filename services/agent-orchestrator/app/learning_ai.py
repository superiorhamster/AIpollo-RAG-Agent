"""Pack private plan context and validate model output before any write."""

import json
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError, WrapValidator

from .citations import resolve
from .generation import json_output
from .learning_blueprint import BlueprintDraft, materialize


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

PROMPTS = json.loads(Path(__file__).with_name("learning_prompt_bank.json").read_text(encoding="utf-8"))
answer_instructions, answer_examples = PROMPTS["answer"].split("\nExamples (data):\n", 1)
answer_demos = json.loads(answer_examples)
for example in answer_demos:
    output = example["output"]
    if output["suggestion"] is not None:
        output["readiness"] = "ready"
    example["input"] = {key: value for key, value in example["input"].items() if value != []}
answer_demos.append({
    "input": {"query": "Are two fractions equal just because their numerators match?",
              "source_state": "zero", "current_plan": None, "evidence": []},
    "output": {"claims": [{"text": "No. For example, 1/2 is greater than 1/3.",
                           "source": "general", "evidence": []}],
               "unsupported_parts": [], "suggestion": None, "readiness": "not_assessed"},
})
ANSWER_REFINEMENT = json.loads(Path(__file__).with_name("learning_answer_refinement.json").read_text(encoding="utf-8"))


def answer_prompt(with_plan: bool) -> str:
    refinement = ANSWER_REFINEMENT["with_plan" if with_plan else "without_plan"]
    selected_demo_plan = next(example["input"]["current_plan"] for example in answer_demos
                              if (example["input"].get("current_plan") or {}).get("id") == "P1")
    examples = []
    for example in answer_demos:
        context = {**example["input"]}
        plan = context.get("current_plan")
        if bool(plan) != with_plan:
            continue
        if plan == selected_demo_plan:
            context["current_plan"] = "P1"
        elif plan is None:
            context.pop("current_plan", None)
        examples.append({"input": context, "output": example["output"]})
    examples.extend({**example} for example in refinement["examples"])
    if with_plan:
        for example in examples:
            output = example["output"]
            example["output"] = {
                "readiness": output.get("readiness", "not_assessed"),
                "suggestion": output["suggestion"],
                "claims": output["claims"],
                "unsupported_parts": output["unsupported_parts"],
            }
        head = (
            answer_instructions + "\nOmitted example lists are empty.\n"
            'In examples only, omitted current_plan is null and "P1" stands for this full example plan: '
            + encode(selected_demo_plan) + "\n" + refinement["instructions"]
        )
    else:
        common = answer_instructions.split('\nReturn {"claims":', 1)[0]
        head = common + "\n" + refinement["instructions"]
    return head + "\nExamples (data):\n" + encode(examples) + "\n" + refinement["after_examples"]


ANSWER_PROMPTS = {False: answer_prompt(False), True: answer_prompt(True)}
BOUNDS = {"answer": (24000, 2048), "create": (24000, 3072), "edit": (32000, 4096)}
REPAIR = "\nReturn valid task JSON. Use only the supplied evidence labels and the permitted fields."


class ReplyClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=2400)
    source: Literal["document", "plan", "conversation", "general"]
    evidence: list[str] = Field(max_length=6)


def optional_suggestion(value, handler):
    try:
        return handler(value)
    except ValidationError:
        # A malformed optional card cannot invalidate a well-formed main answer.
        return None


class LearningAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    claims: list[ReplyClaim] = Field(max_length=20)
    unsupported_parts: list[Annotated[str, Field(max_length=800)]] = Field(max_length=10)
    suggestion: Annotated[UUID | None, WrapValidator(optional_suggestion)]
    readiness: Literal["ready", "not_ready", "not_assessed"] = "not_assessed"


class BlueprintReply(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reply: str = Field(min_length=1, max_length=1600)
    plan: BlueprintDraft | None


def pack(run, evidence, history):
    learning = run["input"]["learning"]
    task = learning["action"] or "answer"
    plan = learning["plan"]
    system = ANSWER_PROMPTS[bool(plan)] if task == "answer" else PROMPTS[task] + "\nMatch the current query's language."
    if task == "edit":
        system += (
            "\nFor a title-only edit, change just the title. Preserve the objective count, order, "
            "IDs, day assignments, progress and every activity string verbatim, including repeated activities."
        )
    cap, tokens = BOUNDS[task]
    if task == "answer" and plan is None:
        cap = 20000
    context = {
        "query": run["input"]["query"],
        "source_state": (
            "zero" if not run["input"]["document_ids"] else "found" if evidence else "empty"
        ),
        "current_plan": {**plan["blueprint"], "version": plan["content_version"]} if plan else None,
        "qa": [], "tagged": [], "events": [], "versions": [], "evidence": [],
    }
    if task == "create":
        context["duration"] = learning["days"] if learning["days"] else "auto"
    if task == "answer":
        # Keep the authority and original request together after supporting context.
        for key in ("source_state", "current_plan", "query"):
            context[key] = context.pop(key)

    def fits():
        return len((system + encode(context) + REPAIR).encode("utf-8")) <= cap

    if not fits():
        raise ValueError("learning_input_capacity")
    labels = {}
    # Keep the strongest matches and make room for other sources and pages before
    # spending the remaining prompt budget on duplicates from the same page.
    def breadth_key(item):
        return item["document_id"], item["page"]

    leading = evidence[:2]
    seen_documents = {item["document_id"] for item in leading}
    seen_pages = {breadth_key(item) for item in leading}
    other_documents, other_pages, remainder = [], [], []
    for item in evidence[2:]:
        if item["document_id"] not in seen_documents:
            other_documents.append(item)
        elif breadth_key(item) not in seen_pages:
            other_pages.append(item)
        else:
            remainder.append(item)
        seen_documents.add(item["document_id"])
        seen_pages.add(breadth_key(item))
    for index, item in enumerate([*leading, *other_documents, *other_pages, *remainder], 1):
        label = f"E{index}"
        context["evidence"].append({"id": label, "text": item["text"], "section": item.get("section", ""),
                                    "document": item["name"], "page": item["page"]})
        if not fits():
            context["evidence"].pop()
            continue
        labels[label] = (item, False)
    tagged_ids = {item["run_id"] for item in learning.get("tagged", [])}
    ordinary = [item for item in history if item.get("run_id") not in tagged_ids]
    tagged = learning.get("tagged", [])
    if task == "answer":
        ordinary = [{"user": item["question"], "assistant": item["answer"]} for item in ordinary]
        tagged = [{"user": item["question"], "assistant": item["answers"], "version": item["version"]}
                  for item in tagged]
    for key, records in (("events", learning["events"]), ("qa", ordinary),
                         ("tagged", tagged), ("versions", learning.get("versions", []))):
        for item in reversed(records):
            context[key].insert(0, item)
            if not fits():
                context[key].pop(0)
                break
    return task, system, encode(context), labels, context["source_state"], tokens


def rewrite_context(run, history):
    plan = run["input"]["learning"]["plan"]
    system = PROMPTS["rewrite"] + (
        "\nKeep every requested part, named subject, candidate and criterion. Use history only to resolve "
        "references that the current question leaves implicit. Keep standalone questions intact."
    )
    context = {"query": run["input"]["query"], "qa": history, "plan_topics": (
        [item["goal"] for item in plan["blueprint"]["objectives"][:6]] if plan else []
    )}
    for field in ("qa", "plan_topics"):
        while context[field] and len((system + encode(context)).encode("utf-8")) > 6144:
            context[field] = context[field][1:]
    return system, encode(context)


def changes(before, after):
    edits = []
    for field in ("title", "days"):
        if before[field] != after[field]:
            edits.append({"field": field, "before": before[field], "after": after[field]})
    old = {item["id"]: item for item in before["objectives"]}
    new = {item["id"]: item for item in after["objectives"]}
    for identifier in dict.fromkeys([*old, *new]):
        previous, current = old.get(identifier), new.get(identifier)
        objective = current or previous
        reference = {"objective_id": identifier, "goal": objective["goal"], "day": objective["day"]}
        if previous is None or current is None:
            edits.append({**reference, "field": "objective_added" if previous is None else "objective_removed",
                          "before": previous, "after": current})
            continue
        for field in ("day", "goal", "activities", "progress"):
            if previous[field] != current[field]:
                edits.append({**reference, "field": field, "before": previous[field], "after": current[field]})
    old_order = [identifier for identifier in old if identifier in new]
    new_order = [identifier for identifier in new if identifier in old]
    if old_order != new_order:
        edits.append({"field": "order", "before": [old[identifier]["goal"] for identifier in old_order],
                      "after": [new[identifier]["goal"] for identifier in new_order]})
    return edits


def validate(task, output, labels, state, learning):
    if task != "answer":
        candidate = json.loads(json_output(output))
        if task == "edit" and isinstance(candidate, dict) and isinstance(candidate.get("plan"), dict):
            proposed = candidate["plan"]
            if "version" in proposed:
                version = proposed.pop("version")
                if type(version) is not int or version != learning["plan"]["content_version"]:
                    raise ValueError("proposal_version_mismatch")
        reply = BlueprintReply.model_validate(candidate)
        if reply.plan is None:
            return [], [reply.reply], None
        base = learning["plan"]["blueprint"] if task == "edit" else None
        if task == "create" and learning["days"] is not None and reply.plan.days != learning["days"]:
            raise ValueError("invalid_fixed_duration")
        proposal = materialize(reply.plan, base)
        if task == "create":
            return [], [], ("create", {"draft": reply.plan, "reply": reply.reply})
        return [], [], ("edit", {"proposal": proposal, "changes": changes(base, proposal), "reply": reply.reply})
    answer = LearningAnswer.model_validate_json(json_output(output))
    claims = []
    unsupported = list(answer.unsupported_parts)
    for claim in answer.claims:
        document = claim.source == "document"
        invalid = (
            document != bool(claim.evidence) or any(item not in labels for item in claim.evidence)
            or (claim.source == "plan" and not learning["plan"])
            or (claim.source == "general" and state != "zero")
        )
        if invalid:
            if "A statement could not be verified against the available context." not in unsupported:
                unsupported.append("A statement could not be verified against the available context.")
            continue
        claims.append({"text": claim.text, "source": claim.source, "citations": resolve(claim.evidence, labels)})
    action = None
    if answer.readiness == "ready" and answer.suggestion and learning["plan"] and claims:
        base = learning["plan"]["blueprint"]
        identifier = str(answer.suggestion)
        pending = next((item for item in base["objectives"] if item["id"] == identifier
                        and item["progress"] == "pending"), None)
        if pending:
            proposal = {**base, "objectives": [
                {**item, "progress": "completed"} if item["id"] == identifier else item
                for item in base["objectives"]
            ]}
            action = ("completion", {"proposal": proposal, "objective": pending["goal"]})
    return claims, unsupported, action
