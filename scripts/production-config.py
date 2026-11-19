"""Validate rendered production Compose topology without displaying credentials."""

import json
import re
import sys

services = json.load(sys.stdin)["services"]
digest = re.compile(r"^.+@sha256:[0-9a-f]{64}$")
for name, config in services.items():
    if config.get("build") or not digest.fullmatch(config.get("image", "")):
        raise SystemExit(f"{name} needs a reviewed image with a SHA-256 digest")
    if name != "caddy" and config.get("ports"):
        raise SystemExit(f"{name} publishes a host port outside the TLS proxy")

hostname = services["caddy"]["environment"]["PRODUCTION_HOSTNAME"]
if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]{1,251})[A-Za-z0-9]", hostname) or "." not in hostname:
    raise SystemExit("PRODUCTION_HOSTNAME must be a DNS hostname")
origin = "https://" + hostname
for service in ("web", "auth-service", "api-gateway"):
    if services[service]["environment"]["WEB_ORIGIN"] != origin:
        raise SystemExit("WEB_ORIGIN must match the public HTTPS hostname")
for name, key in (("postgres", "POSTGRES_PASSWORD"), ("minio", "MINIO_ROOT_PASSWORD"),
                  ("rabbitmq", "RABBITMQ_DEFAULT_PASS")):
    secret = services[name]["environment"].get(key, "")
    if len(secret) < 24 or "local_only" in secret:
        raise SystemExit(f"{key} requires a distinct deployment secret")
model = services["model-gateway"]["environment"]
keys = ("MODEL_EMBEDDING_BASE_URL", "MODEL_EMBEDDING_NAME", "MODEL_EMBEDDING_DIMENSIONS",
        "MODEL_EMBEDDING_API_KEY", "MODEL_CHAT_BASE_URL", "MODEL_CHAT_NAME", "MODEL_CHAT_API_KEY")
if model["MODEL_PROVIDER"] != "openai-compatible" or not all(model.get(key) for key in keys):
    raise SystemExit("Configure the production embedding and chat provider")
print("Production topology, public origin, image digests and required environment validated.")
