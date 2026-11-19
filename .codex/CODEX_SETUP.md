# Codex and Local Development Setup

## What Codex itself needs
Codex recognizes the repository-level `AGENTS.md` automatically. No application package is required just for Codex to read it.

Install/update Codex CLI with one of the supported installation methods. A common npm installation is:

```bash
npm install -g @openai/codex@latest
codex --version
```

Open the repository root and run:

```bash
codex
```

Sign in when prompted. Keep credentials outside the repository.

## Required local tools for this project
The bootstrap scripts assume:

- Git
- Docker Engine / Docker Desktop
- Docker Compose v2 (`docker compose`)
- Bash (Linux/macOS/WSL; on Windows use WSL or translate the Make targets)
- GNU Make (recommended)

These are enough for the initial containerized infrastructure.

## Tools needed once application code is added
Recommended host tools, even though services should remain runnable in containers:

- Python 3.12+ and `uv` for Python service development
- Node.js LTS and `pnpm`/Corepack for the web client
- `curl` for API/health checks
- GitHub CLI (`gh`) if using GitHub-based Codex workflows

Do not require developers to install PostgreSQL, Redis, RabbitMQ, Qdrant, or MinIO directly on the host; use Docker Compose.

## First-time bootstrap

```bash
make check
make env
make infra-up
make verify-infra
```

Then run Codex from the repository root so it receives the root `AGENTS.md`.

## Optional Codex workflow support
For large multi-step tasks, keep durable implementation plans under `harness/build/` and use `PLANS.md` as the format contract. This repository intentionally avoids a large project-level Codex config that could unexpectedly override a developer's personal sandbox/approval settings.

## Safe Codex configuration guidance
Keep Codex sandbox/approval configuration in your normal Codex configuration location and follow your organization policy. For restrictive local work, prefer a workspace-write sandbox with approvals for actions outside the workspace rather than granting unrestricted access.

Never place API keys in Codex instruction files, shell scripts, Compose files, or committed `.env` files.
