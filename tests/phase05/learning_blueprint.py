"""Deterministic checks for canonical Learning Plan admission."""

import json
import unittest
from uuid import uuid4

from app.learning_blueprint import (
    BLUEPRINT_LIMIT, BlueprintDraft, BlueprintError, canonical_bytes, content_snapshot, materialize,
)
from app.learning_ai import changes, pack, validate


def draft(title="Học phân số", **objective):
    return BlueprintDraft.model_validate({
        "title": title, "days": 1,
        "objectives": [{"day": 1, "goal": "Quy đồng mẫu", "activities": ["Vẽ hình"], **objective}],
    })


class LearningBlueprint(unittest.TestCase):
    def test_activity_diff_identifies_the_changed_field_without_false_reordering(self):
        base = materialize(draft())
        objective = base["objectives"][0]
        after = {**base, "objectives": [{**objective, "activities": [*objective["activities"], "Compare approaches"]}]}
        diff = changes(base, after)
        self.assertEqual([row["field"] for row in diff], ["activities"])
        self.assertEqual(diff[0]["objective_id"], objective["id"])
        self.assertEqual(diff[0]["before"], objective["activities"])
        self.assertEqual(diff[0]["after"], after["objectives"][0]["activities"])
        added = {**base, "objectives": [materialize(draft())["objectives"][0], objective]}
        self.assertEqual([row["field"] for row in changes(base, added)], ["objective_added"])

    def test_new_objectives_start_pending_and_progress_has_no_content_version(self):
        base = materialize(draft(progress="completed"))
        original = base["objectives"][0]
        self.assertEqual(original["progress"], "pending")
        updated = materialize(draft(id=original["id"], progress="completed"), base)
        self.assertEqual(updated["objectives"][0]["progress"], "completed")
        self.assertEqual(content_snapshot(base), content_snapshot(updated))

    def test_unknown_identity_and_missing_day_are_rejected(self):
        with self.assertRaisesRegex(BlueprintError, "invalid_objective_identity"):
            materialize(draft(id=uuid4()))
        with self.assertRaisesRegex(BlueprintError, "invalid_day_coverage"):
            materialize(draft(day=2))

    def test_utf8_admission_at_exact_capacity(self):
        title = "Học"
        overhead = len(canonical_bytes(materialize(draft(title))))
        length = BLUEPRINT_LIMIT - overhead
        for offset in (-1, 0):
            result = materialize(draft(title + "x" * (length + offset)))
            self.assertEqual(len(canonical_bytes(result)), BLUEPRINT_LIMIT + offset)
        with self.assertRaisesRegex(BlueprintError, "blueprint_capacity_exceeded"):
            materialize(draft(title + "x" * (length + 1)))

    def test_provenance_and_structured_readiness(self):
        blueprint = materialize(draft())
        objective = blueprint["objectives"][0]
        binding = {"plan": {"blueprint": blueprint}}
        output = {
            "claims": [
                {"text": "The document confirms readiness.", "source": "document", "evidence": ["invented"]},
                {"text": "Your current Plan contains a fractions objective.", "source": "plan", "evidence": []},
            ],
            "unsupported_parts": [],
            "suggestion": objective["id"],
            "readiness": "not_ready",
        }
        claims, unsupported, action = validate("answer", json.dumps(output), {}, "zero", binding)
        self.assertEqual([claim["source"] for claim in claims], ["plan"])
        self.assertEqual(len(unsupported), 1)
        self.assertIsNone(action)
        _, _, action = validate("answer", json.dumps({**output, "readiness": "ready"}), {}, "zero", binding)
        self.assertEqual(action[0], "completion")
        self.assertEqual(action[1]["proposal"]["objectives"][0]["progress"], "completed")
        self.assertEqual(blueprint["objectives"][0]["progress"], "pending")

    def test_abstention_and_a_malformed_secondary_suggestion(self):
        response = {"claims": [], "unsupported_parts": ["The source does not give a weight."],
                    "suggestion": None, "readiness": "not_assessed"}
        claims, gaps, action = validate("answer", json.dumps(response), {}, "found", {"plan": None})
        self.assertEqual((claims, gaps, action), ([], response["unsupported_parts"], None))
        response["claims"] = [{"text": "You said you prefer Thursday.", "source": "conversation", "evidence": []}]
        response["suggestion"] = "first objective"
        response["readiness"] = "ready"
        claims, gaps, action = validate("answer", json.dumps(response), {}, "found", {"plan": None})
        self.assertEqual([claim["source"] for claim in claims], ["conversation"])
        self.assertEqual(gaps, response["unsupported_parts"])
        self.assertIsNone(action)
        response["claims"][0]["source"] = "invented"
        with self.assertRaises(ValueError):
            validate("answer", json.dumps(response), {}, "found", {"plan": None})

    def test_near_limit_edit_packs_full_current_plan(self):
        initial = materialize(draft("Phân số"))
        size = len(canonical_bytes(initial))
        title = "Phân số" + "x" * (BLUEPRINT_LIMIT - size)
        blueprint = materialize(draft(title))
        case = {"input": {"query": "Update the title.", "document_ids": [], "learning": {
            "action": "edit", "days": None, "events": [{"detail": "ã" * 15000}],
            "plan": {"blueprint": blueprint, "content_version": 1},
        }}}
        task, system, content, evidence, state, tokens = pack(case, [], [])
        self.assertEqual((task, evidence, state, tokens), ("edit", {}, "zero", 4096))
        self.assertEqual(json.loads(content)["current_plan"], {**blueprint, "version": 1})
        self.assertEqual(json.loads(content)["events"], [])
        self.assertLessEqual(len((system + content).encode("utf-8")), 32000)

    def test_edit_accepts_only_the_pinned_read_only_version_echo(self):
        blueprint = materialize(draft())
        binding = {"plan": {"blueprint": blueprint, "content_version": 2}}
        raw = {"reply": "Renamed the plan.", "plan": {**blueprint, "title": "Review fractions", "version": 2}}
        _, _, proposal = validate("edit", json.dumps(raw), {}, "zero", binding)
        self.assertNotIn("version", proposal[1]["proposal"])
        self.assertEqual(proposal[1]["proposal"]["objectives"], blueprint["objectives"])
        raw["plan"]["version"] = 3
        with self.assertRaisesRegex(ValueError, "proposal_version_mismatch"):
            validate("edit", json.dumps(raw), {}, "zero", binding)

    def test_answer_preserves_bound_plan_or_fails_explicitly(self):
        blueprint = materialize(draft("Kiến thức " + "界" * 1800))
        blueprint["objectives"][0]["progress"] = "completed"
        run = {"input": {"query": "What progress did I make?", "document_ids": [], "learning": {
            "action": None, "days": None, "events": [{"detail": "界" * 12000}],
            "plan": {"blueprint": blueprint, "content_version": 7},
        }}}
        _, _, content, _, _, _ = pack(run, [], [])
        self.assertEqual(json.loads(content)["current_plan"], {**blueprint, "version": 7})
        self.assertEqual(json.loads(content)["events"], [])
        blueprint["title"] += "x" * (BLUEPRINT_LIMIT - len(canonical_bytes(blueprint)))
        self.assertEqual(len(canonical_bytes(blueprint)), BLUEPRINT_LIMIT)
        with self.assertRaisesRegex(ValueError, "learning_input_capacity"):
            pack(run, [], [])


if __name__ == "__main__":
    unittest.main()
