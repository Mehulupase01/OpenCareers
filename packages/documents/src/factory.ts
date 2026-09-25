import { createHash } from "node:crypto";
import type {
  PacketArtifact,
  PacketContent,
  ValidationReport,
} from "../../contracts/src/documents.js";
import { type PacketManifest, packetManifestSchema } from "../../contracts/src/documents.js";
import type { ArtifactStore } from "./artifact-store.js";
import type { PacketGenerationInput } from "./domain.js";
import { generatePacketContent } from "./domain.js";
import { equivalenceIssues, extractDocx, extractPdf } from "./extract.js";
import { renderCvDocx, renderCvPdf, renderLetterDocx, renderLetterPdf } from "./render.js";
import { validatePacketContent } from "./validation.js";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const slug = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .toLowerCase();

export interface BuiltPacket {
  content: PacketContent;
  manifest: PacketManifest;
}

export async function buildPacket(
  store: ArtifactStore,
  input: PacketGenerationInput,
): Promise<BuiltPacket> {
  const content = generatePacketContent(input);
  const baseValidation = validatePacketContent({
    content,
    profile: input.profile,
    assessment: input.assessment,
    asOf: input.asOf,
    checkedAt: input.generatedAt,
  });
  const [cvDocx, cvPdf, letterDocx, letterPdf] = await Promise.all([
    renderCvDocx(content.cv, content.generatedAt),
    renderCvPdf(content.cv, content.generatedAt),
    renderLetterDocx(content.letter, content.cv.identity.fullName, content.generatedAt),
    renderLetterPdf(content.letter, content.cv.identity.fullName, content.generatedAt),
  ]);
  const answers = Buffer.from(`${JSON.stringify(content.answers, null, 2)}\n`, "utf8");
  const [cvDocxExtracted, cvPdfExtracted, letterDocxExtracted, letterPdfExtracted] =
    await Promise.all([
      extractDocx(cvDocx),
      extractPdf(cvPdf),
      extractDocx(letterDocx),
      extractPdf(letterPdf),
    ]);
  const formatIssues = equivalenceIssues(
    content,
    cvDocxExtracted,
    cvPdfExtracted,
    letterDocxExtracted,
    letterPdfExtracted,
  );
  const uploadIssues = [cvDocx, cvPdf, letterDocx, letterPdf, answers].flatMap((buffer, index) =>
    buffer.length > 5 * 1024 * 1024
      ? [
          {
            code: "UPLOAD_TOO_LARGE" as const,
            severity: "error" as const,
            path: `artifacts.${index}`,
            message: "Artifact exceeds the 5 MiB packet upload limit.",
          },
        ]
      : [],
  );
  const issues = [...baseValidation.issues, ...formatIssues, ...uploadIssues];
  const validation: ValidationReport = {
    ...baseValidation,
    issues,
    status: issues.some((issue) => issue.severity === "error")
      ? "blocked"
      : issues.some((issue) => issue.code === "ANSWER_DEFERRED")
        ? "needs_input"
        : "valid",
  };
  const stem = `${slug(input.job.company)}-${slug(input.job.title)}`;
  const files = [
    {
      kind: "cv_docx" as const,
      buffer: cvDocx,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
      filename: `${stem}-cv.docx`,
    },
    {
      kind: "cv_pdf" as const,
      buffer: cvPdf,
      mimeType: "application/pdf" as const,
      filename: `${stem}-cv.pdf`,
    },
    {
      kind: "letter_docx" as const,
      buffer: letterDocx,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
      filename: `${stem}-letter.docx`,
    },
    {
      kind: "letter_pdf" as const,
      buffer: letterPdf,
      mimeType: "application/pdf" as const,
      filename: `${stem}-letter.pdf`,
    },
    {
      kind: "answers_json" as const,
      buffer: answers,
      mimeType: "application/json" as const,
      filename: `${stem}-answers.json`,
    },
  ];
  const artifacts: PacketArtifact[] = await Promise.all(
    files.map(async (file) => {
      const stored = await store.put(file.buffer);
      return {
        id: `artifact-${stored.sha256}`,
        kind: file.kind,
        sha256: stored.sha256,
        mimeType: file.mimeType,
        bytes: stored.bytes,
        storageKey: stored.storageKey,
        filename: file.filename,
      };
    }),
  );
  const contentSha256 = hash(JSON.stringify(content));
  const packetId = `packet-${hash(`${input.authorization.id}:${input.assessment.id}:${contentSha256}:${artifacts.map((item) => item.sha256).join(":")}`)}`;
  return {
    content,
    manifest: packetManifestSchema.parse({
      schemaVersion: 1,
      id: packetId,
      applicationId: input.assessment.applicationId,
      jobId: input.job.id,
      profileId: input.profile.id,
      profileRevision: input.profile.revision,
      assessmentId: input.assessment.id,
      authorizationId: input.authorization.id,
      authorizationRevision: input.authorization.revision,
      contentSha256,
      templateVersions: { cv: "cv-v1", letter: "letter-v1" },
      artifacts,
      validation,
      createdAt: input.generatedAt,
    }),
  };
}
