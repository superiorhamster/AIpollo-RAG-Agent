"""Smoke-test the Phase 00 HTTP contracts over the Compose network."""

import json
import sys
from urllib.request import urlopen

BACKENDS = (
    "api-gateway",
    "auth-service",
    "workspace-service",
    "document-service",
    "ingestion-service",
    "retrieval-service",
    "agent-orchestrator",
    "artifact-service",
    "model-gateway",
    "admin-service",
)
CHECKS = {"/healthz": "ok", "/readyz": "ready"}


def verify_service(service: str, base_url: str) -> None:
    for path, status in CHECKS.items():
        with urlopen(f"{base_url}{path}", timeout=5) as response:
            payload = json.load(response)
            expected = {"service": service, "status": status}
            if response.status != 200 or payload != expected:
                raise ValueError(
                    f"{path}: expected HTTP 200 and {expected}, got {response.status} and {payload}"
                )


def verify_homepage(base_url: str) -> None:
    with urlopen(base_url, timeout=5) as response:
        if response.status != 200 or b"<h1>Super Agentic RAG</h1>" not in response.read():
            raise ValueError("the home page failed to render its heading")


def main() -> int:
    service_urls = {service: f"http://{service}:8000" for service in BACKENDS}
    service_urls["web"] = "http://web:3000"
    failed = False
    for service, url in service_urls.items():
        try:
            verify_service(service, url)
            if service == "web":
                verify_homepage(url)
        except (OSError, ValueError) as error:
            print(f"FAIL {service}: {error}", file=sys.stderr)
            failed = True
        else:
            print(f"OK   {service}")

    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
