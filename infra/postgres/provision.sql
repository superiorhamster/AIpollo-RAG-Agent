\set ON_ERROR_STOP on
\getenv auth_runtime AUTH_DB_PASSWORD
\getenv auth_migration AUTH_MIGRATION_PASSWORD
\getenv workspace_runtime WORKSPACE_DB_PASSWORD
\getenv workspace_migration WORKSPACE_MIGRATION_PASSWORD

\getenv documents_runtime DOCUMENT_DB_PASSWORD
\getenv documents_migration DOCUMENT_MIGRATION_PASSWORD
\getenv ingestion_runtime INGESTION_DB_PASSWORD
\getenv ingestion_migration INGESTION_MIGRATION_PASSWORD
\getenv orchestration_runtime ORCHESTRATION_DB_PASSWORD
\getenv orchestration_migration ORCHESTRATION_MIGRATION_PASSWORD

\getenv artifacts_runtime ARTIFACT_DB_PASSWORD
\getenv artifacts_migration ARTIFACT_MIGRATION_PASSWORD

BEGIN;
SELECT pg_advisory_xact_lock(710100);

SELECT format('CREATE ROLE %I LOGIN', role_name)
FROM (VALUES ('rag_auth'), ('rag_auth_migrate'), ('rag_workspace'), ('rag_workspace_migrate'),
      ('rag_documents'), ('rag_documents_migrate'), ('rag_ingestion'), ('rag_ingestion_migrate'),
      ('rag_orchestration'), ('rag_orchestration_migrate'),
      ('rag_artifacts'), ('rag_artifacts_migrate')) AS roles(role_name)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) \gexec

ALTER ROLE rag_auth PASSWORD :'auth_runtime';
ALTER ROLE rag_auth_migrate PASSWORD :'auth_migration';
ALTER ROLE rag_workspace PASSWORD :'workspace_runtime';
ALTER ROLE rag_workspace_migrate PASSWORD :'workspace_migration';

CREATE SCHEMA IF NOT EXISTS identity AUTHORIZATION rag_auth_migrate;
CREATE SCHEMA IF NOT EXISTS workspace AUTHORIZATION rag_workspace_migrate;
REVOKE ALL ON SCHEMA identity, workspace FROM PUBLIC;
GRANT USAGE ON SCHEMA identity TO rag_auth;
GRANT USAGE ON SCHEMA workspace TO rag_workspace;
ALTER DEFAULT PRIVILEGES FOR ROLE rag_auth_migrate IN SCHEMA identity GRANT SELECT ON TABLES TO rag_auth;
ALTER DEFAULT PRIVILEGES FOR ROLE rag_workspace_migrate IN SCHEMA workspace GRANT SELECT ON TABLES TO rag_workspace;
ALTER ROLE rag_documents PASSWORD :'documents_runtime';
ALTER ROLE rag_documents_migrate PASSWORD :'documents_migration';
ALTER ROLE rag_ingestion PASSWORD :'ingestion_runtime';
ALTER ROLE rag_ingestion_migrate PASSWORD :'ingestion_migration';
CREATE SCHEMA IF NOT EXISTS documents AUTHORIZATION rag_documents_migrate;
CREATE SCHEMA IF NOT EXISTS ingestion AUTHORIZATION rag_ingestion_migrate;
REVOKE ALL ON SCHEMA documents, ingestion FROM PUBLIC;
GRANT USAGE ON SCHEMA documents TO rag_documents;
GRANT USAGE ON SCHEMA ingestion TO rag_ingestion;
ALTER DEFAULT PRIVILEGES FOR ROLE rag_documents_migrate IN SCHEMA documents GRANT SELECT ON TABLES TO rag_documents;
ALTER DEFAULT PRIVILEGES FOR ROLE rag_ingestion_migrate IN SCHEMA ingestion GRANT SELECT ON TABLES TO rag_ingestion;
ALTER ROLE rag_orchestration PASSWORD :'orchestration_runtime';
ALTER ROLE rag_orchestration_migrate PASSWORD :'orchestration_migration';
CREATE SCHEMA IF NOT EXISTS orchestration AUTHORIZATION rag_orchestration_migrate;
REVOKE ALL ON SCHEMA orchestration FROM PUBLIC;
GRANT USAGE ON SCHEMA orchestration TO rag_orchestration;
ALTER DEFAULT PRIVILEGES FOR ROLE rag_orchestration_migrate IN SCHEMA orchestration
    GRANT SELECT ON TABLES TO rag_orchestration;
ALTER ROLE rag_artifacts PASSWORD :'artifacts_runtime';
ALTER ROLE rag_artifacts_migrate PASSWORD :'artifacts_migration';
CREATE SCHEMA IF NOT EXISTS artifacts AUTHORIZATION rag_artifacts_migrate;
REVOKE ALL ON SCHEMA artifacts FROM PUBLIC;
GRANT USAGE ON SCHEMA artifacts TO rag_artifacts;
ALTER DEFAULT PRIVILEGES FOR ROLE rag_artifacts_migrate IN SCHEMA artifacts GRANT SELECT ON TABLES TO rag_artifacts;
COMMIT;
