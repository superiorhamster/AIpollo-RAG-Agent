# Microservice Boundaries

The first production-capable version may run all services on one Docker host/Compose deployment, but boundaries must allow independent scaling later.

## api-gateway
Owns public routing/BFF concerns, request correlation, coarse rate limiting, aggregation needed by the frontend. It does not own domain data.

## auth-service
Owns users, credentials, role assignments, sessions/refresh state, account status, and authentication events. Admin operations must still pass authorization checks.

## workspace-service
Owns workspaces, memberships/ACLs, source collections, and user-visible organization metadata.

## document-service
Owns document metadata, upload lifecycle, object-storage references, document-page/anchor lookup, annotations/highlights if not split into a later dedicated service.

## ingestion-service
Owns background parsing/chunking/embedding/indexing workflows and processing job state. It consumes uploaded-document events and emits indexing outcomes.

## retrieval-service
Owns Qdrant/vector + lexical/hybrid retrieval behavior, reranking, metadata/tenant filters, context packing, and citation candidate metadata. It must not return chunks outside the caller's authorized scope.

## agent-orchestrator
Owns Ask/Plan/Agent workflow state, plan versions/acceptance/run records, tool routing, bounded loops, and capability orchestration. It should call domain services rather than read their databases.

## artifact-service
Owns generated durable artifacts such as study guides, quizzes, flashcards, mind maps, evidence tables, and writing drafts.

## model-gateway
Owns provider/model selection, model credentials, standard request/response wrappers, quota/cost accounting hooks, and model-call observability. Domain services must not scatter provider-specific SDK calls everywhere.

## admin-service
Owns admin-facing aggregation/configuration and operational views. It may call service admin APIs; it must not bypass service ownership by querying private tables indiscriminately.

## Infrastructure dependencies

- PostgreSQL: durable relational storage. Initially one cluster is acceptable, with schema ownership per service.
- Qdrant: vector retrieval/index storage.
- Redis: cache, distributed locks, rate-limit/ephemeral coordination where justified.
- RabbitMQ: background/event messaging.
- MinIO/S3-compatible object storage: original documents and large generated files.
- Observability stack: add OpenTelemetry-compatible tracing/metrics/log aggregation as the project matures.

## Cross-service rules

- Never share ORM models across services as a shortcut to another service's database.
- Shared packages may contain transport schemas, common IDs, tracing helpers, and small utilities—not domain persistence internals.
- Prefer events for ingestion/artifact workflows that do not require an immediate user response.
- Every event carries an event ID, timestamp, schema version, correlation/request ID, actor/tenant context when relevant, and idempotency semantics.
