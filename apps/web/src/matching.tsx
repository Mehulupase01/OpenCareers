import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  CircleDashed,
  Gauge,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Job } from "../../../packages/contracts/src/index.js";
import type {
  MatchAssessment,
  MatchingSnapshot,
} from "../../../packages/contracts/src/matching.js";
import { request } from "./api.js";

const words = (value: string) => value.replaceAll("_", " ");

function AssessmentDetail({ assessment }: { assessment: MatchAssessment }) {
  return (
    <div className="matching-detail">
      <section className="score-breakdown" aria-label="Score components">
        {Object.entries(assessment.score).map(([name, value]) => (
          <div key={name}>
            <span className="score-label">{words(name)}</span>
            <strong className="score-value">{value}</strong>
          </div>
        ))}
      </section>
      <h3>Policy gates</h3>
      <ul className="gate-list">
        {assessment.gates.map((gate) => (
          <li key={gate.code}>
            <span className={`gate-mark ${gate.status}`} aria-hidden="true" />
            <div>
              <strong>{words(gate.code)}</strong>
              <p>{gate.explanation}</p>
              {gate.factIds.length > 0 && <code>{gate.factIds.join(", ")}</code>}
            </div>
          </li>
        ))}
      </ul>
      {assessment.requirements.length > 0 && (
        <>
          <h3>Evidence-bound requirements</h3>
          <ul className="requirement-list">
            {assessment.requirements.map((requirement) => (
              <li key={requirement.id}>
                <div>
                  <strong>{requirement.text}</strong>
                  <span className={`stage ${requirement.status === "met" ? "complete" : ""}`}>
                    {requirement.status}
                  </span>
                </div>
                <blockquote>{requirement.span.quote}</blockquote>
                <p>{requirement.explanation}</p>
                <code>
                  span {requirement.span.start}:{requirement.span.end}
                  {requirement.factIds.length > 0
                    ? ` | facts ${requirement.factIds.join(", ")}`
                    : " | no candidate fact claimed"}
                </code>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function MatchingWorkspace({ jobs }: { jobs: Job[] }) {
  const [snapshot, setSnapshot] = useState<MatchingSnapshot | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setSnapshot(await request<MatchingSnapshot>("/v1/matching"));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Matching data is unavailable.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (error)
    return (
      <div className="error-banner" role="alert">
        <AlertTriangle size={17} /> {error}
      </div>
    );
  if (!snapshot)
    return (
      <div className="loading" role="status">
        <CircleDashed className="spin" size={20} /> Loading matching evidence
      </div>
    );

  const current = snapshot.assessments.find((item) => item.id === selected);
  const remaining = Math.max(
    0,
    snapshot.budget.limit - snapshot.budget.used - snapshot.budget.reserved,
  );
  return (
    <section className="matching-workspace">
      <div className="matching-status">
        <div>
          <BrainCircuit className="matching-status-icon" size={19} />
          <span className="matching-label">Inference route</span>
          <strong>{words(snapshot.route.status)}</strong>
          <small className="matching-note">{snapshot.route.reason}</small>
        </div>
        <div>
          <Gauge className="matching-status-icon" size={19} />
          <span className="matching-label">Daily free budget</span>
          <strong>{remaining} remaining</strong>
          <small className="matching-note">
            {snapshot.budget.used} used, {snapshot.budget.reserved} reserved of{" "}
            {snapshot.budget.limit}
          </small>
        </div>
        <div>
          <ShieldCheck className="matching-status-icon" size={19} />
          <span className="matching-label">Validated assessments</span>
          <strong>{snapshot.assessments.length}</strong>
          <small className="matching-note">
            Scores are deterministic, not hiring probabilities
          </small>
        </div>
      </div>

      <div className="route-strip">
        <span className="route-label">Model</span>
        <strong>{snapshot.route.modelId ?? "No eligible route"}</strong>
        <span className="route-label">Provider</span>
        <strong>{snapshot.route.provider ?? "None"}</strong>
        <span className="route-label">Catalogue</span>
        <strong>
          {snapshot.route.lastCatalogueAt
            ? new Date(snapshot.route.lastCatalogueAt).toLocaleString()
            : "Not checked"}
        </strong>
      </div>

      <div className="matching-layout">
        <div className="data-section">
          <div className="section-toolbar">
            <div className="section-title">
              Assessments <span>{snapshot.assessments.length}</span>
            </div>
          </div>
          <div className="table-scroll">
            <table className="matching-table">
              <thead>
                <tr>
                  <th>Vacancy</th>
                  <th>Outcome</th>
                  <th>Score</th>
                  <th>Route</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.assessments.map((assessment) => {
                  const job = jobs.find((item) => item.id === assessment.jobId);
                  return (
                    <tr key={assessment.id}>
                      <td>
                        <button
                          type="button"
                          className="row-link"
                          aria-pressed={selected === assessment.id}
                          onClick={() => setSelected(assessment.id)}
                        >
                          {job?.title ?? assessment.jobId}
                        </button>
                        <span className="company-name">{job?.company ?? assessment.profileId}</span>
                      </td>
                      <td>
                        <span
                          className={`stage ${assessment.outcome === "auto_eligible" ? "complete" : ""}`}
                        >
                          {assessment.outcome === "auto_eligible" && <CheckCircle2 size={11} />}
                          {words(assessment.outcome)}
                        </span>
                      </td>
                      <td>{assessment.score.total} / 100</td>
                      <td className="muted">{assessment.modelId ?? "Deterministic"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {snapshot.assessments.length === 0 && (
              <div className="empty-state">
                <BrainCircuit size={24} />
                <strong>No vacancies assessed yet</strong>
              </div>
            )}
          </div>
        </div>
        <aside className="assessment-panel" aria-live="polite">
          {current ? (
            <>
              <div className="section-toolbar">
                <div>
                  <p className="eyebrow">ASSESSMENT EVIDENCE</p>
                  <h2>{jobs.find((item) => item.id === current.jobId)?.title ?? current.jobId}</h2>
                </div>
                <span className="assessment-score">{current.score.total}</span>
              </div>
              <p className="assessment-summary">{current.explanation}</p>
              <AssessmentDetail assessment={current} />
            </>
          ) : (
            <div className="assessment-empty">
              <ShieldCheck size={23} />
              <strong>Select an assessment</strong>
              <span>
                Inspect every policy gate, score component, source span, and candidate fact link.
              </span>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
