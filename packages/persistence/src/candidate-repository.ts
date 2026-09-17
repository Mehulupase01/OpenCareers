import { createHash, randomUUID } from "node:crypto";
import { chronology, conflictingFacts, usableFact } from "../../candidate/src/domain.js";
import {
  type AnswerInput,
  type ApprovedAnswer,
  type Authorization,
  answerInputSchema,
  type CandidateFact,
  type CandidateSnapshot,
  type Extraction,
  extractionSchema,
  type FactInput,
  factInputSchema,
  factSchema,
  type PolicyInput,
  type ProfileSnapshot,
  policyInputSchema,
  type SourceDocument,
} from "../../contracts/src/candidate.js";
import { DomainError, jobInputSchema } from "../../contracts/src/index.js";
import { localDay } from "../../domain/src/state.js";
import type { Row, SqlExecutor } from "./database.js";
import { assertDiscoveryEligibility } from "./job-identity.js";
import { Repository, taskFromRow } from "./repository.js";

const json = <T>(row: Row, field = "data"): T => JSON.parse(String(row[field])) as T;
export class CandidateRepository extends Repository {
  override async initialize() {
    await super.initialize();
    await this.db.query(
      "INSERT INTO candidates(owner_id,id) VALUES($1,$2) ON CONFLICT(owner_id) DO NOTHING",
      [this.ownerId, this.ownerId === "synthetic-owner" ? "synthetic-candidate" : "candidate"],
    );
  }
  private async candidate(tx: SqlExecutor) {
    const row = (await tx.query("SELECT * FROM candidates WHERE owner_id=$1", [this.ownerId]))[0];
    if (!row) throw new DomainError("NOT_FOUND", "Candidate not initialized.");
    return row;
  }
  private async facts(tx: SqlExecutor): Promise<CandidateFact[]> {
    return (
      await tx.query(
        "SELECT v.data FROM fact_heads h JOIN fact_versions v ON v.owner_id=h.owner_id AND v.id=h.id AND v.revision=h.revision WHERE h.owner_id=$1 ORDER BY h.id",
        [this.ownerId],
      )
    ).map((r) => factSchema.parse(json(r)));
  }
  private profile(row: Row): ProfileSnapshot {
    return {
      ...json<ProfileSnapshot>(row),
      id: String(row.id),
      revision: Number(row.revision),
      candidateId: String(row.candidate_id),
      createdAt: String(row.created_at),
    };
  }
  private policy(row: Row): Authorization {
    return {
      ...json<Authorization>(row),
      id: String(row.id),
      revision: Number(row.revision),
      revokedAt: row.revoked_at as string | null,
    };
  }
  async snapshot(): Promise<CandidateSnapshot> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const candidate = await this.candidate(tx);
      const profile = (
        await tx.query("SELECT * FROM profile_versions WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          candidate.active_profile_id ?? null,
        ])
      )[0];
      const policy = (
        await tx.query("SELECT * FROM authorizations WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          candidate.active_authorization_id ?? null,
        ])
      )[0];
      const sources = await tx.query(
        "SELECT * FROM candidate_sources WHERE owner_id=$1 ORDER BY created_at DESC",
        [this.ownerId],
      );
      return {
        candidateId: String(candidate.id),
        revision: Number(candidate.revision),
        facts: await this.facts(tx),
        profile: profile ? this.profile(profile) : null,
        authorization: policy ? this.policy(policy) : null,
        sources: sources.map((r) => {
          const { blocks, ...extraction } = extractionSchema.parse(json(r, "extraction"));
          return {
            ...extraction,
            id: String(r.id),
            name: String(r.name),
            sha256: String(r.sha256),
            bytes: Number(r.bytes),
            createdAt: String(r.created_at),
            blockCount: blocks.length,
          };
        }),
        answers: (
          await tx.query(
            "SELECT * FROM approved_answers WHERE owner_id=$1 ORDER BY revision DESC",
            [this.ownerId],
          )
        ).map((r) => ({
          ...json<ApprovedAnswer>(r),
          id: String(r.id),
          revision: Number(r.revision),
          approvedAt: String(r.approved_at),
        })),
      };
    });
  }
  async source(id: string): Promise<SourceDocument> {
    const row = (
      await this.db.query("SELECT * FROM candidate_sources WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        id,
      ])
    )[0];
    if (!row) throw new DomainError("NOT_FOUND", "Source not found.");
    return {
      ...extractionSchema.parse(json(row, "extraction")),
      id: String(row.id),
      name: String(row.name),
      sha256: String(row.sha256),
      bytes: Number(row.bytes),
      createdAt: String(row.created_at),
    };
  }
  async registerSource(input: {
    name: string;
    sha256: string;
    bytes: number;
    storageKey: string;
    extraction: Extraction;
  }) {
    const extraction = extractionSchema.parse(input.extraction);
    if (
      !/^[a-f0-9]{64}$/.test(input.sha256) ||
      input.bytes < 1 ||
      input.bytes > 10 * 1024 * 1024 ||
      input.name.length > 240
    )
      throw new DomainError("CONFIG_INVALID", "Invalid source metadata.");
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const candidate = await this.candidate(tx);
      const existing = (
        await tx.query("SELECT id FROM candidate_sources WHERE owner_id=$1 AND sha256=$2", [
          this.ownerId,
          input.sha256,
        ])
      )[0];
      if (existing) return String(existing.id);
      if (
        Number(
          (
            await tx.query("SELECT COUNT(*) AS count FROM candidate_sources WHERE owner_id=$1", [
              this.ownerId,
            ])
          )[0]?.count,
        ) >= 100
      )
        throw new DomainError("CONFIG_INVALID", "Candidate source limit reached.");
      const id = randomUUID();
      await tx.query(
        "INSERT INTO candidate_sources(owner_id,id,candidate_id,name,sha256,bytes,storage_key,extraction,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          this.ownerId,
          id,
          candidate.id ?? null,
          input.name,
          input.sha256,
          input.bytes,
          input.storageKey,
          JSON.stringify(extraction),
          this.now(),
        ],
      );
      await this.audit(
        tx,
        id,
        "candidate.source_imported",
        1,
        { sha256: input.sha256 },
        `owner:${this.ownerId}`,
      );
      return id;
    });
  }
  private async writeFact(tx: SqlExecutor, candidateId: string, fact: CandidateFact) {
    await tx.query(
      "INSERT INTO fact_versions(owner_id,id,revision,candidate_id,data,created_at) VALUES($1,$2,$3,$4,$5,$6)",
      [this.ownerId, fact.id, fact.revision, candidateId, JSON.stringify(fact), this.now()],
    );
    await tx.query(
      "INSERT INTO fact_heads(owner_id,id,revision) VALUES($1,$2,$3) ON CONFLICT(owner_id,id) DO UPDATE SET revision=excluded.revision",
      [this.ownerId, fact.id, fact.revision],
    );
    await tx.query("UPDATE candidates SET revision=revision+1 WHERE owner_id=$1", [this.ownerId]);
    await this.audit(
      tx,
      fact.id,
      "candidate.fact_revision",
      fact.revision,
      { status: fact.status },
      `owner:${this.ownerId}`,
    );
  }
  async saveFact(raw: FactInput): Promise<CandidateFact> {
    const input = factInputSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const candidate = await this.candidate(tx);
      const existing = input.id ? (await this.facts(tx)).find((f) => f.id === input.id) : undefined;
      if ((existing?.revision ?? 0) !== input.expectedRevision || (input.id && !existing))
        throw new DomainError("REVISION_STALE", "Fact changed or no longer exists.");
      if (
        !existing &&
        Number(
          (
            await tx.query("SELECT COUNT(*) AS count FROM fact_heads WHERE owner_id=$1", [
              this.ownerId,
            ])
          )[0]?.count,
        ) >= 2000
      )
        throw new DomainError("CONFIG_INVALID", "Candidate fact limit reached.");
      if (input.provenance.kind === "source") {
        const source = (
          await tx.query("SELECT extraction FROM candidate_sources WHERE owner_id=$1 AND id=$2", [
            this.ownerId,
            input.provenance.sourceId,
          ])
        )[0];
        const provenance = input.provenance;
        if (
          !source ||
          !extractionSchema
            .parse(json(source, "extraction"))
            .blocks.some(
              (b) => b.locator === provenance.locator && b.text.includes(provenance.quote),
            )
        )
          throw new DomainError(
            "CLAIM_UNSUPPORTED",
            "Source locator and quote must match imported evidence.",
          );
      }
      const { expectedRevision, ...fields } = input;
      const fact = factSchema.parse({
        ...fields,
        id: existing?.id ?? randomUUID(),
        revision: expectedRevision + 1,
        status: input.provenance.kind === "owner" ? "owner_asserted" : "extracted",
        recordedAt: this.now(),
        reviewedAt: input.provenance.kind === "owner" ? this.now() : null,
      });
      await this.writeFact(tx, String(candidate.id), fact);
      return fact;
    });
  }
  async reviewFact(
    id: string,
    expectedRevision: number,
    status: "verified" | "conflicting" | "expired",
  ) {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const candidate = await this.candidate(tx);
      const existing = (await this.facts(tx)).find((f) => f.id === id);
      if (!existing) throw new DomainError("NOT_FOUND", "Fact not found.");
      if (existing.revision !== expectedRevision)
        throw new DomainError("REVISION_STALE", "Fact revision is stale.");
      const fact = factSchema.parse({
        ...existing,
        revision: existing.revision + 1,
        status,
        reviewedAt: this.now(),
      });
      await this.writeFact(tx, String(candidate.id), fact);
      return fact;
    });
  }
  async publishProfile(expectedRevision: number): Promise<ProfileSnapshot> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const candidate = await this.candidate(tx);
      if (Number(candidate.revision) !== expectedRevision)
        throw new DomainError("REVISION_STALE", "Candidate changed; review the latest facts.");
      const facts = (await this.facts(tx)).filter((f) => usableFact(f, this.now().slice(0, 10)));
      if (
        facts.filter((f) => f.value.kind === "identity").length !== 1 ||
        conflictingFacts(facts).length ||
        chronology(facts, this.now().slice(0, 10)).issues.length
      )
        throw new DomainError(
          "CLAIM_UNSUPPORTED",
          "Publish requires one reviewed identity and consistent chronology and claims.",
        );
      const revision =
        Number(
          (
            await tx.query(
              "SELECT COALESCE(MAX(revision),0) AS revision FROM profile_versions WHERE owner_id=$1",
              [this.ownerId],
            )
          )[0]?.revision,
        ) + 1;
      const profile: ProfileSnapshot = {
        id: randomUUID(),
        candidateId: String(candidate.id),
        revision,
        facts,
        sha256: createHash("sha256").update(JSON.stringify(facts)).digest("hex"),
        createdAt: this.now(),
      };
      await tx.query(
        "INSERT INTO profile_versions(id,owner_id,candidate_id,revision,data,created_at) VALUES($1,$2,$3,$4,$5,$6)",
        [
          profile.id,
          this.ownerId,
          profile.candidateId,
          revision,
          JSON.stringify(profile),
          this.now(),
        ],
      );
      await tx.query(
        "UPDATE candidates SET active_profile_id=$1,revision=revision+1 WHERE owner_id=$2",
        [profile.id, this.ownerId],
      );
      const apps = await tx.query(
        "SELECT id FROM applications WHERE owner_id=$1 AND candidate_id=$2 AND state NOT IN ('CONFIRMED','HISTORICAL_SUBMITTED','IN_FLIGHT','UNKNOWN','RECONCILING','NEEDS_REVIEW','CLOSED','SKIPPED','DUPLICATE')",
        [this.ownerId, profile.candidateId],
      );
      for (const app of apps) {
        await tx.query(
          "INSERT INTO packet_validity(owner_id,packet_id,invalidated_at,reason) SELECT owner_id,id,$1,'PROFILE_STALE' FROM packets WHERE owner_id=$2 AND application_id=$3 ON CONFLICT(owner_id,packet_id) DO NOTHING",
          [this.now(), this.ownerId, app.id ?? null],
        );
        await tx.query(
          "UPDATE tasks SET state='cancelled',lease_owner=NULL,lease_until=NULL,last_error='PROFILE_STALE' WHERE owner_id=$1 AND application_id=$2 AND type IN ('assess','prepare','inspect','submit') AND state IN ('ready','leased','retry_wait')",
          [this.ownerId, app.id ?? null],
        );
        await tx.query(
          "UPDATE applications SET state='NORMALIZED',revision=revision+1,updated_at=$1 WHERE owner_id=$2 AND id=$3",
          [this.now(), this.ownerId, app.id ?? null],
        );
      }
      await this.pauseCommits(tx);
      await this.audit(
        tx,
        profile.id,
        "candidate.profile_published",
        revision,
        { invalidatedApplications: apps.length },
        `owner:${this.ownerId}`,
      );
      return profile;
    });
  }
  private async pauseCommits(tx: SqlExecutor) {
    const control = await this.readControl(tx);
    await tx.query("UPDATE controls SET data=$1,revision=revision+1 WHERE owner_id=$2", [
      JSON.stringify({ ...control, submissionsPaused: true }),
      this.ownerId,
    ]);
    for (const row of await tx.query(
      "SELECT * FROM tasks WHERE owner_id=$1 AND type='submit' AND state='leased'",
      [this.ownerId],
    ))
      await this.recoverTask(tx, taskFromRow(row), true);
  }
  async saveAuthorization(raw: PolicyInput): Promise<Authorization> {
    const parsed = policyInputSchema.parse(raw);
    const input = {
      ...parsed,
      effectiveAt: new Date(parsed.effectiveAt).toISOString(),
      expiresAt: new Date(parsed.expiresAt).toISOString(),
    };
    if (
      input.expiresAt <= this.now() ||
      Date.parse(input.expiresAt) - Date.parse(input.effectiveAt) > 90 * 86400000
    )
      throw new DomainError(
        "CONFIG_INVALID",
        "Authorization must expire within 90 days of its effective date and cannot already be expired.",
      );
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const candidate = await this.candidate(tx);
      const currentRevision = Number(
        (
          await tx.query(
            "SELECT COALESCE(MAX(revision),0) AS revision FROM authorizations WHERE owner_id=$1",
            [this.ownerId],
          )
        )[0]?.revision,
      );
      if (input.expectedRevision !== currentRevision)
        throw new DomainError("REVISION_STALE", "Authorization revision changed.");
      if (candidate.active_profile_id !== input.profileVersionId)
        throw new DomainError("PROFILE_STALE", "Authorization must refer to the active profile.");
      await this.pauseCommits(tx);
      await tx.query(
        "UPDATE authorizations SET revoked_at=$1 WHERE owner_id=$2 AND revoked_at IS NULL",
        [this.now(), this.ownerId],
      );
      const policy: Authorization = {
        ...input,
        id: randomUUID(),
        revision: currentRevision + 1,
        candidateId: String(candidate.id),
        revokedAt: null,
      };
      await tx.query(
        "INSERT INTO authorizations(id,owner_id,revision,data,effective_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
        [
          policy.id,
          this.ownerId,
          policy.revision,
          JSON.stringify(policy),
          policy.effectiveAt,
          policy.expiresAt,
        ],
      );
      await tx.query("UPDATE candidates SET active_authorization_id=$1 WHERE owner_id=$2", [
        policy.id,
        this.ownerId,
      ]);
      const control = await this.readControl(tx);
      await tx.query("UPDATE controls SET data=$1,revision=revision+1 WHERE owner_id=$2", [
        JSON.stringify({ ...control, submissionsPaused: policy.mode !== "auto_submit" }),
        this.ownerId,
      ]);
      await this.audit(
        tx,
        policy.id,
        "authorization.granted",
        policy.revision,
        { mode: policy.mode },
        `owner:${this.ownerId}`,
      );
      return policy;
    });
  }
  async revokeAuthorization(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query("SELECT * FROM authorizations WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          id,
        ])
      )[0];
      if (!row) throw new DomainError("NOT_FOUND", "Authorization not found.");
      if (row.revoked_at) return;
      await tx.query("UPDATE authorizations SET revoked_at=$1 WHERE owner_id=$2 AND id=$3", [
        this.now(),
        this.ownerId,
        id,
      ]);
      if ((await this.candidate(tx)).active_authorization_id === id) await this.pauseCommits(tx);
      await this.audit(
        tx,
        id,
        "authorization.revoked",
        Number(row.revision),
        {},
        `owner:${this.ownerId}`,
      );
    });
  }
  // The submission engine must call this in the transaction that persists commit authority.
  async checkCommit(
    tx: SqlExecutor,
    input: { applicationId: string; authorizationId: string; profileVersionId: string },
  ) {
    await this.lockOwner(tx);
    const candidate = await this.candidate(tx);
    const row = (
      await tx.query("SELECT * FROM authorizations WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        input.authorizationId,
      ])
    )[0];
    if (!row || candidate.active_authorization_id !== input.authorizationId)
      throw new DomainError("POLICY_REVOKED", "No active authorization.");
    const policy = this.policy(row);
    const control = await this.readControl(tx);
    if (
      policy.revokedAt ||
      policy.mode !== "auto_submit" ||
      policy.effectiveAt > this.now() ||
      policy.expiresAt <= this.now() ||
      control.stopped ||
      control.submissionsPaused ||
      control.restoreBlocked
    )
      throw new DomainError("POLICY_REVOKED", "New submissions are not authorized.");
    if (
      candidate.active_profile_id !== input.profileVersionId ||
      policy.profileVersionId !== input.profileVersionId
    )
      throw new DomainError("PROFILE_STALE", "Profile revision is stale.");
    const profileRow = (
      await tx.query("SELECT * FROM profile_versions WHERE owner_id=$1 AND id=$2", [
        this.ownerId,
        input.profileVersionId,
      ])
    )[0];
    if (!profileRow) throw new DomainError("PROFILE_STALE", "Profile missing.");
    const currentFacts = await this.facts(tx);
    if (
      this.profile(profileRow).facts.some(
        (f) =>
          !usableFact(f, this.now().slice(0, 10)) ||
          !currentFacts.some(
            (current) =>
              current.id === f.id &&
              current.revision === f.revision &&
              usableFact(current, this.now().slice(0, 10)),
          ),
      )
    )
      throw new DomainError("PROFILE_STALE", "Profile facts have changed or expired.");
    const app = (
      await tx.query(
        "SELECT a.*,j.data AS job_data FROM applications a JOIN jobs j ON j.owner_id=a.owner_id AND j.id=a.job_id WHERE a.owner_id=$1 AND a.id=$2",
        [this.ownerId, input.applicationId],
      )
    )[0];
    if (!app || app.candidate_id !== candidate.id)
      throw new DomainError("NOT_FOUND", "Candidate application not found.");
    if (!["READY", "INTENT_RECORDED"].includes(String(app.state)))
      throw new DomainError("STATE_INVALID", "Application is not ready to commit.");
    const job = jobInputSchema.parse(json(app, "job_data"));
    await assertDiscoveryEligibility(tx, this.ownerId, job.id, input.applicationId, this.now());
    if (
      !job.countryCode ||
      !policy.countries.includes(job.countryCode) ||
      policy.blockedEmployerIds.includes(job.employerId) ||
      !policy.roleTerms.some((term) => job.title.toLowerCase().includes(term.toLowerCase()))
    )
      throw new DomainError("POLICY_REVOKED", "Vacancy is outside the authorized scope.");
    for (const block of await tx.query(
      "SELECT * FROM question_blocks WHERE owner_id=$1 AND application_id=$2",
      [this.ownerId, input.applicationId],
    )) {
      const answer = await this.matchingAnswer(
        tx,
        String(block.semantic_key),
        String(block.meaning),
        job.employerId,
        job.countryCode,
      );
      if (!answer || answer.id !== block.resolved_answer_id)
        throw new DomainError(
          "ANSWER_UNKNOWN",
          "Required application answers are missing, changed or expired.",
        );
    }
    const since = new Date(this.clock().getTime() - 48 * 3600000).toISOString();
    const attempts = await tx.query(
      "SELECT started_at FROM attempts WHERE owner_id=$1 AND started_at >= $2",
      [this.ownerId, since],
    );
    if (
      attempts.filter((a) => localDay(new Date(String(a.started_at))) === localDay(this.clock()))
        .length >= policy.dailyLimit
    )
      throw new DomainError("RATE_LIMITED", "Daily submission limit reached.");
    return policy;
  }
  private async matchingAnswer(
    tx: SqlExecutor,
    key: string,
    meaning: string,
    employerId: string,
    country: string,
  ): Promise<ApprovedAnswer | null> {
    const facts = await this.facts(tx);
    const rows = await tx.query(
      "SELECT * FROM approved_answers WHERE owner_id=$1 AND semantic_key=$2 ORDER BY revision DESC",
      [this.ownerId, key],
    );
    for (const row of rows) {
      const a = json<ApprovedAnswer>(row);
      if (
        a.meaning !== meaning ||
        (a.employerIds.length && !a.employerIds.includes(employerId)) ||
        (a.countries.length && !a.countries.includes(country))
      )
        continue;
      if (
        a.validFrom > this.now().slice(0, 10) ||
        a.validUntil < this.now().slice(0, 10) ||
        a.evidenceFactIds.some(
          (id) =>
            !facts.some(
              (f) =>
                f.id === id &&
                f.revision === a.evidenceRevisions[id] &&
                usableFact(f, this.now().slice(0, 10)),
            ),
        )
      )
        return null;
      return {
        ...a,
        id: String(row.id),
        revision: Number(row.revision),
        approvedAt: String(row.approved_at),
      };
    }
    return null;
  }
  async saveAnswer(raw: AnswerInput): Promise<ApprovedAnswer> {
    const input = answerInputSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const candidate = await this.candidate(tx);
      const facts = await this.facts(tx);
      if (
        input.evidenceFactIds.some(
          (id) => !facts.some((f) => f.id === id && usableFact(f, this.now().slice(0, 10))),
        )
      )
        throw new DomainError("CLAIM_UNSUPPORTED", "Answers require usable reviewed facts.");
      const revision =
        Number(
          (
            await tx.query(
              "SELECT COALESCE(MAX(revision),0) AS revision FROM approved_answers WHERE owner_id=$1 AND semantic_key=$2",
              [this.ownerId, input.semanticKey],
            )
          )[0]?.revision,
        ) + 1;
      const answer: ApprovedAnswer = {
        ...input,
        evidenceRevisions: Object.fromEntries(
          input.evidenceFactIds.map((id) => [id, facts.find((f) => f.id === id)?.revision ?? 0]),
        ),
        id: randomUUID(),
        revision,
        approvedAt: this.now(),
      };
      await tx.query(
        "INSERT INTO approved_answers(owner_id,id,candidate_id,semantic_key,revision,data,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          this.ownerId,
          answer.id,
          candidate.id ?? null,
          answer.semanticKey,
          revision,
          JSON.stringify(answer),
          this.now(),
        ],
      );
      const blocks = await tx.query(
        "SELECT b.*,j.employer_id FROM question_blocks b JOIN applications a ON a.owner_id=b.owner_id AND a.id=b.application_id JOIN jobs j ON j.owner_id=a.owner_id AND j.id=a.job_id WHERE b.owner_id=$1 AND b.semantic_key=$2",
        [this.ownerId, input.semanticKey],
      );
      for (const block of blocks) {
        const match = await this.matchingAnswer(
          tx,
          String(block.semantic_key),
          String(block.meaning),
          String(block.employer_id),
          String(block.country),
        );
        await tx.query(
          "UPDATE question_blocks SET resolved_answer_id=$1 WHERE owner_id=$2 AND application_id=$3 AND semantic_key=$4",
          [match?.id ?? null, this.ownerId, block.application_id ?? null, input.semanticKey],
        );
        await tx.query(
          "UPDATE exceptions SET status=$1,resolved_at=$2 WHERE owner_id=$3 AND id=$4",
          [
            match ? "resolved" : "open",
            match ? this.now() : null,
            this.ownerId,
            block.exception_id ?? null,
          ],
        );
      }
      await this.audit(
        tx,
        answer.id,
        "candidate.answer_approved",
        revision,
        { semanticKey: input.semanticKey },
        `owner:${this.ownerId}`,
      );
      return answer;
    });
  }
  async resolveQuestion(
    applicationId: string,
    semanticKey: string,
    meaning: string,
  ): Promise<ApprovedAnswer | null> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const app = (
        await tx.query(
          "SELECT a.*,j.data AS job_data FROM applications a JOIN jobs j ON j.owner_id=a.owner_id AND j.id=a.job_id WHERE a.owner_id=$1 AND a.id=$2",
          [this.ownerId, applicationId],
        )
      )[0];
      if (!app || app.candidate_id !== (await this.candidate(tx)).id)
        throw new DomainError("NOT_FOUND", "Candidate application not found.");
      const job = jobInputSchema.parse(json(app, "job_data"));
      const answer = await this.matchingAnswer(
        tx,
        semanticKey,
        meaning,
        job.employerId,
        job.countryCode ?? "",
      );
      const block = (
        await tx.query(
          "SELECT * FROM question_blocks WHERE owner_id=$1 AND application_id=$2 AND semantic_key=$3",
          [this.ownerId, applicationId, semanticKey],
        )
      )[0];
      const exceptionId = String(block?.exception_id ?? randomUUID());
      if (!block)
        await tx.query(
          "INSERT INTO exceptions(id,owner_id,application_id,code,status,created_at) VALUES($1,$2,$3,'ANSWER_UNKNOWN','open',$4)",
          [exceptionId, this.ownerId, applicationId, this.now()],
        );
      await tx.query(
        "INSERT INTO question_blocks(owner_id,application_id,semantic_key,meaning,country,exception_id,resolved_answer_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_id,application_id,semantic_key) DO UPDATE SET meaning=excluded.meaning,country=excluded.country,resolved_answer_id=excluded.resolved_answer_id",
        [
          this.ownerId,
          applicationId,
          semanticKey,
          meaning,
          job.countryCode ?? "",
          exceptionId,
          answer?.id ?? null,
        ],
      );
      await tx.query("UPDATE exceptions SET status=$1,resolved_at=$2 WHERE owner_id=$3 AND id=$4", [
        answer ? "resolved" : "open",
        answer ? this.now() : null,
        this.ownerId,
        exceptionId,
      ]);
      await this.audit(
        tx,
        applicationId,
        answer ? "question.resolved" : "question.needs_input",
        Number(app.revision),
        { semanticKey },
      );
      return answer;
    });
  }
}
