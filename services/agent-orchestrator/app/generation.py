"""Strict generation envelope handling; no extraction of arbitrary JSON fragments."""


def json_output(value: str) -> str:
    value = value.strip()
    if value.startswith("```"):
        lines = value.splitlines()
        if len(lines) < 3 or lines[0].lower() not in {"```json", "```"} or lines[-1] != "```":
            raise ValueError("Invalid JSON fence")
        value = "\n".join(lines[1:-1]).strip()
    return value


REPAIR = "\nRegenerate the answer as schema-valid JSON. Use only the supplied passage UUIDs and correct claim provenance."
