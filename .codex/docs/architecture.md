# Architecture Overview

```mermaid
flowchart LR
    U[User / Admin] --> WEB[Web App]
    WEB --> GW[API Gateway / BFF]

    GW --> AUTH[Auth Service]
    GW --> WS[Workspace Service]
    GW --> DOC[Document Service]
    GW --> ORCH[Agent Orchestrator]
    GW --> ART[Artifact Service]
    GW --> ADM[Admin Service]

    DOC --> OBJ[(MinIO / S3)]
    DOC --> MQ[(RabbitMQ)]
    MQ --> ING[Ingestion Service]
    ING --> OBJ
    ING --> PG[(PostgreSQL)]
    ING --> RET[Retrieval Service]
    RET --> QD[(Qdrant)]
    RET --> PG

    ORCH --> RET
    ORCH --> DOC
    ORCH --> ART
    ORCH --> MODEL[Model Gateway]
    ART --> PG
    AUTH --> PG
    WS --> PG
    DOC --> PG
    ADM --> AUTH
    ADM --> WS
    ADM --> DOC
    ADM --> ORCH
    MODEL --> LLM[Model Providers]

    GW --> REDIS[(Redis)]
    ORCH --> REDIS
```

## Main document flow

Development can use the optional `compose.ollama.yaml` overlay. Ollama serves only
the configured embedding model on the private Compose network, with an existing
read-only model cache. Domain services continue calling Model Gateway; the chat
provider remains independently configured. Embedding fingerprints isolate model
versions and Ingestion owns re-indexing and publishing replacement generations.

1. Authenticated user requests an upload URL or uploads through the gateway/document service.
2. Document service stores the raw file in object storage and records metadata.
3. An ingestion job is queued.
4. Ingestion parses the source, preserves page/structure metadata, chunks it, creates embeddings, and indexes retrievable content.
5. Retrieval service exposes authorized search over indexed sources.
6. Agent orchestrator uses retrieval and capability tools to answer or build artifacts.
7. Citations retain `document_id` plus page/chunk/anchor information so the frontend can focus the side panel.

## Plan-to-execution flow

```mermaid
sequenceDiagram
    actor User
    participant UI
    participant ORCH as Agent Orchestrator
    participant Services as Domain Services/Tools

    User->>UI: Request /plan task
    UI->>ORCH: Create plan
    ORCH->>Services: Read-only inspection/retrieval
    Services-->>ORCH: Context
    ORCH-->>UI: Plan v1 (review)
    User->>UI: Edit / regenerate
    UI->>ORCH: Create Plan v2
    ORCH-->>UI: Plan v2
    User->>UI: Accept v2
    UI->>ORCH: Accept(plan_id, v2)
    ORCH-->>UI: Accepted
    User->>UI: Execute
    UI->>ORCH: Start run(plan_id, v2)
    ORCH->>ORCH: Verify exact acceptance
    ORCH->>Services: Execute bounded workflow
    Services-->>ORCH: Results/evidence
    ORCH-->>UI: Progress + final result
```
