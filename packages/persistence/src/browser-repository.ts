import { createHash, randomUUID } from "node:crypto";
import {
  type BrowserPreparation,
  browserPreparationSchema,
  type DryRunResult,
  dryRunResultSchema,
} from "../../contracts/src/browser.js";
import { packetManifestSchema } from "../../contracts/src/documents.js";
import { type ApplicationState, DomainError } from "../../contracts/src/index.js";
import { assertTransition } from "../../domain/src/state.js";
import { Repository } from "./repository.js";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class BrowserRepository extends Repository {
  async save(
    resultInput: DryRunResult,
    options: { queueMockSubmit?: boolean } = {},
  ): Promise<BrowserPreparation> {
    const result = dryRunResultSchema.parse(resultInput);
    const ready = result.status === "ready";
    const completeReadBack = result.snapshots.every((snapshot, index) => {
      const plan = result.plans[index];
      const report = result.reports[index];
      if (
        !plan ||
        !report ||
        plan.fingerprint !== snapshot.fingerprint ||
        report.snapshot.fingerprint !== snapshot.fingerprint ||
        plan.unresolved.length
      )
        return false;
      return snapshot.fields.every((field) => {
        if (!field.required) return true;
        const entry = plan.entries.find((item) => item.name === field.name);
        const readBack = report.readBack.find((item) => item.name === field.name);
        return Boolean(
          entry &&
            readBack &&
            readBack.expected === entry.expected &&
            readBack.actual === entry.expected &&
            readBack.matches,
        );
      });
    });
    if (
      result.serverApplicationCount !== 0 ||
      (ready &&
        (result.snapshots.length !== 2 ||
          result.plans.length !== 2 ||
          result.reports.length !== 2 ||
          !completeReadBack ||
          result.reports.some((report) => report.status !== "ready") ||
          result.reports.some((report) => report.readBack.some((field) => !field.matches)) ||
          result.reports[0]?.uploadStatus !== "accepted" ||
          result.issues.length > 0))
    )
      throw new DomainError(
        "FORM_CHANGED",
        "Browser readiness is not supported by read-back evidence.",
      );
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const row = (
        await tx.query(
          "SELECT a.state,a.revision,p.manifest,c.active_profile_id,c.active_authorization_id FROM applications a JOIN packets p ON p.owner_id=a.owner_id AND p.application_id=a.id JOIN candidates c ON c.owner_id=a.owner_id LEFT JOIN packet_validity v ON v.owner_id=p.owner_id AND v.packet_id=p.id WHERE a.owner_id=$1 AND a.id=$2 AND p.id=$3 AND v.packet_id IS NULL",
          [this.ownerId, result.applicationId, result.packetId],
        )
      )[0];
      if (!row)
        throw new DomainError("NOT_FOUND", "A valid packet is required for browser preparation.");
      const manifest = packetManifestSchema.parse(JSON.parse(String(row.manifest)));
      if (
        manifest.profileId !== row.active_profile_id ||
        manifest.authorizationId !== row.active_authorization_id ||
        manifest.validation.status !== "valid" ||
        result.snapshots.some((snapshot) => snapshot.jobId !== manifest.jobId)
      )
        throw new DomainError(
          "PROFILE_STALE",
          "The browser result no longer matches the active packet.",
        );
      let state = String(row.state) as ApplicationState;
      let revision = Number(row.revision);
      const transition = async (next: ApplicationState) => {
        assertTransition(state, next);
        const updated = await tx.query(
          "UPDATE applications SET state=$1,revision=revision+1,updated_at=$2 WHERE owner_id=$3 AND id=$4 AND revision=$5 RETURNING revision",
          [next, this.now(), this.ownerId, result.applicationId, revision],
        );
        if (!updated[0])
          throw new DomainError(
            "REVISION_STALE",
            "Application changed during browser preparation.",
          );
        revision = Number(updated[0].revision);
        await this.audit(tx, result.applicationId, "application.transitioned", revision, {
          from: state,
          to: next,
        });
        state = next;
      };
      if (state !== "INSPECTING") await transition("INSPECTING");
      const next: ApplicationState =
        result.status === "ready"
          ? "READY"
          : result.status === "challenge"
            ? "CHALLENGE_REQUIRED"
            : result.status === "unsupported"
              ? "UNSUPPORTED"
              : "NEEDS_INPUT";
      await transition(next);
      const id = randomUUID();
      const createdAt = this.now();
      const expiresAt =
        result.status === "challenge"
          ? new Date(this.clock().getTime() + 15 * 60 * 1000).toISOString()
          : null;
      await tx.query(
        "INSERT INTO browser_preparations(owner_id,id,application_id,packet_id,status,form_fingerprint,result,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          this.ownerId,
          id,
          result.applicationId,
          result.packetId,
          result.status,
          digest(result.snapshots.map((snapshot) => snapshot.fingerprint)),
          JSON.stringify(result),
          createdAt,
          expiresAt,
        ],
      );
      await this.audit(tx, id, "browser.prepared", 1, { status: result.status });
      if (ready && options.queueMockSubmit)
        await this.enqueueIn(tx, {
          type: "submit",
          dedupeKey: `mock-submit:${id}`,
          domain: "mock-ats",
          applicationId: result.applicationId,
          payload: { schemaVersion: 1, packetId: result.packetId, preparationId: id },
          priority: 50,
          maxAttempts: 1,
        });
      return browserPreparationSchema.parse({
        id,
        status: result.status,
        result,
        createdAt,
        expiresAt,
        resolvedAt: null,
      });
    });
  }

  async snapshot(): Promise<BrowserPreparation[]> {
    const rows = await this.db.query(
      "SELECT id,status,result,created_at,expires_at,resolved_at FROM browser_preparations WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
      [this.ownerId],
    );
    return rows.map((row) => {
      const result = dryRunResultSchema.parse(JSON.parse(String(row.result)));
      return browserPreparationSchema.parse({
        id: String(row.id),
        status: result.status,
        result,
        createdAt: String(row.created_at),
        expiresAt: row.expires_at ? String(row.expires_at) : null,
        resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
      });
    });
  }
}
