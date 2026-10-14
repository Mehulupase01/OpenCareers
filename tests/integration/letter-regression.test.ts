import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AllocationClass } from "../../packages/contracts/src/agents.js";
import {
  DomainError,
  LetterClaimError,
  type LetterClaimReason,
  letterClaimReasonSchema,
} from "../../packages/contracts/src/index.js";
import { compileLetterProposal } from "../../packages/documents/src/letter-draft.js";
import { LetterDraftRunner } from "../../packages/documents/src/letter-gateway.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { MatchingRepository } from "../../packages/persistence/src/matching-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { RegressionRepository } from "../../packages/persistence/src/regression-repository.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { parseRegressionFixture } from "../../packages/security/src/regression-fixture.js";
import { importRegressionFixture } from "../../scripts/regression-import.js";
import { letterClaimCase } from "../helpers/letter-claim-cases.js";
import { syntheticCatalogue } from "../helpers/route-fixtures.js";

const model = "synthetic/model:free";
const provider = "synthetic-provider";
const sentinel = "Synthetic Private Prose Sentinel";
const failedClaim = {
  status: "failed",
  errorCode: "CLAIM_UNSUPPORTED",
  letterClaimReason: "invented_quantity",
} as const;

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} joined rejected-letter regression workflow`,
    () => {
      let db: Database;
      let owner: string;
      let applicationId: string;
      let ledger: MatchingRepository;
      let proposals: RegressionRepository;
      let root: string | undefined;
      const configure = async (repository: MatchingRepository) =>
        repository.setRoute(syntheticCatalogue(model), {
          eligible: true,
          modelId: model,
          provider,
          reasons: [],
          catalogueFetchedAt: new Date().toISOString(),
        });
      beforeEach(async () => {
        db =
          engine === "sqlite"
            ? await openSqlite(":memory:")
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        owner = `letter-regression-${randomUUID()}`;
        const repository = new Repository(db, owner);
        await repository.initialize();
        await repository.putJob(letterClaimCase("invented_quantity").input.job);
        applicationId = (await repository.createApplication("job-documents", "synthetic-candidate"))
          .id;
        ledger = new MatchingRepository(db, owner);
        proposals = new RegressionRepository(db, owner);
        await configure(ledger);
      });
      afterEach(async () => {
        vi.restoreAllMocks();
        await db?.close();
        if (root) await rm(root, { recursive: true, force: true });
        root = undefined;
      });
      const boundCase = (reason: LetterClaimReason) => {
        const fixture = structuredClone(letterClaimCase(reason));
        fixture.input.assessment.applicationId = applicationId;
        fixture.input.requestedAnswers = fixture.input.requestedAnswers.filter(
          (answer) => answer.semanticKey === "right_to_work",
        );
        return fixture;
      };
      const transport = (responses: string[], routeModel = model) => ({
        complete: vi.fn(async () => ({
          model: routeModel,
          provider,
          content: responses.shift() ?? "{}",
          usage: { promptTokens: 10, completionTokens: 2 },
        })),
      });
      const reservations = () =>
        db.query(
          "SELECT id,state,error_code,allocation_class,completed_at FROM inference_reservations WHERE owner_id=$1 ORDER BY id",
          [owner],
        );
      const reserve = async (allocation: AllocationClass = "packet_drafting", sent = true) => {
        const reservation = await ledger.reserve(
          model,
          provider,
          50,
          applicationId,
          undefined,
          allocation,
        );
        if (sent) await ledger.markSent(reservation.id, "a".repeat(64));
        return reservation;
      };

      it.each(letterClaimReasonSchema.options)(
        "joins %s rejection, consumed reservation, review, import and executable synthetic validation",
        async (reason) => {
          const { input, content, proposal } = boundCase(reason);
          if (reason === "changed_vacancy") proposal.opening += ` ${sentinel}`;
          else proposal.motivation += ` ${sentinel}`;
          const service = transport([JSON.stringify(proposal)]);
          const control = await ledger.getControl();
          await expect(
            new LetterDraftRunner(ledger, 50, service).draft(input, content),
          ).rejects.toMatchObject({ code: "CLAIM_UNSUPPORTED", reason });
          expect(service.complete).toHaveBeenCalledTimes(1);
          expect((await ledger.snapshot(50)).budget.used).toBe(1);
          expect(await reservations()).toMatchObject([
            {
              state: "failed",
              error_code: "CLAIM_UNSUPPORTED",
              allocation_class: "packet_drafting",
            },
          ]);
          const items = await proposals.list();
          expect(items).toHaveLength(1);
          const item = items[0];
          if (!item) throw new Error("Missing captured letter proposal.");
          expect(item).toMatchObject({
            state: "proposed",
            revision: 1,
            fixture: {
              schemaVersion: 1,
              kind: "unsupported_letter_claim",
              reviewed: true,
              variant: reason,
            },
          });
          expect(
            await db.query(
              "SELECT actor FROM audit_events WHERE owner_id=$1 AND action='regression.proposed'",
              [owner],
            ),
          ).toEqual([{ actor: "system:regression" }]);
          await expect(proposals.export(item.id)).rejects.toMatchObject({ code: "POLICY_REVOKED" });
          await proposals.review(item.id, {
            expectedRevision: 1,
            decision: "approved",
            reviewed: true,
          });
          const exported = await proposals.export(item.id);
          const bytes = `${JSON.stringify(exported, null, 2)}\n`;
          expect(createHash("sha256").update(bytes).digest("hex")).toBe(item.sha256);
          root = await realpath(await mkdtemp(join(tmpdir(), "opencareers-letter-regression-")));
          await mkdir(join(root, "tests", "fixtures"), { recursive: true });
          const source = join(root, "reviewed-download.json");
          await writeFile(source, bytes);
          await expect(importRegressionFixture(root, source, false)).rejects.toThrow("Reviewed");
          const imported = await importRegressionFixture(root, source, true);
          expect(imported.filename).toBe(`${item.sha256}.json`);
          expect(await importRegressionFixture(root, source, true)).toEqual(imported);
          const folder = join(root, "tests", "fixtures", "regressions");
          const files = await readdir(folder);
          expect(files).toEqual([imported.filename]);
          const publishedBytes = await readFile(join(folder, imported.filename), "utf8");
          expect(publishedBytes).toBe(bytes);
          const published = parseRegressionFixture(JSON.parse(publishedBytes));
          if (published.kind !== "unsupported_letter_claim")
            throw new Error("Wrong published category.");
          const synthetic = letterClaimCase(letterClaimReasonSchema.parse(published.variant));
          expect(() =>
            compileLetterProposal(synthetic.input, synthetic.content, synthetic.proposal),
          ).toThrow(LetterClaimError);
          expect(() =>
            compileLetterProposal(synthetic.input, synthetic.content, synthetic.proposal),
          ).toThrow(
            expect.objectContaining({ code: "CLAIM_UNSUPPORTED", reason: published.variant }),
          );
          const stored = await db.query("SELECT * FROM regression_proposals WHERE owner_id=$1", [
            owner,
          ]);
          for (const value of [JSON.stringify(stored), publishedBytes, JSON.stringify(files)]) {
            expect(value).not.toContain(sentinel);
            expect(value).not.toContain(proposal.motivation);
            expect(value).not.toContain(applicationId);
          }
          expect(await ledger.getControl()).toEqual(control);
          expect(await db.query("SELECT id FROM attempts WHERE owner_id=$1", [owner])).toEqual([]);
        },
      );

      it("captures typed repair rejection while preserving the draft and critique charges", async () => {
        const { input, content, proposal } = boundCase("invented_quantity");
        const valid = {
          ...proposal,
          motivation: "The role's focus on Python makes this platform work especially compelling.",
        };
        const service = transport([
          JSON.stringify(valid),
          JSON.stringify({ issues: [{ field: "motivation", code: "format" }] }),
          JSON.stringify(proposal),
        ]);
        await expect(
          new LetterDraftRunner(ledger, 50, service).draftWithCritique(input, content, {
            requests: 3,
            tokens: 8000,
            wallTimeMs: 30000,
          }),
        ).rejects.toMatchObject({ code: "CLAIM_UNSUPPORTED", reason: "invented_quantity" });
        expect(
          (await reservations()).map((row) => [row.allocation_class, row.state]).sort(),
        ).toEqual([
          ["independent_critique", "completed"],
          ["packet_drafting", "completed"],
          ["repairs", "failed"],
        ]);
        expect((await ledger.snapshot(50)).budget.used).toBe(3);
        expect(await proposals.list()).toMatchObject([
          { fixture: { variant: "invented_quantity" } },
        ]);
      });

      it("deduplicates different failed requests per owner and reason without reopening dismissal", async () => {
        const { input, content, proposal } = boundCase("invented_quantity");
        const service = transport([JSON.stringify(proposal), JSON.stringify(proposal)]);
        const runner = new LetterDraftRunner(ledger, 50, service);
        await expect(runner.draft(input, content)).rejects.toBeInstanceOf(LetterClaimError);
        const item = (await proposals.list())[0];
        if (!item) throw new Error("Missing captured proposal.");
        await proposals.review(item.id, {
          expectedRevision: 1,
          decision: "dismissed",
          reviewed: true,
        });
        await expect(runner.draft(input, content)).rejects.toBeInstanceOf(LetterClaimError);
        expect(await reservations()).toHaveLength(2);
        expect((await ledger.snapshot(50)).budget.used).toBe(2);
        expect(await proposals.list()).toMatchObject([
          { id: item.id, state: "dismissed", revision: 2 },
        ]);
        expect(await proposals.list()).toHaveLength(1);
        await expect(proposals.export(item.id)).rejects.toMatchObject({ code: "POLICY_REVOKED" });
        const otherOwner = `other-${owner}`;
        const otherLedger = new MatchingRepository(db, otherOwner);
        await otherLedger.initialize();
        await configure(otherLedger);
        const other = new RegressionRepository(db, otherOwner);
        expect(await other.list()).toEqual([]);
        await expect(other.export(item.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          other.review(item.id, { expectedRevision: 2, decision: "approved", reviewed: true }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        const reservation = await otherLedger.reserve(
          model,
          provider,
          50,
          undefined,
          undefined,
          "packet_drafting",
        );
        await otherLedger.markSent(reservation.id, "b".repeat(64));
        await otherLedger.finish(reservation.id, failedClaim);
        expect(await other.list()).toMatchObject([
          { state: "proposed", fixture: { variant: "invented_quantity" } },
        ]);
        expect((await other.list())[0]?.id).not.toBe(item.id);
      });

      it("rolls failed completion back to sent when capture fails, then retries without another transport call", async () => {
        const { input, content, proposal } = boundCase("invented_quantity");
        const service = transport([JSON.stringify(proposal)]);
        vi.spyOn(RegressionRepository.prototype, "captureRejectedLetter").mockRejectedValueOnce(
          new Error("synthetic capture storage failure"),
        );
        await expect(
          new LetterDraftRunner(ledger, 50, service).draft(input, content),
        ).rejects.toThrow("synthetic capture storage failure");
        const rows = await reservations();
        expect(rows).toMatchObject([{ state: "sent", error_code: null, completed_at: null }]);
        expect(await proposals.list()).toEqual([]);
        expect(
          await db.query("SELECT * FROM inference_observations WHERE owner_id=$1", [owner]),
        ).toEqual([]);
        expect(
          await db.query(
            "SELECT id FROM audit_events WHERE owner_id=$1 AND action='inference.failed'",
            [owner],
          ),
        ).toEqual([]);
        expect((await ledger.snapshot(50)).budget.used).toBe(1);
        await ledger.finish(String(rows[0]?.id), failedClaim, { latencyMs: 1, tokens: 12 });
        expect(await proposals.list()).toHaveLength(1);
        expect(await reservations()).toMatchObject([{ state: "failed" }]);
        expect(service.complete).toHaveBeenCalledTimes(1);
      });

      it.each(["invalid_json", "invalid_schema", "route_mismatch", "untyped_claim"] as const)(
        "does not mislabel %s as a categorical rejected letter",
        async (failure) => {
          const { input, content } = boundCase("invented_quantity");
          const service = transport(
            [failure === "invalid_json" ? "{" : "{}"],
            failure === "route_mismatch" ? "synthetic/wrong:free" : model,
          );
          if (failure === "untyped_claim")
            service.complete.mockRejectedValueOnce(new DomainError("CLAIM_UNSUPPORTED", sentinel));
          await expect(
            new LetterDraftRunner(ledger, 50, service).draft(input, content),
          ).rejects.toThrow();
          expect(await reservations()).toMatchObject([{ state: "failed" }]);
          expect((await ledger.snapshot(50)).budget.used).toBe(1);
          expect(await proposals.list()).toEqual([]);
        },
      );

      it.each([
        "semantic_triage",
        "independent_critique",
        "form_questions",
        "health_probes",
        "unallocated_reserve",
      ] as const)(
        "refuses categorical letter completion on %s allocations atomically",
        async (allocation) => {
          const reservation = await reserve(allocation);
          await expect(ledger.finish(reservation.id, failedClaim)).rejects.toMatchObject({
            code: "CONFIG_INVALID",
          });
          expect(await reservations()).toMatchObject([{ state: "sent" }]);
          expect(await proposals.list()).toEqual([]);
        },
      );

      it("requires sent state and CLAIM_UNSUPPORTED before capturing a typed reason", async () => {
        const reservation = await reserve("packet_drafting", false);
        await expect(ledger.finish(reservation.id, failedClaim)).rejects.toMatchObject({
          code: "REVISION_STALE",
        });
        expect(await proposals.list()).toEqual([]);
        await ledger.markSent(reservation.id, "a".repeat(64));
        await expect(
          ledger.finish(reservation.id, { ...failedClaim, errorCode: "MODEL_ROUTE_INELIGIBLE" }),
        ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
        expect(await reservations()).toMatchObject([{ state: "sent" }]);
        expect(await proposals.list()).toEqual([]);
        await ledger.finish(reservation.id, { status: "completed", responseHash: "b".repeat(64) });
        await expect(ledger.finish(reservation.id, failedClaim)).rejects.toMatchObject({
          code: "REVISION_STALE",
        });
        expect(await proposals.list()).toEqual([]);
      });
    },
  );
}
