import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const LEDGER_PATH = "docs/phase-ledger.json";
const STATUSES = [
  "not_started",
  "in_progress",
  "code_complete_verification_pending",
  "blocked_external",
  "failed_gate",
  "complete",
] as const;
type Status = (typeof STATUSES)[number];

const EXTERNAL_STATUSES = ["blocked_external", "complete", "not_required"] as const;

const SHA = /^[0-9a-f]{40}$/;
const PHASE_ID = /^P\d{2}$/;
const SCENARIO_ID = /^T\d{2}$/;
const PATH_LIKE = /^(docs|tests|packages|apps|scripts|deploy)\//;

interface Gate {
  id: string;
  requirement: string;
  status: string;
  evidence: string[];
}

interface Ticket {
  id: string;
  text: string;
  status: string;
  acceptanceTests: string[];
  evidence: string[];
  nextAction: string | null;
}

interface Phase {
  id: string;
  title: string;
  status: string;
  dependsOn: string[];
  tickets: Ticket[];
  gates: Gate[];
  externalPrerequisites: string[];
  externalVerification: { status: string; note: string };
  lastVerifiedCommit: string | null;
  remoteVerification: { runId: string; commit: string; lanes: string[]; covers: string }[];
  acceptanceTests: string[];
  nextAction: string | null;
  evidence: string[];
}

const problems: string[] = [];
const fail = (where: string, message: string) => problems.push(`${where}: ${message}`);
const isStatus = (value: string): value is Status =>
  (STATUSES as readonly string[]).includes(value);

const checkPath = (where: string, value: string) => {
  if (!PATH_LIKE.test(value)) {
    fail(
      where,
      `evidence entry "${value}" is neither a repository path nor a labelled remote reference`,
    );
    return;
  }
  if (!existsSync(resolve(dirname(LEDGER_PATH), "..", value))) {
    fail(where, `evidence path "${value}" does not exist`);
  }
};

const read = (): unknown => {
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  } catch (error) {
    fail(LEDGER_PATH, `is not readable JSON: ${(error as Error).message}`);
    return null;
  }
};

const document = read() as Record<string, unknown> | null;

if (document) {
  if (document.schemaVersion !== 2)
    fail(LEDGER_PATH, `schemaVersion must be 2, found ${JSON.stringify(document.schemaVersion)}`);

  const vocabulary = document.statusVocabulary;
  if (JSON.stringify(vocabulary) !== JSON.stringify(STATUSES)) {
    fail(LEDGER_PATH, "statusVocabulary must list the Appx.D status set in order");
  }

  if (typeof document.traceability === "string") {
    checkPath(LEDGER_PATH, document.traceability);
  } else {
    fail(LEDGER_PATH, "must name the traceability document it is audited against");
  }

  const phases = document.phases;
  if (!Array.isArray(phases) || phases.length === 0) {
    fail(LEDGER_PATH, "phases must be a non-empty array");
  } else {
    const byId = new Map<string, Phase>();
    for (const phase of phases as Phase[]) {
      if (!PHASE_ID.test(phase.id ?? "")) fail(LEDGER_PATH, `phase id "${phase.id}" is malformed`);
      if (byId.has(phase.id)) fail(LEDGER_PATH, `duplicate phase id ${phase.id}`);
      byId.set(phase.id, phase);
    }

    for (const phase of phases as Phase[]) {
      const at = `phase ${phase.id}`;

      if (typeof phase.title !== "string" || phase.title.trim().length === 0) {
        fail(at, "title must be a non-empty string");
      }
      if (!isStatus(phase.status))
        fail(at, `status "${phase.status}" is not in the Appx.D vocabulary`);

      const openGate = phase.gates.find((gate) => gate.status !== "complete");
      const openTicket = phase.tickets.find((ticket) => ticket.status !== "complete");
      if (phase.status === "complete") {
        if (openGate) fail(at, `is complete but gate ${openGate.id} is ${openGate.status}`);
        if (openTicket) fail(at, `is complete but ticket ${openTicket.id} is ${openTicket.status}`);
        if (phase.lastVerifiedCommit === null) fail(at, "is complete without a lastVerifiedCommit");
        if (phase.nextAction !== null) fail(at, "is complete and must not declare a nextAction");
      } else if (typeof phase.nextAction !== "string" || phase.nextAction.trim().length === 0) {
        fail(at, "is not complete and must declare a nextAction");
      }

      if (!Array.isArray(phase.dependsOn)) {
        fail(at, "dependsOn must be an array");
      } else {
        for (const dependency of phase.dependsOn) {
          if (dependency === phase.id) fail(at, "depends on itself");
          else if (!byId.has(dependency)) fail(at, `depends on unknown phase ${dependency}`);
        }
      }

      if (phase.lastVerifiedCommit !== null && !SHA.test(String(phase.lastVerifiedCommit))) {
        fail(
          at,
          `lastVerifiedCommit "${phase.lastVerifiedCommit}" is not a 40-character commit hash`,
        );
      }

      const external = phase.externalVerification;
      if (
        !external ||
        !EXTERNAL_STATUSES.includes(external.status as (typeof EXTERNAL_STATUSES)[number])
      ) {
        fail(at, `externalVerification.status must be one of ${EXTERNAL_STATUSES.join(", ")}`);
      } else if (typeof external.note !== "string" || external.note.trim().length === 0) {
        fail(at, "externalVerification must carry a note explaining the status");
      } else if (
        external.status === "blocked_external" &&
        (!Array.isArray(phase.externalPrerequisites) || phase.externalPrerequisites.length === 0)
      ) {
        fail(at, "is blocked_external but records no externalPrerequisites");
      }

      if (!Array.isArray(phase.remoteVerification)) {
        fail(at, "remoteVerification must be an array");
      } else {
        for (const run of phase.remoteVerification) {
          if (!run.runId || !/^\d{5,}$/.test(run.runId))
            fail(at, `remote run "${run.runId}" is not a run id`);
          if (!SHA.test(String(run.commit)))
            fail(at, `remote run ${run.runId} has a malformed commit`);
          if (!Array.isArray(run.lanes) || run.lanes.length === 0)
            fail(at, `remote run ${run.runId} names no lanes`);
          if (!run.covers || run.covers.trim().length === 0)
            fail(at, `remote run ${run.runId} does not state what it covers`);
        }
      }

      for (const entry of phase.acceptanceTests ?? []) {
        if (!SCENARIO_ID.test(entry))
          fail(at, `acceptanceTests entry "${entry}" is not a T01-T32 scenario id`);
      }

      if (!Array.isArray(phase.evidence) || phase.evidence.length === 0) {
        fail(at, "evidence must name at least one document that records this phase");
      } else {
        for (const entry of phase.evidence) checkPath(`${at} evidence`, entry);
      }

      if (!Array.isArray(phase.tickets) || phase.tickets.length === 0) {
        fail(at, "tickets must be a non-empty array");
      } else {
        const seen = new Set<string>();
        for (const ticket of phase.tickets) {
          const where = `${at} ticket ${ticket.id}`;
          if (!ticket.id.startsWith(`${phase.id}-`)) fail(where, "id does not belong to its phase");
          if (seen.has(ticket.id)) fail(where, "duplicate ticket id");
          seen.add(ticket.id);

          if (!isStatus(ticket.status))
            fail(where, `status "${ticket.status}" is not in the Appx.D vocabulary`);

          const text = String(ticket.text ?? "").trim();
          if (text.length < 40) fail(where, "text is too short to describe the work package");
          if (!/[.):]$/.test(text)) {
            fail(where, `text looks truncated mid-clause: "${text.slice(-24)}"`);
          }

          for (const entry of ticket.acceptanceTests ?? []) {
            if (!SCENARIO_ID.test(entry))
              fail(where, `acceptanceTests entry "${entry}" is malformed`);
          }

          if (ticket.status === "complete") {
            if (ticket.nextAction !== null)
              fail(where, "is complete and must not declare a nextAction");
          } else if (
            typeof ticket.nextAction !== "string" ||
            ticket.nextAction.trim().length === 0
          ) {
            fail(where, "is not complete and must declare a nextAction");
          }
          for (const entry of ticket.evidence ?? []) checkPath(`${where} evidence`, entry);
        }
      }

      if (!Array.isArray(phase.gates) || phase.gates.length === 0) {
        fail(at, "gates must be a non-empty array");
      } else {
        const seen = new Set<string>();
        for (const gate of phase.gates) {
          const where = `${at} gate ${gate.id}`;
          if (!gate.id.startsWith(`${phase.id}-G`)) fail(where, "id does not belong to its phase");
          if (seen.has(gate.id)) fail(where, "duplicate gate id");
          seen.add(gate.id);

          if (!isStatus(gate.status))
            fail(where, `status "${gate.status}" is not in the Appx.D vocabulary`);
          if (String(gate.requirement ?? "").trim().length < 20)
            fail(where, "requirement is too short to be an acceptance statement");
          if (
            gate.status === "blocked_external" &&
            phase.externalVerification?.status !== "blocked_external"
          ) {
            fail(
              where,
              "is blocked_external but its phase does not record a blocked externalVerification",
            );
          }
          if (!Array.isArray(gate.evidence)) {
            fail(where, "evidence must be an array");
          } else {
            if (gate.status === "complete" && gate.evidence.length === 0) {
              fail(
                where,
                "is complete with no evidence; evidence is absent until a test or inspection supports it",
              );
            }
            for (const entry of gate.evidence) checkPath(`${where} evidence`, entry);
          }
        }
      }
    }

    for (const phase of phases as Phase[]) {
      const seen = new Set<string>();
      let cursor: string | undefined = phase.id;
      while (cursor !== undefined) {
        if (seen.has(cursor)) {
          fail(`phase ${phase.id}`, `dependency cycle through ${cursor}`);
          break;
        }
        seen.add(cursor);
        cursor = (byId.get(cursor)?.dependsOn ?? []).find((next) => !seen.has(next));
      }
    }

    if (problems.length === 0) {
      const gateStatuses = new Map<string, number>();
      let total = 0;
      for (const phase of phases as Phase[]) {
        total += phase.gates.length;
        gateStatuses.set(phase.status, (gateStatuses.get(phase.status) ?? 0) + 1);
      }
      const complete = (phases as Phase[]).reduce(
        (sum, phase) => sum + phase.gates.filter((gate) => gate.status === "complete").length,
        0,
      );
      process.stdout.write(
        `ledger ok: ${(phases as Phase[]).length} phases, ${total} gates, ${complete} complete ` +
          `(${[...gateStatuses.entries()].map(([status, count]) => `${status} x${count}`).join(", ")})\n`,
      );
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`docs/phase-ledger.json failed validation (${problems.length} problems):\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}
