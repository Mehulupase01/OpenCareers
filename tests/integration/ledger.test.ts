import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const LEDGER_PATH = "docs/phase-ledger.json";
const STATUSES = [
  "not_started",
  "in_progress",
  "code_complete_verification_pending",
  "blocked_external",
  "failed_gate",
  "complete",
];
const SCENARIOS = new Set(
  Array.from({ length: 32 }, (_, index) => `T${String(index + 1).padStart(2, "0")}`),
);
const PATH_LIKE = /^(docs|tests|packages|apps|scripts|deploy)\//;

const root = resolve(import.meta.dirname, "..", "..");
const ledger = JSON.parse(readFileSync(resolve(root, LEDGER_PATH), "utf8")) as {
  schemaVersion: number;
  statusVocabulary: string[];
  traceability: string;
  migratedAt: string;
  phases: {
    id: string;
    title: string;
    status: string;
    dependsOn: string[];
    tickets: {
      id: string;
      text: string;
      status: string;
      nextAction: string | null;
      acceptanceTests: string[];
      evidence: string[];
    }[];
    gates: { id: string; requirement: string; status: string; evidence: string[] }[];
    externalVerification: { status: string; note: string };
    externalPrerequisites: string[];
    lastVerifiedCommit: string | null;
    remoteVerification: { runId: string; commit: string; lanes: string[]; covers: string }[];
    acceptanceTests: string[];
    nextAction: string | null;
    evidence: string[];
  }[];
};

const byId = new Map(ledger.phases.map((phase) => [phase.id, phase]));

describe("phase ledger", () => {
  it("uses the masterplan status vocabulary and names what it is audited against", () => {
    expect(ledger.schemaVersion).toBe(2);
    expect(ledger.statusVocabulary).toEqual(STATUSES);
    expect(ledger.migratedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(existsSync(resolve(root, ledger.traceability))).toBe(true);
  });

  it("covers every phase from P00 to the current highest phase", () => {
    const ids = ledger.phases.map((phase) => phase.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("P00");
    expect(ids).toContain("P17");
    for (const phase of ledger.phases) {
      expect(phase.dependsOn.every((dependency) => byId.has(dependency))).toBe(true);
      expect(phase.dependsOn).not.toContain(phase.id);
    }
  });

  it("never records a complete phase with an open gate, ticket, or missing commit", () => {
    for (const phase of ledger.phases) {
      if (phase.status !== "complete") continue;
      expect(phase.gates.filter((gate) => gate.status !== "complete")).toHaveLength(0);
      expect(phase.tickets.filter((ticket) => ticket.status !== "complete")).toHaveLength(0);
      expect(phase.lastVerifiedCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(phase.nextAction).toBeNull();
    }
  });

  it("requires evidence for every complete gate and refuses an unevidenced completion", () => {
    for (const phase of ledger.phases) {
      for (const gate of phase.gates) {
        expect(STATUSES).toContain(gate.status);
        expect(gate.requirement.trim().length).toBeGreaterThanOrEqual(20);
        if (gate.status === "complete") expect(gate.evidence.length).toBeGreaterThan(0);
      }
    }
  });

  it("separates a gate awaiting a private prerequisite from unstarted engineering", () => {
    const p08 = byId.get("P08");
    expect(p08?.status).toBe("code_complete_verification_pending");
    const live = p08?.gates.find((gate) => gate.id === "P08-G6");
    expect(live?.status).toBe("blocked_external");
    expect(p08?.externalVerification.status).toBe("blocked_external");
    expect(p08?.externalPrerequisites.length).toBeGreaterThan(0);
    expect(p08?.nextAction).toBe("close P08-G6");
  });

  it("keeps unstarted work addressable through a next action", () => {
    for (const phase of ledger.phases) {
      const openTicket = phase.tickets.some((ticket) => ticket.status !== "complete");
      if (phase.status === "complete") {
        expect(phase.nextAction).toBeNull();
        continue;
      }
      expect(phase.nextAction).toBeTruthy();
      if (!openTicket) expect(phase.nextAction).toMatch(/^close P\d{2}-G\d+$/);
    }
  });

  it("carries no truncated ticket text", () => {
    for (const phase of ledger.phases) {
      for (const ticket of phase.tickets) {
        expect(ticket.id.startsWith(`${phase.id}-`)).toBe(true);
        expect(ticket.text.trim().length).toBeGreaterThanOrEqual(40);
        expect(ticket.text.trimEnd()).toMatch(/[.):]$/);
        expect(STATUSES).toContain(ticket.status);
        if (ticket.status === "complete") expect(ticket.nextAction).toBeNull();
        else expect(ticket.nextAction?.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("references only scenario identifiers the masterplan actually defines", () => {
    for (const phase of ledger.phases) {
      for (const id of phase.acceptanceTests) expect(SCENARIOS.has(id)).toBe(true);
      for (const ticket of phase.tickets) {
        for (const id of ticket.acceptanceTests) expect(SCENARIOS.has(id)).toBe(true);
      }
    }
  });

  it("resolves every evidence path it claims and tracks it as a plan or report", () => {
    for (const phase of ledger.phases) {
      expect(phase.evidence.length).toBeGreaterThan(0);
      for (const entry of [
        ...phase.evidence,
        ...phase.tickets.flatMap((t) => t.evidence),
        ...phase.gates.flatMap((g) => g.evidence),
      ]) {
        expect(PATH_LIKE.test(entry)).toBe(true);
        expect(existsSync(resolve(root, entry))).toBe(true);
      }
    }
  });

  it("records a real commit for every remote verification claim", () => {
    for (const phase of ledger.phases) {
      for (const run of phase.remoteVerification) {
        expect(run.runId).toMatch(/^\d{5,}$/);
        expect(run.commit).toMatch(/^[0-9a-f]{40}$/);
        expect(run.lanes.length).toBeGreaterThan(0);
        expect(run.covers.length).toBeGreaterThan(20);
      }
    }
  });

  it("reopens P10 when later workflow evidence contradicts the previous closure", () => {
    const p10 = byId.get("P10");
    expect(p10?.status).toBe("in_progress");
    expect(p10?.gates.filter((gate) => gate.status !== "complete").map((gate) => gate.id)).toEqual([
      "P10-G3",
      "P10-G6",
      "P10-G7",
    ]);
    expect(p10?.gates).toHaveLength(7);
    expect(p10?.nextAction).toBeTruthy();
    expect(p10?.evidence).toContain("docs/evidence/WORKFLOW-RECOVERY.md");
    expect(p10?.lastVerifiedCommit).toMatch(/^[0-9a-f]{40}$/);
    for (const gate of p10?.gates ?? [])
      for (const entry of gate.evidence) expect(existsSync(resolve(root, entry))).toBe(true);
  });

  it("tracks the owner-added breadth phase without borrowing P09 evidence", () => {
    const p18 = byId.get("P18");
    expect(p18).toBeDefined();
    expect(p18?.dependsOn).toContain("P10");
    expect(p18?.gates).toHaveLength(7);
    expect(p18?.externalVerification.status).toBe("not_required");
    expect(p18?.gates.every((gate) => gate.status === "not_started")).toBe(true);
    const p09 = byId.get("P09");
    expect(p09?.status).toBe("complete");
    expect(p09?.evidence).toContain("docs/plans/P09-portal-breadth-amendment.md");
  });
});
