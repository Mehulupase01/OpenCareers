import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PacketGenerationInput } from "../packages/documents/src/domain.js";
import { generatePacketContent } from "../packages/documents/src/domain.js";
import { LetterDraftRunner } from "../packages/documents/src/letter-gateway.js";
import { validatePacketContent } from "../packages/documents/src/validation.js";
import { fixtureProposal } from "../packages/inference/src/gateway.js";
import { productionGraphEnabled } from "../packages/inference/src/node-gateway.js";
import {
  deterministicGates,
  scoreMatch,
  validateProposal,
} from "../packages/matching/src/domain.js";
import { evaluateMatching } from "../packages/matching/src/evaluation.js";
import { openSqlite } from "../packages/persistence/src/database.js";
import { MatchingRepository } from "../packages/persistence/src/matching-repository.js";
import { migrate } from "../packages/persistence/src/migrations.js";
import { Repository } from "../packages/persistence/src/repository.js";
import { documentGenerationInput } from "../tests/fixtures/document-packets.js";
import { matchingEvaluationCases } from "../tests/fixtures/matching-evaluation.js";
import { syntheticCatalogue } from "../tests/helpers/route-fixtures.js";

const model = "synthetic/model:free";
const provider = "synthetic-provider";
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Number((sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(3));
};

export async function evaluateP12Ablation() {
  const holdout = matchingEvaluationCases.filter((entry) => entry.split === "holdout");
  const routing = evaluateMatching(holdout);
  const auto = new Set(
    routing.cases.filter((entry) => entry.actual === "auto_eligible").map((entry) => entry.id),
  );
  const variants = [];
  for (const name of ["template", "single_model", "drafter_critic"] as const) {
    const latencies: number[] = [];
    let requests = 0;
    let accepted = 0;
    let claimErrors = 0;
    let corrected = 0;
    for (const entry of holdout.filter((item) => auto.has(item.id))) {
      const input: PacketGenerationInput = structuredClone(documentGenerationInput());
      input.job = structuredClone(entry.input.job);
      const identity = input.profile.facts.find((fact) => fact.value.kind === "identity");
      if (!identity) throw new Error("Missing synthetic identity.");
      input.profile.id = entry.input.profileId;
      input.profile.facts = [identity, ...structuredClone(entry.input.facts)];
      input.authorization.profileVersionId = input.profile.id;
      input.approvedAnswers = [];
      input.requestedAnswers = [];
      const gates = deterministicGates(entry.input, input.asOf);
      const proposal = fixtureProposal(entry.input);
      const validated = validateProposal(proposal, input.job.description, entry.input.facts);
      input.assessment = {
        ...input.assessment,
        jobId: input.job.id,
        applicationId: null,
        profileId: input.profile.id,
        gates,
        requirements: validated.requirements,
        score: scoreMatch(gates, validated.requirements, validated.uncertainty),
        outcome: "auto_eligible",
      };
      const content = generatePacketContent(input);
      const db = await openSqlite(":memory:");
      try {
        await migrate(db);
        const owner = `ablation-${randomUUID()}`;
        await new Repository(db, owner).initialize();
        const ledger = new MatchingRepository(db, owner);
        await ledger.setRoute(syntheticCatalogue(model), {
          eligible: true,
          modelId: model,
          provider,
          reasons: [],
          catalogueFetchedAt: new Date().toISOString(),
        });
        let calls = 0;
        const runner = new LetterDraftRunner(ledger, 50, {
          complete: async (request) => {
            calls++;
            return {
              model,
              provider,
              usage: { promptTokens: 10, completionTokens: 2 },
              content: JSON.stringify(
                request.response_format.json_schema.name === "opencareers_letter_critique"
                  ? { issues: [] }
                  : {
                      opening: content.letter.opening,
                      motivation:
                        "The role's focus on Python makes this platform work especially compelling.",
                      contributionIds: [content.letter.contributions[0]?.id ?? "missing"],
                    },
              ),
            };
          },
        });
        const start = performance.now();
        if (name === "single_model") content.letter = (await runner.draft(input, content)).letter;
        else if (name === "drafter_critic") {
          const result = await runner.draftWithCritique(input, content, {
            requests: 3,
            tokens: 8000,
            wallTimeMs: 30000,
          });
          content.letter = result.letter;
          corrected += result.repaired ? 1 : 0;
        }
        const report = validatePacketContent({
          content,
          profile: input.profile,
          assessment: input.assessment,
          asOf: input.asOf,
          checkedAt: input.generatedAt,
        });
        latencies.push(performance.now() - start);
        requests += calls;
        if (report.status === "valid") accepted++;
        claimErrors += report.issues.filter((issue) => issue.severity === "error").length;
        if ((await db.query("SELECT id FROM attempts WHERE owner_id=$1", [owner])).length)
          throw new Error("Pure ablation created a submission attempt.");
      } finally {
        await db.close();
      }
    }
    variants.push({
      name,
      acceptedPackets: accepted,
      claimErrors,
      correctionRate: accepted ? corrected / accepted : 0,
      requests,
      requestsPerAcceptedPacket: accepted ? requests / accepted : null,
      medianLocalPreparationMs: median(latencies),
    });
  }
  return {
    evidenceKind: "synthetic_transport_not_live_model",
    holdoutJobs: holdout.length,
    holdoutSha256: createHash("sha256").update(JSON.stringify(holdout)).digest("hex"),
    routingErrors: routing.errors,
    packetEligibleJobs: auto.size,
    variants,
    productionGraphEnabled,
    decision:
      "Keep graph/review variants disabled: no measured claim-error or correction improvement; critique doubles requests on this small synthetic holdout.",
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.stdout.write(`${JSON.stringify(await evaluateP12Ablation(), null, 2)}\n`);
