import type { FieldPlan, FormSnapshot } from "../../contracts/src/browser.js";
import type { PacketSnapshot } from "../../contracts/src/documents.js";
import { FormDriftError } from "../../contracts/src/index.js";

export type FormAnswerGuard = (snapshot: FormSnapshot, plan: FieldPlan) => Promise<FieldPlan>;

// Low-level fixture drivers cannot establish database approval. They may only use
// packet-evidenced entries; application entrypoints install the canonical guard.
export function packetEvidenceGuard(packet: PacketSnapshot): FormAnswerGuard {
  const permitted = new Set([
    ...packet.content.cv.identity.evidence.map((item) => item.factId),
    ...packet.content.letter.contributions.flatMap((item) =>
      item.evidence.map((fact) => fact.factId),
    ),
    ...packet.content.answers.flatMap((item) => item.evidence.map((fact) => fact.factId)),
    ...packet.manifest.artifacts.map((item) => item.sha256),
  ]);
  const evidenced = (entry: FieldPlan["entries"][number]) =>
    entry.evidence.length > 0 && entry.evidence.every((id) => permitted.has(id));
  return async (_snapshot, plan) => ({
    ...plan,
    entries: plan.entries.filter(evidenced),
    unresolved: [
      ...new Set([
        ...plan.unresolved,
        ...plan.entries.filter((entry) => !evidenced(entry)).map((entry) => entry.semanticKey),
      ]),
    ],
  });
}

export async function assertGuardedPlan(
  guard: FormAnswerGuard,
  snapshot: FormSnapshot,
  plan: FieldPlan,
): Promise<FieldPlan> {
  try {
    const checked = await guard(snapshot, plan);
    const values = (input: FieldPlan) =>
      JSON.stringify(
        input.entries.map(({ name, semanticKey, expected }) => ({ name, semanticKey, expected })),
      );
    if (
      checked.unresolved.length ||
      checked.fingerprint !== plan.fingerprint ||
      values(checked) !== values(plan)
    )
      throw new Error("Answer approval changed before filling.");
    return checked;
  } catch {
    throw new FormDriftError(
      "OTHER_FORM_CHANGED",
      "Current canonical approval does not support the prepared form answers.",
    );
  }
}
