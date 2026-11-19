# Super Agentic RAG — Codex Repository Kit

This starter kit gives Codex durable project instructions and gives developers a reproducible local infrastructure baseline.

Start here:

```bash
cp .env.example .env
make bootstrap
codex
```

Canonical Codex instructions are in `AGENTS.md` (plural). Product and architecture details are linked from there.

The current Compose file starts infrastructure dependencies only. Application microservices should be added as they are implemented, with production Dockerfiles and a production Compose manifest before V1 release.
