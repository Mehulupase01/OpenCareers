import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Eye,
  FileDown,
  FileText,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { PacketSnapshot } from "../../../packages/contracts/src/documents.js";
import type { Job } from "../../../packages/contracts/src/index.js";
import type { MatchingSnapshot } from "../../../packages/contracts/src/matching.js";
import { request } from "./api.js";
import { PdfPreview } from "./pdf-preview.js";

const words = (value: string) => value.replaceAll("_", " ");

export function DocumentsWorkspace({ jobs }: { jobs: Job[] }) {
  const [packets, setPackets] = useState<PacketSnapshot[] | null>(null);
  const [matching, setMatching] = useState<MatchingSnapshot | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const [nextPackets, nextMatching] = await Promise.all([
        request<PacketSnapshot[]>("/v1/documents"),
        request<MatchingSnapshot>("/v1/matching"),
      ]);
      setPackets(nextPackets);
      setMatching(nextMatching);
      setSelected((current) =>
        current && nextPackets.some((packet) => packet.manifest.id === current)
          ? current
          : (nextPackets.find((packet) => packet.valid)?.manifest.id ??
            nextPackets[0]?.manifest.id ??
            null),
      );
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Document packets are unavailable.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const generate = async () => {
    const assessment = matching?.assessments.find(
      (item) => item.outcome === "auto_eligible" && item.applicationId,
    );
    if (!assessment?.applicationId) return;
    setBusy(true);
    try {
      const packet = await request<PacketSnapshot>("/v1/documents/generate", {
        applicationId: assessment.applicationId,
        assessmentId: assessment.id,
        requestedAnswers: [],
        asOf: new Date().toISOString().slice(0, 10),
      });
      await refresh();
      setSelected(packet.manifest.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Packet generation failed.");
    } finally {
      setBusy(false);
    }
  };

  if (error && !packets)
    return (
      <div className="error-banner" role="alert">
        <AlertTriangle size={17} /> {error}
      </div>
    );
  if (!packets)
    return (
      <div className="loading" role="status">
        <CircleDashed className="spin" size={20} /> Loading document packets
      </div>
    );

  const packet = packets.find((item) => item.manifest.id === selected) ?? null;
  const eligible = matching?.assessments.some(
    (item) => item.outcome === "auto_eligible" && item.applicationId,
  );
  return (
    <section className="documents-workspace">
      {error && (
        <div className="error-banner" role="alert">
          <AlertTriangle size={17} /> {error}
        </div>
      )}
      <div className="document-toolbar">
        <div className="document-metrics">
          <span className="document-kicker">IMMUTABLE PACKETS</span>
          <strong>{packets.filter((item) => item.valid).length} current</strong>
          <small>{packets.length} versions retained</small>
        </div>
        <div className="heading-actions">
          <button
            className="icon-button"
            type="button"
            title="Refresh packets"
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} />
          </button>
          <button type="button" disabled={!eligible || busy} onClick={() => void generate()}>
            <FileText size={16} /> {busy ? "Generating" : "Generate packet"}
          </button>
        </div>
      </div>

      <div className="document-layout">
        <div className="packet-index data-section">
          <div className="section-toolbar">
            <div className="section-title">
              Packet history <span>{packets.length}</span>
            </div>
          </div>
          {packets.map((item) => {
            const job = jobs.find((candidate) => candidate.id === item.manifest.jobId);
            return (
              <button
                type="button"
                key={item.manifest.id}
                data-packet-id={item.manifest.id}
                className="packet-row"
                aria-pressed={selected === item.manifest.id}
                onClick={() => setSelected(item.manifest.id)}
              >
                <span
                  className={`packet-validity ${item.valid ? "valid" : "invalid"}`}
                  aria-hidden="true"
                />
                <span>
                  <strong>{job?.title ?? item.content.job.role}</strong>
                  <small>{job?.company ?? item.content.job.company}</small>
                </span>
                <span className="packet-time">
                  {new Date(item.manifest.createdAt).toLocaleString()}
                </span>
              </button>
            );
          })}
          {!packets.length && (
            <div className="empty-state">
              <FileText size={24} />
              <strong>No packet versions yet</strong>
              <span>Generate from an auto-eligible assessment.</span>
            </div>
          )}
        </div>

        <div className="packet-review" aria-live="polite">
          {packet ? (
            <>
              <div className="packet-heading">
                <div>
                  <p className="eyebrow">BOUND REVIEW</p>
                  <h2>{packet.content.job.role}</h2>
                  <span className="packet-company">{packet.content.job.company}</span>
                </div>
                <span className={`packet-state ${packet.valid ? "valid" : "invalid"}`}>
                  {packet.valid ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                  {packet.valid
                    ? words(packet.manifest.validation.status)
                    : words(packet.invalidReason ?? "invalid")}
                </span>
              </div>

              <nav className="artifact-strip" aria-label="Packet downloads">
                {packet.manifest.artifacts.map((artifact) => (
                  <a
                    key={artifact.kind}
                    href={`/v1/documents/${packet.manifest.id}/artifacts/${artifact.kind}`}
                    download={artifact.filename}
                  >
                    <FileDown className="artifact-icon" size={15} />
                    <span className="artifact-name">{words(artifact.kind)}</span>
                    <small className="artifact-size">{Math.ceil(artifact.bytes / 1024)} KB</small>
                  </a>
                ))}
              </nav>

              <details className="pdf-preview-panel">
                <summary>
                  <Eye size={15} /> Preview CV PDF
                </summary>
                <PdfPreview
                  source={`/v1/documents/${packet.manifest.id}/artifacts/cv_pdf?preview=1`}
                />
              </details>

              <div className="side-by-side">
                <section>
                  <h3>Bound source</h3>
                  <dl className="manifest-list">
                    <div className="manifest-row">
                      <dt>Profile</dt>
                      <dd>revision {packet.manifest.profileRevision}</dd>
                    </div>
                    <div className="manifest-row">
                      <dt>Assessment</dt>
                      <dd>{packet.manifest.assessmentId}</dd>
                    </div>
                    <div className="manifest-row">
                      <dt>Authorization</dt>
                      <dd>revision {packet.manifest.authorizationRevision}</dd>
                    </div>
                  </dl>
                  <h4>Selected evidence</h4>
                  <ul className="plain-evidence-list">
                    {packet.content.changeSummary.selectedEvidence.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <h4>Excluded evidence</h4>
                  <ul className="plain-evidence-list muted-list">
                    {packet.content.changeSummary.excludedEvidence.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3>Tailored output</h3>
                  <span className="review-label">CV summary</span>
                  <p>{packet.content.cv.summary.text}</p>
                  <span className="review-label">Experience wording</span>
                  <p>
                    {packet.content.cv.experience.professional.text}
                    <br />
                    {packet.content.cv.experience.handsOn.text}
                  </p>
                  <span className="review-label">Letter opening</span>
                  <p>{packet.content.letter.opening}</p>
                  {packet.content.letter.contributions.map((claim) => (
                    <blockquote key={claim.id}>
                      {claim.text}
                      <code>{claim.evidence.map((item) => item.factId).join(", ")}</code>
                    </blockquote>
                  ))}
                </section>
              </div>

              <div className="packet-lower-grid">
                <section>
                  <h3>Answers</h3>
                  {packet.content.answers.length ? (
                    packet.content.answers.map((answer) => (
                      <div className="answer-review" key={answer.semanticKey}>
                        <strong>{answer.meaning}</strong>
                        <span className={`stage ${answer.status !== "deferred" ? "complete" : ""}`}>
                          {words(answer.status)}
                        </span>
                        <p>
                          {answer.answer === null ? "Owner input required" : String(answer.answer)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="muted">No employer questions were requested for this packet.</p>
                  )}
                </section>
                <section>
                  <h3>Validation</h3>
                  <div className="validation-summary">
                    <ShieldCheck className="validation-icon" size={18} />
                    <strong className="validation-count">
                      {packet.manifest.validation.checkedClaimIds.length} claims checked
                    </strong>
                    <span className="validation-note">
                      {packet.manifest.validation.issues.length} findings
                    </span>
                  </div>
                  {packet.manifest.validation.issues.map((issue) => (
                    <p className="validation-issue" key={`${issue.code}:${issue.path}`}>
                      {issue.code}: {issue.message}
                    </p>
                  ))}
                  <code className="packet-hash">sha256 {packet.manifest.contentSha256}</code>
                </section>
              </div>
            </>
          ) : (
            <div className="assessment-empty">
              <ShieldCheck size={23} />
              <strong>Select a packet</strong>
              <span>Review bound inputs, changes, outputs, validation and exact artifacts.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
