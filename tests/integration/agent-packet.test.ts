import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import type { PacketGenerationInput } from "../../packages/documents/src/domain.js";
import { generatePacketContent } from "../../packages/documents/src/domain.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import { LetterDraftRunner } from "../../packages/documents/src/letter-gateway.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { MatchingRepository } from "../../packages/persistence/src/matching-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";
import { syntheticCatalogue } from "../helpers/route-fixtures.js";

const model = "synthetic/model:free";
const provider = "synthetic-provider";
const limits = { requests: 3, tokens: 1000, wallTimeMs: 30000 };
for (const engine of ["sqlite", "postgres"] as const)
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} bounded reviewed LLM packets`,
    () => {
      let db: Database;
      let owner: string;
      let ledger: MatchingRepository;
      let input: PacketGenerationInput;
      beforeEach(async () => {
        db =
          engine === "postgres"
            ? await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string)
            : await openSqlite(":memory:");
        await migrate(db);
        owner = `packet-agent-${randomUUID()}`;
        const repository = new Repository(db, owner);
        await repository.initialize();
        input = structuredClone(documentGenerationInput());
        input.requestedAnswers = input.requestedAnswers.filter(
          (answer) => answer.semanticKey === "right_to_work",
        );
        await repository.putJob(input.job);
        const app = await repository.createApplication(input.job.id, "candidate");
        input.assessment.applicationId = app.id;
        ledger = new MatchingRepository(db, owner);
        await ledger.setRoute(syntheticCatalogue(model), {
          eligible: true,
          modelId: model,
          provider,
          reasons: [],
          catalogueFetchedAt: new Date().toISOString(),
        });
      });
      afterEach(async () => {
        await db?.close();
      });
      const transport = (proposals: unknown[]) => ({
        complete: vi.fn(async () => ({
          model,
          provider,
          content: JSON.stringify(proposals.shift()),
          usage: { promptTokens: 10, completionTokens: 2 },
        })),
      });
      const proposal = () => {
        const content = generatePacketContent(input);
        return {
          opening: content.letter.opening,
          motivation: "The role's focus on Python makes this platform work especially compelling.",
          contributionIds: [content.letter.contributions[0]?.id ?? "missing"],
        };
      };
      it("repairs once, charges independent classes and renders validated local artifacts", async () => {
        const service = transport([
          proposal(),
          { issues: [{ field: "motivation", code: "format" }] },
          {
            ...proposal(),
            motivation:
              "The role's focus on Python makes the platform opportunity particularly compelling.",
          },
        ]);
        const result = await new LetterDraftRunner(ledger, 50, service).draftWithCritique(
          input,
          generatePacketContent(input),
          limits,
        );
        expect(result.repaired).toBe(true);
        expect(result.validation.status).toBe("valid");
        const classes = await db.query(
          "SELECT allocation_class,state FROM inference_reservations WHERE owner_id=$1 ORDER BY allocation_class",
          [owner],
        );
        expect(classes).toEqual([
          { allocation_class: "independent_critique", state: "completed" },
          { allocation_class: "packet_drafting", state: "completed" },
          { allocation_class: "repairs", state: "completed" },
        ]);
        const dir = await mkdtemp(join(tmpdir(), "opencareers-reviewed-packet-"));
        try {
          const store = new ArtifactStore(dir);
          await store.initialize();
          const packet = await buildPacket(store, input, result);
          expect(packet.manifest.validation.status).toBe("valid");
          expect(packet.manifest.artifacts).toHaveLength(5);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
        expect(await db.query("SELECT id FROM attempts WHERE owner_id=$1", [owner])).toEqual([]);
      });
      it("does not repair when critique has no issues", async () => {
        const service = transport([proposal(), { issues: [] }]);
        const result = await new LetterDraftRunner(ledger, 50, service).draftWithCritique(
          input,
          generatePacketContent(input),
          limits,
        );
        expect(result.repaired).toBe(false);
        expect(service.complete).toHaveBeenCalledTimes(2);
        expect((await ledger.snapshot(50)).budget.used).toBe(2);
      });
      it("rejects invented repaired claims and consumes the failed sent request", async () => {
        const service = transport([
          proposal(),
          { issues: [{ field: "motivation", code: "irrelevant" }] },
          {
            ...proposal(),
            motivation: "Python matches my 10 years of experience deploying 100 services.",
          },
        ]);
        await expect(
          new LetterDraftRunner(ledger, 50, service).draftWithCritique(
            input,
            generatePacketContent(input),
            limits,
          ),
        ).rejects.toMatchObject({ code: "CLAIM_UNSUPPORTED" });
        expect((await ledger.snapshot(50)).budget.used).toBe(3);
        expect(
          (
            await db.query(
              "SELECT state FROM inference_reservations WHERE owner_id=$1 AND allocation_class='repairs'",
              [owner],
            )
          )[0]?.state,
        ).toBe("failed");
      });
      it("does not widen a two-request budget when a repair is needed", async () => {
        const service = transport([
          proposal(),
          { issues: [{ field: "motivation", code: "format" }] },
        ]);
        await expect(
          new LetterDraftRunner(ledger, 50, service).draftWithCritique(
            input,
            generatePacketContent(input),
            { ...limits, requests: 2 },
          ),
        ).rejects.toMatchObject({ code: "MODEL_QUOTA_EXHAUSTED" });
        expect(service.complete).toHaveBeenCalledTimes(2);
        expect((await ledger.snapshot(50)).budget.used).toBe(2);
      });
      it("never treats a critic result as authority to bypass independent validation", async () => {
        const content = generatePacketContent(input);
        content.cv.summary.text = "Invented unrelated career history.";
        const service = transport([proposal(), { issues: [] }]);
        await expect(
          new LetterDraftRunner(ledger, 50, service).draftWithCritique(input, content, limits),
        ).rejects.toMatchObject({ code: "CLAIM_UNSUPPORTED" });
        expect(await db.query("SELECT id FROM attempts WHERE owner_id=$1", [owner])).toEqual([]);
      });
      it("rejects authority fields in critique instead of repairing or approving them", async () => {
        const service = transport([proposal(), { issues: [], approved: true }]);
        await expect(
          new LetterDraftRunner(ledger, 50, service).draftWithCritique(
            input,
            generatePacketContent(input),
            limits,
          ),
        ).rejects.toThrow();
        expect(service.complete).toHaveBeenCalledTimes(2);
      });
    },
  );
