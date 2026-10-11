import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FactInput } from "../../packages/contracts/src/candidate.js";
import { CandidateRepository } from "../../packages/persistence/src/candidate-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { RegressionRepository } from "../../packages/persistence/src/regression-repository.js";
import { compileRegressionFixture } from "../../packages/security/src/regression-fixture.js";

const employment: FactInput = {
  key: "employment.synthetic-private-marker",
  expectedRevision: 0,
  value: {
    kind: "employment",
    employer: "Synthetic Private Employer Sentinel",
    title: "Synthetic Private Role Sentinel",
    start: "2025-01",
    end: "2025-12",
    workload: "full_time",
    description: "synthetic-private-address@sentinel.invalid",
  },
  provenance: { kind: "owner", statement: "Synthetic Private Provenance Sentinel" },
  expiresOn: null,
};
for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} private regression proposals`,
    () => {
      let db: Database;
      let owner: string;
      let candidate: CandidateRepository;
      let proposals: RegressionRepository;
      const clock = () => new Date("2026-10-01T00:00:00.000Z");
      beforeEach(async () => {
        db =
          engine === "sqlite"
            ? await openSqlite(":memory:")
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `regressions-${randomUUID()}`;
        candidate = new CandidateRepository(db, owner, clock);
        await candidate.initialize();
        proposals = new RegressionRepository(db, owner, clock);
      });
      afterEach(async () => {
        vi.restoreAllMocks();
        await db?.close();
      });
      const correction = async () => {
        const initial = await candidate.saveFact(employment);
        const verified = await candidate.reviewFact(initial.id, initial.revision, "verified");
        const edited = await candidate.saveFact({
          ...employment,
          id: initial.id,
          expectedRevision: verified.revision,
          value: {
            ...employment.value,
            kind: "employment",
            employer: "Synthetic Private Employer Sentinel",
            title: "Synthetic Private Role Sentinel",
            start: "2025-01",
            end: "2025-12",
            workload: "part_time",
            description: "synthetic-private-address@sentinel.invalid",
          },
        });
        return { initial, edited };
      };
      it("captures only the reviewed correction, never private facts or automatic publication", async () => {
        const { initial, edited } = await correction();
        expect(await proposals.list()).toEqual([]);
        const verified = await candidate.reviewFact(edited.id, edited.revision, "verified");
        const items = await proposals.list();
        expect(items).toHaveLength(1);
        const item = items[0];
        if (!item) throw new Error("Expected proposal.");
        expect(item).toMatchObject({
          state: "proposed",
          revision: 1,
          fixture: {
            schemaVersion: 1,
            kind: "workload_correction",
            reviewed: true,
            before: "full_time",
            after: "part_time",
          },
        });
        const rows = await db.query("SELECT * FROM regression_proposals WHERE owner_id=$1", [
          owner,
        ]);
        expect(JSON.stringify(rows)).not.toMatch(
          /Sentinel|sentinel.invalid|employment.synthetic-private-marker/,
        );
        expect(JSON.stringify(rows)).not.toContain(initial.id);
        await expect(proposals.export(item.id)).rejects.toMatchObject({ code: "POLICY_REVOKED" });
        await expect(
          proposals.review(item.id, { expectedRevision: 1, decision: "approved", reviewed: false }),
        ).rejects.toThrow();
        await expect(
          proposals.review(item.id, { expectedRevision: 2, decision: "approved", reviewed: true }),
        ).rejects.toMatchObject({ code: "REVISION_STALE" });
        await proposals.review(item.id, {
          expectedRevision: 1,
          decision: "approved",
          reviewed: true,
        });
        expect(
          await proposals.review(item.id, {
            expectedRevision: 1,
            decision: "approved",
            reviewed: true,
          }),
        ).toMatchObject({ state: "approved", revision: 2 });
        const fixture = await proposals.export(item.id);
        expect(fixture).toEqual(item.fixture);
        const { schemaVersion: _, ...publicCorrection } = fixture;
        expect(compileRegressionFixture(publicCorrection).sha256).toBe(item.sha256);
        await candidate.reviewFact(verified.id, verified.revision, "verified");
        expect(await proposals.list()).toHaveLength(1);
        expect(
          (
            await db.query(
              "SELECT id FROM audit_events WHERE owner_id=$1 AND action='regression.approved'",
              [owner],
            )
          ).length,
        ).toBe(1);
        await expect(
          proposals.review(item.id, { expectedRevision: 2, decision: "dismissed", reviewed: true }),
        ).rejects.toMatchObject({ code: "STATE_INVALID" });
      });
      it("isolates owners and retains dismissal without exporting", async () => {
        const { edited } = await correction();
        await candidate.reviewFact(edited.id, edited.revision, "verified");
        const item = (await proposals.list())[0];
        if (!item) throw new Error("Expected proposal.");
        const other = new RegressionRepository(db, `other-${owner}`, clock);
        await new CandidateRepository(db, other.ownerId, clock).initialize();
        expect(await other.list()).toEqual([]);
        await expect(other.export(item.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          other.review(item.id, { expectedRevision: 1, decision: "approved", reviewed: true }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await proposals.review(item.id, {
          expectedRevision: 1,
          decision: "dismissed",
          reviewed: true,
        });
        await expect(proposals.export(item.id)).rejects.toMatchObject({ code: "POLICY_REVOKED" });
        await db.query("UPDATE regression_proposals SET data='{}' WHERE owner_id=$1 AND id=$2", [
          owner,
          item.id,
        ]);
        await expect(proposals.list()).rejects.toThrow();
        await expect(proposals.export(item.id)).rejects.toThrow();
      });
      it("rolls back a fact review when proposal persistence fails and retries without duplication", async () => {
        const { edited } = await correction();
        vi.spyOn(RegressionRepository.prototype, "captureFact").mockRejectedValueOnce(
          new Error("synthetic storage failure"),
        );
        await expect(candidate.reviewFact(edited.id, edited.revision, "verified")).rejects.toThrow(
          "synthetic storage failure",
        );
        expect(
          (await candidate.snapshot()).facts.find((fact) => fact.id === edited.id),
        ).toMatchObject({ revision: edited.revision, status: "owner_asserted" });
        expect(await proposals.list()).toEqual([]);
        await candidate.reviewFact(edited.id, edited.revision, "verified");
        expect(await proposals.list()).toHaveLength(1);
        expect(
          (
            await db.query(
              "SELECT id FROM audit_events WHERE owner_id=$1 AND action='regression.proposed'",
              [owner],
            )
          ).length,
        ).toBe(1);
      });
    },
  );
}
