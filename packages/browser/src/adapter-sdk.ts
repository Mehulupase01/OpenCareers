import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { BrowserPreparation, DryRunResult } from "../../contracts/src/browser.js";
import type { BrowserSessionState } from "../../contracts/src/browser-session.js";
import type { PacketSnapshot } from "../../contracts/src/documents.js";
import { DomainError, FormDriftError } from "../../contracts/src/index.js";
import type { ReceiptEvidence } from "../../contracts/src/submission.js";
import { startMockAts } from "../../mock-ats/src/server.js";
import type { FormAnswerGuard } from "./answer-guard.js";
import { commitPreparedMockPacket, DefinitiveMockRejection } from "./commit-mock.js";
import {
  commitGreenhousePacket,
  type GreenhouseCommitOptions,
  GreenhouseDefinitiveRejection,
} from "./greenhouse-commit.js";
import type { GreenhouseTarget } from "./greenhouse-inspect.js";
import { prepareGreenhousePacket } from "./greenhouse-prepare.js";
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

const greenhouseTargetSchema = z.object({
  board: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  postingId: z.string().regex(/^[0-9]{1,20}$/),
  formFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export type DefinitiveReason =
  | "MOCK_VALIDATION_REJECTED"
  | "RECRUITEE_VALIDATION_REJECTED"
  | "GREENHOUSE_VALIDATION_REJECTED";

export type AdapterCommitOutcome =
  | { status: "confirmed"; evidence: ReceiptEvidence }
  | { status: "definitive_failure"; reason: DefinitiveReason };

export interface AdapterPrepareInput {
  packet: PacketSnapshot;
  cvPdf: Buffer;
  approvedValues: Record<string, string | boolean>;
  validateAnswers: FormAnswerGuard;
  browserSession?: BrowserSessionState;
  target: unknown;
}

export interface AdapterCommitInput {
  packet: PacketSnapshot;
  cvPdf: Buffer;
  preparation: BrowserPreparation;
  target: unknown;
  authorizeDispatch: () => Promise<{ expiresAt: string }>;
  validateAnswers: FormAnswerGuard;
  browserSession?: BrowserSessionState;
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
    throw new FormDriftError(
      "ADAPTER_IDENTITY_CHANGED",
      "Preparation predates adapter identity binding.",
    );
  if (
    preparation.result.adapter.id !== adapter.id ||
    preparation.result.adapter.version !== adapter.version ||
    preparation.result.adapter.targetFingerprint !== targetFingerprint(target)
  )
    throw new FormDriftError(
      "ADAPTER_IDENTITY_CHANGED",
      "Adapter target or version changed after preparation.",
    );
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
    return prepareMockPacket(
      input.packet,
      input.cvPdf,
      input.approvedValues,
      target.fixture,
      input.validateAnswers,
      input.browserSession,
    );
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
          input.validateAnswers,
          input.browserSession,
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
      input.validateAnswers,
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
        undefined,
        input.validateAnswers,
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

class GreenhouseSubmissionAdapter implements SubmissionAdapter {
  readonly id = "greenhouse";
  readonly version = "greenhouse-hosted-v1";

  constructor(private readonly commitOptions: GreenhouseCommitOptions = {}) {}

  parseTarget(input: unknown): GreenhouseTarget {
    return greenhouseTargetSchema.parse(input);
  }

  async prepare(input: AdapterPrepareInput) {
    return prepareGreenhousePacket(
      this.parseTarget(input.target),
      input.packet,
      input.cvPdf,
      input.approvedValues,
      this.commitOptions.configureContext,
      input.validateAnswers,
      input.browserSession,
    );
  }

  async commit(input: AdapterCommitInput): Promise<AdapterCommitOutcome> {
    const target = this.parseTarget(input.target);
    assertPreparation(this, input.preparation, target);
    try {
      const evidence = await commitGreenhousePacket(
        target,
        input.packet,
        input.cvPdf,
        input.preparation,
        input.authorizeDispatch,
        {
          ...this.commitOptions,
          validateAnswers: input.validateAnswers,
          ...(input.browserSession ? { browserSession: input.browserSession } : {}),
        },
      );
      return { status: "confirmed", evidence };
    } catch (error) {
      if (!(error instanceof GreenhouseDefinitiveRejection)) throw error;
      return { status: "definitive_failure", reason: "GREENHOUSE_VALIDATION_REJECTED" };
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
  options: {
    recruiteeRequest?: RecruiteeRequest;
    greenhouseCommit?: GreenhouseCommitOptions;
  } = {},
) {
  return new AdapterRegistry([
    new MockSubmissionAdapter(dataDir),
    new RecruiteeSubmissionAdapter(options.recruiteeRequest ?? fetch),
    new GreenhouseSubmissionAdapter(options.greenhouseCommit),
  ]);
}
