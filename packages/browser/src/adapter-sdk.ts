import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { BrowserPreparation, DryRunResult } from "../../contracts/src/browser.js";
import type { PacketSnapshot } from "../../contracts/src/documents.js";
import { DomainError } from "../../contracts/src/index.js";
import type { ReceiptEvidence } from "../../contracts/src/submission.js";
import { startMockAts } from "../../mock-ats/src/server.js";
import { commitPreparedMockPacket, DefinitiveMockRejection } from "./commit-mock.js";
import { observeMockReceipt } from "./observe-mock.js";
import { prepareMockPacket } from "./prepare.js";
import {
  commitRecruiteePacket,
  prepareRecruiteePacket,
  RecruiteeDefinitiveRejection,
  type RecruiteeRequest,
  type RecruiteeTarget,
} from "./recruitee.js";

const mockTargetSchema = z.object({
  fixture: z
    .enum([
      "standard",
      "upload-fail",
      "resume-overwrite",
      "conditional",
      "challenge",
      "changed-question",
      "misleading-banner",
      "disabled-submit",
      "implicit-submit",
      "response-loss",
      "validation-reject",
    ])
    .default("standard"),
});

const recruiteeTargetSchema = z.object({
  tenant: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  offerSlug: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,119}$/),
});

export type DefinitiveReason = "MOCK_VALIDATION_REJECTED" | "RECRUITEE_VALIDATION_REJECTED";

export type AdapterCommitOutcome =
  | { status: "confirmed"; evidence: ReceiptEvidence }
  | { status: "definitive_failure"; reason: DefinitiveReason };

export interface AdapterPrepareInput {
  packet: PacketSnapshot;
  cvPdf: Buffer;
  approvedValues: Record<string, string | boolean>;
  target: unknown;
}

export interface AdapterCommitInput {
  packet: PacketSnapshot;
  cvPdf: Buffer;
  preparation: BrowserPreparation;
  target: unknown;
  authorizeDispatch: () => Promise<{ expiresAt: string }>;
}

export interface AdapterReconcileInput {
  packet: PacketSnapshot;
  target: unknown;
}

export interface SubmissionAdapter {
  readonly id: string;
  readonly version: string;
  parseTarget(input: unknown): unknown;
  prepare(input: AdapterPrepareInput): Promise<DryRunResult>;
  commit(input: AdapterCommitInput): Promise<AdapterCommitOutcome>;
  reconcile(input: AdapterReconcileInput): Promise<ReceiptEvidence | null>;
}

const targetFingerprint = (target: unknown) =>
  createHash("sha256").update(JSON.stringify(target)).digest("hex");

function assertPreparation(
  adapter: Pick<SubmissionAdapter, "id" | "version">,
  preparation: BrowserPreparation,
  target: unknown,
) {
  if (!preparation.result.adapter)
    throw new DomainError("FORM_CHANGED", "Preparation predates adapter identity binding.");
  if (
    preparation.result.adapter.id !== adapter.id ||
    preparation.result.adapter.version !== adapter.version ||
    preparation.result.adapter.targetFingerprint !== targetFingerprint(target)
  )
    throw new Error("Adapter target or version changed after preparation.");
}

function valuesFrom(preparation: BrowserPreparation) {
  return Object.fromEntries(
    preparation.result.plans.flatMap((plan) =>
      plan.entries.map((entry) => [entry.semanticKey, entry.expected]),
    ),
  );
}

function fixtureFrom(preparation: BrowserPreparation) {
  const url = new URL(preparation.result.snapshots[0]?.url ?? "");
  const match = /^\/jobs\/([a-z-]+)$/.exec(url.pathname);
  if (!match?.[1]) throw new Error("Mock preparation fixture is missing.");
  return mockTargetSchema.parse({ fixture: match[1] }).fixture;
}

class MockSubmissionAdapter implements SubmissionAdapter {
  readonly id = "mock-ats";
  readonly version = "mock-ats-v1";

  constructor(private readonly dataDir: string) {}

  parseTarget(input: unknown) {
    return mockTargetSchema.parse(input ?? {});
  }

  async prepare(input: AdapterPrepareInput) {
    const target = mockTargetSchema.parse(input.target);
    return prepareMockPacket(input.packet, input.cvPdf, input.approvedValues, target.fixture);
  }

  async commit(input: AdapterCommitInput): Promise<AdapterCommitOutcome> {
    const target = mockTargetSchema.parse(input.target);
    assertPreparation(this, input.preparation, target);
    const mock = await startMockAts(join(this.dataDir, "mock-ats-records"));
    try {
      try {
        const evidence = await commitPreparedMockPacket(
          mock,
          input.packet,
          input.cvPdf,
          valuesFrom(input.preparation),
          input.preparation,
          input.authorizeDispatch,
          fixtureFrom(input.preparation),
        );
        return { status: "confirmed", evidence };
      } catch (error) {
        if (!(error instanceof DefinitiveMockRejection)) throw error;
        return { status: "definitive_failure", reason: "MOCK_VALIDATION_REJECTED" };
      }
    } finally {
      await mock.app.close();
    }
  }

  async reconcile(input: AdapterReconcileInput) {
    const mock = await startMockAts(join(this.dataDir, "mock-ats-records"));
    try {
      return await observeMockReceipt(mock, input.packet);
    } finally {
      await mock.app.close();
    }
  }
}

class RecruiteeSubmissionAdapter implements SubmissionAdapter {
  readonly id = "recruitee";
  readonly version = "recruitee-careers-v1";

  constructor(private readonly request: RecruiteeRequest) {}

  parseTarget(input: unknown): RecruiteeTarget {
    return recruiteeTargetSchema.parse(input);
  }

  async prepare(input: AdapterPrepareInput) {
    return prepareRecruiteePacket(
      this.parseTarget(input.target),
      input.packet,
      input.cvPdf,
      input.approvedValues,
      this.request,
    );
  }

  async commit(input: AdapterCommitInput): Promise<AdapterCommitOutcome> {
    const target = this.parseTarget(input.target);
    assertPreparation(this, input.preparation, target);
    try {
      const evidence = await commitRecruiteePacket(
        target,
        input.packet,
        input.cvPdf,
        input.preparation.result,
        input.authorizeDispatch,
        this.request,
      );
      return { status: "confirmed", evidence };
    } catch (error) {
      if (!(error instanceof RecruiteeDefinitiveRejection)) throw error;
      return { status: "definitive_failure", reason: "RECRUITEE_VALIDATION_REJECTED" };
    }
  }

  async reconcile(_input: AdapterReconcileInput) {
    return null;
  }
}

export class AdapterRegistry {
  private readonly adapters: Map<string, SubmissionAdapter>;

  constructor(adapters: SubmissionAdapter[]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.id, adapter]));
    if (this.adapters.size !== adapters.length) throw new Error("Duplicate adapter ID.");
  }

  get(id: string): SubmissionAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter)
      throw new DomainError("ADAPTER_UNSUPPORTED", `Unsupported submission adapter: ${id}`);
    return adapter;
  }

  support() {
    return [...this.adapters.values()].map(({ id, version }) => ({ id, version }));
  }
}

export function createAdapterRegistry(
  dataDir: string,
  options: { recruiteeRequest?: RecruiteeRequest } = {},
) {
  return new AdapterRegistry([
    new MockSubmissionAdapter(dataDir),
    new RecruiteeSubmissionAdapter(options.recruiteeRequest ?? fetch),
  ]);
}
