import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateFact, FactInput } from "../../packages/contracts/src/candidate.js";
import { CandidateRepository } from "../../packages/persistence/src/candidate-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
  type SqlExecutor,
} from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { RegressionRepository } from "../../packages/persistence/src/regression-repository.js";
import { parseRegressionFixture } from "../../packages/security/src/regression-fixture.js";
import { importRegressionFixture } from "../../scripts/regression-import.js";
import { factCorrectionCase, verifyFactCorrection } from "../helpers/fact-regression-cases.js";

const variants = ["employment_period", "language_level", "metric_value"] as const;
type Variant = (typeof variants)[number];
const sentinel = "Synthetic Private Fact Provenance Sentinel";
const privateKey = "synthetic-private-fact-key";

function factInput(fact: CandidateFact, existing?: CandidateFact): FactInput {
  return {
    ...(existing ? { id: existing.id } : {}),
    expectedRevision: existing?.revision ?? 0,
    key: privateKey,
    value: structuredClone(fact.value),
    provenance: { kind: "owner", statement: sentinel },
    expiresOn: null,
  };
}

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} joined categorical fact correction regressions`,
    () => {
      let db: Database;
      let owner: string;
      let candidate: CandidateRepository;
      let proposals: RegressionRepository;
      let root: string | undefined;
      const clock = () => new Date("2026-10-01T00:00:00.000Z");

      beforeEach(async () => {
        db =
          engine === "sqlite"
            ? await openSqlite(":memory:")
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `fact-regression-${randomUUID()}`;
        candidate = new CandidateRepository(db, owner, clock);
        await candidate.initialize();
        proposals = new RegressionRepository(db, owner, clock);
      });

      afterEach(async () => {
        vi.restoreAllMocks();
        await db?.close();
        if (root) await rm(root, { recursive: true, force: true });
        root = undefined;
      });

      const edit = async (variant: Variant, simultaneous = false) => {
        const { before, after } = factCorrectionCase(variant);
        const initial = await candidate.saveFact(factInput(before));
        const verified = await candidate.reviewFact(initial.id, initial.revision, "verified");
        if (simultaneous) {
          if (after.value.kind !== "employment") throw new Error("Expected employment fact.");
          after.value.workload = after.value.workload === "full_time" ? "part_time" : "full_time";
        }
        const edited = await candidate.saveFact(factInput(after, verified));
        return { initial, verified, edited };
      };
      const proposalAudits = () =>
        db.query("SELECT * FROM audit_events WHERE owner_id=$1 AND action='regression.proposed'", [
          owner,
        ]);

      it.each(variants)(
        "joins reviewed %s correction, explicit approval, import and real synthetic validation",
        async (variant) => {
          const { initial, edited } = await edit(variant);
          expect(await proposals.list()).toEqual([]);
          const reviewed = await candidate.reviewFact(edited.id, edited.revision, "verified");
          const items = await proposals.list();
          expect(items).toHaveLength(1);
          const item = items[0];
          if (!item) throw new Error("Missing fact correction proposal.");
          expect(item).toMatchObject({ state: "proposed", revision: 1 });
          expect(item.fixture).toEqual({
            schemaVersion: 1,
            kind: "fact_correction",
            reviewed: true,
            variant,
          });
          await expect(proposals.export(item.id)).rejects.toMatchObject({ code: "POLICY_REVOKED" });
          await expect(
            proposals.review(item.id, {
              expectedRevision: 1,
              decision: "approved",
              reviewed: false,
            }),
          ).rejects.toThrow();
          await expect(
            proposals.review(item.id, {
              expectedRevision: 2,
              decision: "approved",
              reviewed: true,
            }),
          ).rejects.toMatchObject({ code: "REVISION_STALE" });
          const decision = { expectedRevision: 1, decision: "approved", reviewed: true } as const;
          const approved = await proposals.review(item.id, decision);
          expect(approved).toMatchObject({ state: "approved", revision: 2 });
          expect(await proposals.review(item.id, decision)).toEqual(approved);
          await candidate.reviewFact(reviewed.id, reviewed.revision, "verified");
          expect(await proposals.list()).toEqual([approved]);
          expect(await proposalAudits()).toHaveLength(1);
          expect(
            await db.query(
              "SELECT id FROM audit_events WHERE owner_id=$1 AND action='regression.approved'",
              [owner],
            ),
          ).toHaveLength(1);

          const exported = await proposals.export(item.id);
          const bytes = `${JSON.stringify(exported, null, 2)}\n`;
          expect(createHash("sha256").update(bytes).digest("hex")).toBe(item.sha256);
          root = await realpath(await mkdtemp(join(tmpdir(), "opencareers-fact-regression-")));
          await mkdir(join(root, "tests", "fixtures"), { recursive: true });
          const source = join(root, "reviewed-download.json");
          await writeFile(source, bytes);
          const folder = join(root, "tests", "fixtures", "regressions");
          await expect(readdir(folder)).rejects.toMatchObject({ code: "ENOENT" });
          await expect(importRegressionFixture(root, source, false)).rejects.toThrow("Reviewed");
          const imported = await importRegressionFixture(root, source, true);
          expect(imported.filename).toBe(`${item.sha256}.json`);
          expect(await importRegressionFixture(root, source, true)).toEqual(imported);
          const files = await readdir(folder);
          expect(files).toEqual([imported.filename]);
          const publishedBytes = await readFile(join(folder, imported.filename), "utf8");
          expect(publishedBytes).toBe(bytes);
          const published = parseRegressionFixture(JSON.parse(publishedBytes));
          if (published.kind !== "fact_correction") throw new Error("Wrong published category.");
          expect(published.variant).toBe(variant);
          verifyFactCorrection(published.variant);

          const stored = await db.query("SELECT * FROM regression_proposals WHERE owner_id=$1", [
            owner,
          ]);
          for (const value of [JSON.stringify(stored), publishedBytes, JSON.stringify(files)]) {
            for (const privateValue of [
              sentinel,
              privateKey,
              initial.id,
              JSON.stringify(initial.value),
              JSON.stringify(edited.value),
            ]) {
              expect(value).not.toContain(privateValue);
            }
          }
          expect(publishedBytes).not.toContain(owner);
          expect(JSON.stringify(files)).not.toContain(owner);
        },
      );

      it.each(variants)("does not capture %s no-op reviews", async (variant) => {
        const { before } = factCorrectionCase(variant);
        const initial = await candidate.saveFact(factInput(before));
        const verified = await candidate.reviewFact(initial.id, initial.revision, "verified");
        const unchanged = await candidate.saveFact(factInput(before, verified));
        await candidate.reviewFact(unchanged.id, unchanged.revision, "verified");
        expect(await proposals.list()).toEqual([]);
        expect(await proposalAudits()).toEqual([]);
      });

      it.each(variants)("does not capture %s without a verified baseline", async (variant) => {
        const { before, after } = factCorrectionCase(variant);
        const initial = await candidate.saveFact(factInput(before));
        const edited = await candidate.saveFact(factInput(after, initial));
        expect(await proposals.list()).toEqual([]);
        await candidate.reviewFact(edited.id, edited.revision, "verified");
        expect(await proposals.list()).toEqual([]);
        expect(await proposalAudits()).toEqual([]);
      });

      it.each(variants)(
        "retains %s dismissal and refuses export or later approval",
        async (variant) => {
          const { edited } = await edit(variant);
          const reviewed = await candidate.reviewFact(edited.id, edited.revision, "verified");
          const item = (await proposals.list())[0];
          if (!item) throw new Error("Missing proposal to dismiss.");
          const decision = { expectedRevision: 1, decision: "dismissed", reviewed: true } as const;
          const dismissed = await proposals.review(item.id, decision);
          expect(await proposals.review(item.id, decision)).toEqual(dismissed);
          await candidate.reviewFact(reviewed.id, reviewed.revision, "verified");
          expect(await proposals.list()).toEqual([dismissed]);
          await expect(proposals.export(item.id)).rejects.toMatchObject({ code: "POLICY_REVOKED" });
          await expect(
            proposals.review(item.id, {
              expectedRevision: 2,
              decision: "approved",
              reviewed: true,
            }),
          ).rejects.toMatchObject({ code: "STATE_INVALID" });
        },
      );

      it("captures simultaneous workload and period edits as two distinct proposals", async () => {
        const { verified, edited } = await edit("employment_period", true);
        const reviewed = await candidate.reviewFact(edited.id, edited.revision, "verified");
        const items = await proposals.list();
        expect(items).toHaveLength(2);
        expect(items.map((item) => item.fixture)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "workload_correction" }),
            {
              schemaVersion: 1,
              kind: "fact_correction",
              reviewed: true,
              variant: "employment_period",
            },
          ]),
        );
        const rows = await db.query("SELECT * FROM regression_proposals WHERE owner_id=$1", [
          owner,
        ]);
        expect(new Set(rows.map((row) => row.event_sha256)).size).toBe(2);
        const workload = rows.find(
          (row) => JSON.parse(String(row.data)).kind === "workload_correction",
        );
        expect(workload?.event_sha256).toBe(
          createHash("sha256")
            .update(JSON.stringify({ owner, before: verified, after: reviewed }))
            .digest("hex"),
        );
        await candidate.reviewFact(reviewed.id, reviewed.revision, "verified");
        expect(await proposals.list()).toEqual(items);
        expect(await proposalAudits()).toHaveLength(2);
      });

      it("rolls back the review and first proposal when the second proposal INSERT fails", async () => {
        const { edited } = await edit("employment_period", true);
        const snapshot = await candidate.snapshot();
        const versions = await db.query(
          "SELECT * FROM fact_versions WHERE owner_id=$1 ORDER BY revision",
          [owner],
        );
        const audits = await db.query("SELECT * FROM audit_events WHERE owner_id=$1 ORDER BY id", [
          owner,
        ]);
        const transaction = db.transaction.bind(db);
        let inserts = 0;
        const interception = vi.spyOn(db, "transaction").mockImplementation(
          <T>(operation: (tx: SqlExecutor) => Promise<T>): Promise<T> =>
            transaction((tx) =>
              operation({
                dialect: tx.dialect,
                query: (sql, values) => {
                  if (/^INSERT INTO regression_proposals\b/.test(sql) && ++inserts === 2)
                    throw new Error("synthetic second proposal INSERT failure");
                  return tx.query(sql, values);
                },
              }),
            ),
        );
        await expect(candidate.reviewFact(edited.id, edited.revision, "verified")).rejects.toThrow(
          "synthetic second proposal INSERT failure",
        );
        expect(inserts).toBe(2);
        interception.mockRestore();
        expect(await candidate.snapshot()).toEqual(snapshot);
        expect(await proposals.list()).toEqual([]);
        expect(
          await db.query("SELECT * FROM fact_versions WHERE owner_id=$1 ORDER BY revision", [
            owner,
          ]),
        ).toEqual(versions);
        expect(
          await db.query("SELECT * FROM audit_events WHERE owner_id=$1 ORDER BY id", [owner]),
        ).toEqual(audits);
        await candidate.reviewFact(edited.id, edited.revision, "verified");
        expect(await proposals.list()).toHaveLength(2);
        expect(await proposalAudits()).toHaveLength(2);
      });
    },
  );
}
