import { type FieldPlan, type FormSnapshot, fieldPlanSchema } from "../../contracts/src/browser.js";
import type { PacketSnapshot } from "../../contracts/src/documents.js";

export function planGreenhouseFields(
  snapshot: FormSnapshot,
  packet: PacketSnapshot,
  approvedValues: Record<string, string | boolean>,
): FieldPlan {
  const target = new URL(packet.content.job.url);
  if (
    snapshot.origin !== "https://job-boards.greenhouse.io" ||
    target.origin !== snapshot.origin ||
    target.pathname !== new URL(snapshot.url).pathname
  )
    throw new Error("Packet vacancy and Greenhouse form differ.");
  if (!packet.valid || packet.manifest.validation.status === "blocked")
    throw new Error("A valid packet is required for Greenhouse preparation.");
  const identity = packet.content.cv.identity;
  const cv = packet.manifest.artifacts.find((item) => item.kind === "cv_pdf");
  if (!cv) throw new Error("Packet CV is missing.");
  const names = identity.fullName.trim().split(/\s+/);
  const normalized = (value: string) => value.trim().replace(/\s+/g, " ");
  const firstName = approvedValues.first_name;
  const lastName = approvedValues.last_name;
  if (
    (firstName !== undefined || lastName !== undefined) &&
    (typeof firstName !== "string" ||
      typeof lastName !== "string" ||
      normalized(`${firstName} ${lastName}`) !== normalized(identity.fullName))
  )
    throw new Error("Approved first and last names must match the reviewed full name.");
  const mapped: Record<string, { value: string | boolean; evidence: string[] }> = {
    email: { value: identity.email, evidence: identity.evidence.map((fact) => fact.factId) },
    phone: { value: identity.phone, evidence: identity.evidence.map((fact) => fact.factId) },
    cv: { value: cv.filename, evidence: [cv.sha256] },
  };
  const packetBackedKeys = new Set(["email", "phone", "cv"]);
  if (typeof firstName === "string" && typeof lastName === "string") {
    mapped.first_name = {
      value: firstName,
      evidence: identity.evidence.map((fact) => fact.factId),
    };
    mapped.last_name = { value: lastName, evidence: identity.evidence.map((fact) => fact.factId) };
  } else if (names.length === 2 && names[0] && names[1]) {
    mapped.first_name = { value: names[0], evidence: identity.evidence.map((fact) => fact.factId) };
    mapped.last_name = { value: names[1], evidence: identity.evidence.map((fact) => fact.factId) };
  }
  for (const answer of packet.content.answers) {
    if (
      packetBackedKeys.has(answer.semanticKey) ||
      ["first_name", "last_name"].includes(answer.semanticKey)
    )
      throw new Error(`Answer conflicts with packet-backed field: ${answer.semanticKey}`);
    if (answer.status !== "deferred" && answer.answer !== null)
      mapped[answer.semanticKey] = {
        value: String(answer.answer),
        evidence: answer.evidence.map((fact) => fact.factId),
      };
  }
  for (const [key, value] of Object.entries(approvedValues)) {
    if (key === "first_name" || key === "last_name") continue;
    if (packetBackedKeys.has(key)) {
      if (mapped[key]?.value !== value)
        throw new Error(`Approved value conflicts with packet-backed field: ${key}`);
      continue;
    }
    mapped[key] = { value, evidence: [] };
  }
  const entries: FieldPlan["entries"] = [];
  const unresolved: string[] = [];
  for (const field of snapshot.fields) {
    const candidate = mapped[field.semanticKey];
    if (!candidate || field.kind === "unsupported") {
      if (field.required) unresolved.push(field.semanticKey);
      continue;
    }
    const value = candidate.value;
    if (
      (typeof value !== "string" && field.kind !== "checkbox") ||
      (typeof value === "string" &&
        (!value.trim() || (field.maxLength && value.length > field.maxLength))) ||
      (field.kind === "checkbox" && value === false)
    ) {
      if (field.required) unresolved.push(field.semanticKey);
      continue;
    }
    entries.push({
      name: field.name,
      semanticKey: field.semanticKey,
      expected: value,
      evidence: candidate.evidence,
    });
  }
  return fieldPlanSchema.parse({ fingerprint: snapshot.fingerprint, entries, unresolved });
}
