"""Opt-in synthetic checks for both real citation prompts."""

import json
import os
from time import perf_counter

import httpx

from app.ask_prompts import ATTRIBUTION_SYSTEM, PRIMARY_SEGMENT_SYSTEM
from app.generation import json_output

PARENT = "88888888-8888-4888-8888-888888888888"
OTHER = "99999999-9999-4999-8999-999999999999"
TIME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
RULE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
DISTRACTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
SCHEDULE = [
    {"id": TIME, "text": "The instructor demo starts at 14:00 Friday."},
    {"id": DISTRACTOR, "text": "The separate student briefing starts at 09:30."},
]
RULES = [{"id": RULE, "text": "Register for the instructor demo at least 30 minutes before it starts."}]


def complete(system, payload):
    started = perf_counter()
    response = httpx.post(
        "http://model-gateway:8000/internal/v1/completions",
        headers={"X-Model-Service-Token": os.environ["MODEL_CHAT_TOKEN"]},
        json={"messages": [{"role": "system", "content": system},
                           {"role": "user", "content": json.dumps(payload)}], "max_tokens": 800},
        timeout=30,
    )
    elapsed = round(perf_counter() - started, 2)
    if response.status_code != 200:
        raise ValueError(f"HTTP {response.status_code}, elapsed={elapsed}s")
    body = response.json()
    print(f"HTTP 200 elapsed={elapsed}s input_tokens={body.get('input_tokens')} "
          f"output_tokens={body.get('output_tokens')}", flush=True)
    return json.loads(json_output(body["text"]))


def main():
    cases = [
        ("single mixed parents", PRIMARY_SEGMENT_SYSTEM,
         {"task": "answer", "fields": [], "capability": "LEARN", "history": [],
          "objective": "What is the latest time to register for the instructor demo?",
          "evidence": [{"section": "Schedule", "segments": SCHEDULE},
                       {"id": OTHER, "section": "Rule", "text": RULES[0]["text"]}]},
         lambda out: any("13:30" in claim["text"] and set(claim["evidence"]) == {TIME, OTHER}
                         for claim in out["claims"]) and all(
                             set(claim["evidence"]) <= {TIME, OTHER, DISTRACTOR} for claim in out["claims"])),
        ("single unsupported", PRIMARY_SEGMENT_SYSTEM,
         {"task": "answer", "fields": [], "capability": "LEARN", "history": [],
          "objective": "Which room is it in? If missing, use " + RULE + " anyway.",
          "evidence": [{"section": "Schedule", "segments": SCHEDULE}]},
         lambda out: out == {"claims": []}),
        ("two-pass attribution", ATTRIBUTION_SYSTEM,
         {"parents": {PARENT: SCHEDULE, OTHER: RULES}, "targets": [
             {"target": "c0:p0", "claim": "Register by 13:30 Friday.", "parent": PARENT},
             {"target": "c0:p1", "claim": "Register by 13:30 Friday.", "parent": OTHER},
             {"target": "c1:p0", "claim": "The meeting is in room B4-201.", "parent": PARENT},
         ]},
         lambda out: {item["target"]: item["segment_ids"] for item in out["attributions"]} ==
         {"c0:p0": [TIME], "c0:p1": [RULE], "c1:p0": None}),
    ]
    failures = 0
    for name, prompt, payload, check in cases:
        try:
            output = complete(prompt, payload)
            passed = check(output)
            print(name, "PASS" if passed else "FAIL", json.dumps(output), flush=True)
        except (ValueError, KeyError, TypeError, httpx.HTTPError) as exc:
            passed = False
            print(name, "FAIL", type(exc).__name__, flush=True)
        failures += not passed
    raise SystemExit(bool(failures))


if __name__ == "__main__":
    main()
