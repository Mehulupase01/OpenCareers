import { createHash } from "node:crypto";
import { DomainError } from "../../contracts/src/index.js";
import type { Database } from "./database.js";

const migration1 = [
  `CREATE TABLE owners (id TEXT PRIMARY KEY, next_fence INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE controls (owner_id TEXT PRIMARY KEY REFERENCES owners(id), revision INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL)`,
  `CREATE TABLE profile_versions (id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES owners(id), candidate_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_id,id), UNIQUE(owner_id,candidate_id,revision))`,
  `CREATE TABLE sources (id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES owners(id), connector TEXT NOT NULL, policy TEXT NOT NULL, state TEXT NOT NULL, cursor TEXT, last_success_at TEXT, PRIMARY KEY(owner_id,id))`,
  `CREATE TABLE jobs (id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES owners(id), employer_id TEXT NOT NULL, requisition_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, PRIMARY KEY(owner_id,id), UNIQUE(owner_id,employer_id,requisition_id))`,
  `CREATE TABLE authorizations (id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES owners(id), revision INTEGER NOT NULL, data TEXT NOT NULL, effective_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, PRIMARY KEY(owner_id,id), UNIQUE(owner_id,revision))`,
  `CREATE TABLE applications (id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES owners(id), candidate_id TEXT NOT NULL, job_id TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, commit_fence INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(owner_id,id), FOREIGN KEY(owner_id,job_id) REFERENCES jobs(owner_id,id), UNIQUE(owner_id,candidate_id,job_id))`,
  `CREATE TABLE artifacts (id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES owners(id), sha256 TEXT NOT NULL, storage_key TEXT NOT NULL, mime_type TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_id,id), UNIQUE(owner_id,sha256))`,
  `CREATE TABLE packets (id TEXT NOT NULL, owner_id TEXT NOT NULL, application_id TEXT NOT NULL, manifest TEXT NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_id,id), FOREIGN KEY(owner_id,application_id) REFERENCES applications(owner_id,id))`,
  `CREATE TABLE intents (id TEXT NOT NULL, owner_id TEXT NOT NULL, application_id TEXT NOT NULL, packet_id TEXT NOT NULL, authorization_id TEXT NOT NULL, snapshot TEXT NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_id,id), FOREIGN KEY(owner_id,application_id) REFERENCES applications(owner_id,id), FOREIGN KEY(owner_id,packet_id) REFERENCES packets(owner_id,id), FOREIGN KEY(owner_id,authorization_id) REFERENCES authorizations(owner_id,id))`,
  `CREATE TABLE attempts (id TEXT NOT NULL, owner_id TEXT NOT NULL, application_id TEXT NOT NULL, intent_id TEXT NOT NULL, fence INTEGER NOT NULL, state TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, PRIMARY KEY(owner_id,id), FOREIGN KEY(owner_id,application_id) REFERENCES applications(owner_id,id), FOREIGN KEY(owner_id,intent_id) REFERENCES intents(owner_id,id))`,
  `CREATE UNIQUE INDEX one_inflight_attempt ON attempts(owner_id,application_id) WHERE state = 'IN_FLIGHT'`,
  `CREATE TABLE receipts (id TEXT NOT NULL, owner_id TEXT NOT NULL, application_id TEXT NOT NULL, attempt_id TEXT NOT NULL, evidence TEXT NOT NULL, sha256 TEXT NOT NULL, observed_at TEXT NOT NULL, PRIMARY KEY(owner_id,id), FOREIGN KEY(owner_id,application_id) REFERENCES applications(owner_id,id), FOREIGN KEY(owner_id,attempt_id) REFERENCES attempts(owner_id,id), UNIQUE(owner_id,sha256))`,
  `CREATE TABLE tasks (id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES owners(id), application_id TEXT, type TEXT NOT NULL, domain TEXT NOT NULL, state TEXT NOT NULL, dedupe_key TEXT NOT NULL, payload TEXT NOT NULL, priority INTEGER NOT NULL, run_after TEXT NOT NULL, fence INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL, lease_owner TEXT, lease_until TEXT, last_error TEXT, created_at TEXT NOT NULL, PRIMARY KEY(owner_id,id), FOREIGN KEY(owner_id,application_id) REFERENCES applications(owner_id,id), UNIQUE(owner_id,dedupe_key))`,
  `CREATE INDEX task_claim ON tasks(owner_id,state,run_after,priority)`,
  `CREATE TABLE exceptions (id TEXT NOT NULL, owner_id TEXT NOT NULL, application_id TEXT, task_id TEXT, code TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT, PRIMARY KEY(owner_id,id), FOREIGN KEY(owner_id,application_id) REFERENCES applications(owner_id,id), FOREIGN KEY(owner_id,task_id) REFERENCES tasks(owner_id,id))`,
  `CREATE TABLE audit_events (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id), aggregate_id TEXT NOT NULL, action TEXT NOT NULL, revision INTEGER NOT NULL, actor TEXT NOT NULL, correlation_id TEXT NOT NULL, payload TEXT NOT NULL, occurred_at TEXT NOT NULL)`,
  `CREATE TABLE outbox (id TEXT PRIMARY KEY REFERENCES audit_events(id), owner_id TEXT NOT NULL REFERENCES owners(id), available_at TEXT NOT NULL)`,
  `CREATE TABLE event_deliveries (event_id TEXT NOT NULL REFERENCES audit_events(id), consumer TEXT NOT NULL, delivered_at TEXT NOT NULL, PRIMARY KEY(event_id,consumer))`,
  `CREATE TABLE workers (id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES owners(id), kind TEXT NOT NULL, last_seen_at TEXT NOT NULL, version TEXT NOT NULL, PRIMARY KEY(owner_id,id))`,
];

const migrations = [
  migration1,
  [
    "CREATE INDEX task_domain_leases ON tasks(owner_id,state,domain,application_id)",
    "CREATE INDEX application_states ON applications(owner_id,state,updated_at)",
    "CREATE INDEX audit_owner_time ON audit_events(owner_id,occurred_at,id)",
  ],
  [
    "CREATE TABLE candidates (owner_id TEXT PRIMARY KEY REFERENCES owners(id), id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, active_profile_id TEXT, active_authorization_id TEXT, UNIQUE(owner_id,id), FOREIGN KEY(owner_id,active_profile_id) REFERENCES profile_versions(owner_id,id), FOREIGN KEY(owner_id,active_authorization_id) REFERENCES authorizations(owner_id,id))",
    "CREATE TABLE candidate_sources (owner_id TEXT NOT NULL, id TEXT NOT NULL, candidate_id TEXT NOT NULL, name TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, storage_key TEXT NOT NULL, extraction TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_id,id), UNIQUE(owner_id,candidate_id,sha256), FOREIGN KEY(owner_id,candidate_id) REFERENCES candidates(owner_id,id))",
    "CREATE TABLE fact_versions (owner_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, candidate_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_id,id,revision), FOREIGN KEY(owner_id,candidate_id) REFERENCES candidates(owner_id,id))",
    "CREATE TABLE fact_heads (owner_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(owner_id,id), FOREIGN KEY(owner_id,id,revision) REFERENCES fact_versions(owner_id,id,revision))",
    "CREATE TABLE approved_answers (owner_id TEXT NOT NULL, id TEXT NOT NULL, candidate_id TEXT NOT NULL, semantic_key TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, approved_at TEXT NOT NULL, PRIMARY KEY(owner_id,id), FOREIGN KEY(owner_id,candidate_id) REFERENCES candidates(owner_id,id), UNIQUE(owner_id,semantic_key,revision))",
    "CREATE TABLE packet_validity (owner_id TEXT NOT NULL, packet_id TEXT NOT NULL, invalidated_at TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(owner_id,packet_id), FOREIGN KEY(owner_id,packet_id) REFERENCES packets(owner_id,id))",
    "CREATE TABLE question_blocks (owner_id TEXT NOT NULL, application_id TEXT NOT NULL, semantic_key TEXT NOT NULL, meaning TEXT NOT NULL, country TEXT NOT NULL, exception_id TEXT NOT NULL, resolved_answer_id TEXT, PRIMARY KEY(owner_id,application_id,semantic_key), FOREIGN KEY(owner_id,application_id) REFERENCES applications(owner_id,id), FOREIGN KEY(owner_id,exception_id) REFERENCES exceptions(owner_id,id), FOREIGN KEY(owner_id,resolved_answer_id) REFERENCES approved_answers(owner_id,id))",
  ],
  [
    "ALTER TABLE sources ADD COLUMN revision INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE sources ADD COLUMN source_key TEXT",
    "ALTER TABLE sources ADD COLUMN next_poll_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'",
    "ALTER TABLE sources ADD COLUMN last_attempt_at TEXT",
    "ALTER TABLE sources ADD COLUMN job_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE sources ADD COLUMN pending_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE sources ADD COLUMN failures INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE sources ADD COLUMN etag TEXT",
    "ALTER TABLE sources ADD COLUMN lease_token TEXT",
    "ALTER TABLE sources ADD COLUMN lease_until TEXT",
    "CREATE UNIQUE INDEX source_identity ON sources(owner_id,source_key)",
    "CREATE INDEX source_poll ON sources(owner_id,next_poll_at,lease_until)",
    "CREATE TABLE source_runs (owner_id TEXT NOT NULL, id TEXT NOT NULL, source_id TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT NOT NULL, health TEXT NOT NULL, job_count INTEGER NOT NULL, duration_ms INTEGER NOT NULL, warnings TEXT NOT NULL, PRIMARY KEY(owner_id,id), FOREIGN KEY(owner_id,source_id) REFERENCES sources(owner_id,id))",
    "CREATE TABLE source_pages (owner_id TEXT NOT NULL, run_id TEXT NOT NULL, page_number INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner_id,run_id,page_number), FOREIGN KEY(owner_id,run_id) REFERENCES source_runs(owner_id,id))",
    "CREATE TABLE discovery_listings (owner_id TEXT NOT NULL, id TEXT NOT NULL, source_id TEXT NOT NULL, posting_id TEXT NOT NULL, job_id TEXT NOT NULL, original_job_id TEXT NOT NULL, canonical_url TEXT NOT NULL, data TEXT NOT NULL, state TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, missing_since TEXT, missing_count INTEGER NOT NULL DEFAULT 0, last_run_id TEXT NOT NULL, PRIMARY KEY(owner_id,id), UNIQUE(owner_id,source_id,posting_id), FOREIGN KEY(owner_id,source_id) REFERENCES sources(owner_id,id), FOREIGN KEY(owner_id,job_id) REFERENCES jobs(owner_id,id), FOREIGN KEY(owner_id,original_job_id) REFERENCES jobs(owner_id,id), FOREIGN KEY(owner_id,last_run_id) REFERENCES source_runs(owner_id,id))",
    "CREATE INDEX discovery_url ON discovery_listings(owner_id,canonical_url)",
    "CREATE TABLE historical_records (owner_id TEXT NOT NULL REFERENCES owners(id), id TEXT NOT NULL, external_id TEXT NOT NULL, canonical_url TEXT NOT NULL, job_id TEXT, data TEXT NOT NULL, sha256 TEXT NOT NULL, imported_at TEXT NOT NULL, PRIMARY KEY(owner_id,id), UNIQUE(owner_id,external_id), FOREIGN KEY(owner_id,job_id) REFERENCES jobs(owner_id,id))",
    "CREATE TABLE identity_resolutions (owner_id TEXT NOT NULL, id TEXT NOT NULL, from_job_id TEXT NOT NULL, to_job_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, reversed_at TEXT, PRIMARY KEY(owner_id,id), FOREIGN KEY(owner_id,from_job_id) REFERENCES jobs(owner_id,id), FOREIGN KEY(owner_id,to_job_id) REFERENCES jobs(owner_id,id))",
    "CREATE UNIQUE INDEX active_job_resolution ON identity_resolutions(owner_id,from_job_id) WHERE reversed_at IS NULL",
  ],
  [
    "CREATE TABLE model_catalogues (owner_id TEXT NOT NULL REFERENCES owners(id), id TEXT NOT NULL, data TEXT NOT NULL, sha256 TEXT NOT NULL, fetched_at TEXT NOT NULL, PRIMARY KEY(owner_id,id))",
    "CREATE TABLE inference_state (owner_id TEXT PRIMARY KEY REFERENCES owners(id), status TEXT NOT NULL, data TEXT NOT NULL, catalogue_id TEXT, backoff_until TEXT, updated_at TEXT NOT NULL, FOREIGN KEY(owner_id,catalogue_id) REFERENCES model_catalogues(owner_id,id))",
    "CREATE TABLE inference_reservations (owner_id TEXT NOT NULL REFERENCES owners(id), id TEXT NOT NULL, day TEXT NOT NULL, state TEXT NOT NULL, application_id TEXT, model_id TEXT NOT NULL, provider TEXT NOT NULL, request_hash TEXT, response_hash TEXT, error_code TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, completed_at TEXT, PRIMARY KEY(owner_id,id), FOREIGN KEY(owner_id,application_id) REFERENCES applications(owner_id,id))",
    "CREATE INDEX inference_budget ON inference_reservations(owner_id,day,state)",
    "CREATE TABLE match_assessments (owner_id TEXT NOT NULL REFERENCES owners(id), id TEXT NOT NULL, job_id TEXT NOT NULL, profile_id TEXT NOT NULL, application_id TEXT, revision INTEGER NOT NULL, data TEXT NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_id,id), UNIQUE(owner_id,job_id,profile_id,revision), FOREIGN KEY(owner_id,job_id) REFERENCES jobs(owner_id,id), FOREIGN KEY(owner_id,profile_id) REFERENCES profile_versions(owner_id,id), FOREIGN KEY(owner_id,application_id) REFERENCES applications(owner_id,id))",
    "CREATE INDEX match_latest ON match_assessments(owner_id,profile_id,job_id,revision)",
  ],
  [
    "CREATE TABLE packet_contents (owner_id TEXT NOT NULL, packet_id TEXT NOT NULL, profile_id TEXT NOT NULL, assessment_id TEXT NOT NULL, content TEXT NOT NULL, validation TEXT NOT NULL, PRIMARY KEY(owner_id,packet_id), FOREIGN KEY(owner_id,packet_id) REFERENCES packets(owner_id,id), FOREIGN KEY(owner_id,profile_id) REFERENCES profile_versions(owner_id,id), FOREIGN KEY(owner_id,assessment_id) REFERENCES match_assessments(owner_id,id))",
    "CREATE TABLE packet_artifacts (owner_id TEXT NOT NULL, packet_id TEXT NOT NULL, artifact_id TEXT NOT NULL, kind TEXT NOT NULL, filename TEXT NOT NULL, ordinal INTEGER NOT NULL, PRIMARY KEY(owner_id,packet_id,kind), FOREIGN KEY(owner_id,packet_id) REFERENCES packets(owner_id,id), FOREIGN KEY(owner_id,artifact_id) REFERENCES artifacts(owner_id,id))",
    "CREATE INDEX packet_application_time ON packets(owner_id,application_id,created_at,id)",
    "CREATE TABLE intent_validity (owner_id TEXT NOT NULL, intent_id TEXT NOT NULL, invalidated_at TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(owner_id,intent_id), FOREIGN KEY(owner_id,intent_id) REFERENCES intents(owner_id,id))",
  ],
];

export async function migrate(db: Database, targetVersion = migrations.length): Promise<void> {
  if (!Number.isInteger(targetVersion) || targetVersion < 1 || targetVersion > migrations.length)
    throw new DomainError("MIGRATION_UNSUPPORTED", "Invalid migration target.");
  await db.transaction(async (tx) => {
    if (tx.dialect === "postgres") await tx.query("SELECT pg_advisory_xact_lock(61279001)");
    await tx.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)",
    );
    const versions = await tx.query(
      "SELECT version, checksum FROM schema_migrations ORDER BY version",
    );
    if (versions.some((v) => Number(v.version) > targetVersion))
      throw new DomainError(
        "MIGRATION_UNSUPPORTED",
        "Database schema is newer than this application.",
      );
    for (let index = 0; index < targetVersion; index++) {
      const statements = migrations[index];
      if (!statements) throw new DomainError("MIGRATION_UNSUPPORTED", "Migration is missing.");
      const checksum = createHash("sha256").update(statements.join("\n")).digest("hex");
      const applied = versions.find((entry) => Number(entry.version) === index + 1);
      if (applied) {
        if (applied.checksum !== checksum)
          throw new DomainError("MIGRATION_UNSUPPORTED", "Applied migration checksum mismatch.");
      } else {
        if (versions.some((entry) => Number(entry.version) > index + 1))
          throw new DomainError("MIGRATION_UNSUPPORTED", "Migration history contains a gap.");
        for (const statement of statements) await tx.query(statement);
        await tx.query(
          "INSERT INTO schema_migrations(version,checksum,applied_at) VALUES($1,$2,$3)",
          [index + 1, checksum, new Date().toISOString()],
        );
      }
    }
  });
}
