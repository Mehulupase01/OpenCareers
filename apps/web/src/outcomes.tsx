import { ChartNoAxesColumn, RefreshCw, RotateCcw, Save } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type { OperationsSummary } from "../../../packages/contracts/src/index.js";
import {
  type CohortReport,
  type OutcomeEvent,
  type OutcomeKind,
  outcomeKindSchema,
} from "../../../packages/contracts/src/outcome.js";
import { request } from "./api.js";
import { CalibrationWorkspace } from "./calibration.js";

export function OutcomesWorkspace({ summary }: { summary: OperationsSummary }) {
  const [applicationId, setApplicationId] = useState("");
  const [history, setHistory] = useState<OutcomeEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<OutcomeKind>("UNKNOWN");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [evidenceSha256, setEvidenceSha256] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [from, setFrom] = useState(new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
  const [through, setThrough] = useState(new Date().toISOString().slice(0, 10));
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<CohortReport | null>(null);
  useEffect(() => {
    let active = true;
    setHistory([]);
    setError("");
    if (!applicationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void request<OutcomeEvent[]>(`/v1/outcomes/${encodeURIComponent(applicationId)}`)
      .then((value) => {
        if (active) setHistory(value);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Outcomes unavailable.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applicationId]);
  const command = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      if (applicationId)
        setHistory(
          await request<OutcomeEvent[]>(`/v1/outcomes/${encodeURIComponent(applicationId)}`),
        );
      setReport(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Outcome action failed.");
    } finally {
      setBusy(false);
    }
  };
  const record = (event: FormEvent) => {
    event.preventDefault();
    void command(async () => {
      await request("/v1/outcomes", {
        applicationId,
        expectedRevision: history.at(-1)?.revision ?? 0,
        requestId: crypto.randomUUID(),
        kind,
        evidenceRef,
        evidenceSha256,
        occurredAt: new Date(occurredAt).toISOString(),
      });
      setEvidenceRef("");
      setEvidenceSha256("");
      setOccurredAt("");
    });
  };
  const cohort = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setReport(null);
    void request<OperationsSummary>("/v1/operations/summary")
      .then(({ asOf }) =>
        request<CohortReport>("/v1/outcomes/cohort", {
          from: `${from}T00:00:00.000Z`,
          through: `${through}T00:00:00.000Z`,
          asOf,
          observationDays: days,
        }),
      )
      .then(setReport)
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Report unavailable.");
      })
      .finally(() => setBusy(false));
  };
  const latest = history.at(-1);
  return (
    <section className="outcomes-workspace">
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="section-heading">
        <h2 className="email-heading">
          <ChartNoAxesColumn size={20} /> Outcomes
        </h2>
        <span className="muted">
          {summary.profile === "demo" ? "Synthetic records" : "Private records"}
        </span>
      </div>
      <label className="outcome-application">
        Application
        <select
          aria-label="Application"
          value={applicationId}
          disabled={busy}
          onChange={(event) => setApplicationId(event.target.value)}
        >
          <option value="">Select application</option>
          {summary.applications.map((app) => {
            const job = summary.jobs.find((item) => item.id === app.jobId);
            return (
              <option key={app.id} value={app.id}>
                {job?.title ?? app.id} / {job?.company ?? app.state}
              </option>
            );
          })}
        </select>
      </label>
      {applicationId && (
        <>
          <h3>Recorded history</h3>
          {loading ? (
            <p className="muted" role="status">
              Loading outcomes
            </p>
          ) : history.length === 0 ? (
            <p className="muted">No recorded outcome</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Revision</th>
                    <th>Outcome</th>
                    <th>Source</th>
                    <th>Occurred</th>
                    <th>Evidence</th>
                    <th>Correction</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.id}>
                      <td>{item.revision}</td>
                      <td>{item.kind}</td>
                      <td>{item.source}</td>
                      <td>{new Date(item.occurredAt).toLocaleString()}</td>
                      <td className="outcome-evidence" title={item.evidenceSha256}>
                        {item.evidenceRef}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button secondary"
                          title="Restore this outcome"
                          aria-label={`Restore revision ${item.revision}`}
                          disabled={busy || loading || latest?.id === item.id}
                          onClick={() =>
                            void command(() =>
                              request("/v1/outcomes/reverse", {
                                applicationId,
                                eventId: item.id,
                                expectedRevision: latest?.revision ?? 0,
                                requestId: crypto.randomUUID(),
                              }),
                            )
                          }
                        >
                          <RotateCcw size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3>Owner evidence</h3>
          <form className="candidate-form" onSubmit={record}>
            <label>
              Outcome
              <select
                aria-label="Outcome"
                value={kind}
                onChange={(event) => setKind(event.target.value as OutcomeKind)}
                disabled={busy || loading}
              >
                {outcomeKindSchema.options.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Occurred at
              <input
                type="datetime-local"
                step="0.001"
                required
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
                disabled={busy || loading}
              />
            </label>
            <label>
              Evidence reference
              <input
                required
                maxLength={120}
                value={evidenceRef}
                onChange={(event) => setEvidenceRef(event.target.value)}
                disabled={busy || loading}
              />
            </label>
            <label>
              Evidence SHA-256
              <input
                required
                pattern="[a-f0-9]{64}"
                maxLength={64}
                value={evidenceSha256}
                onChange={(event) => setEvidenceSha256(event.target.value)}
                disabled={busy || loading}
              />
            </label>
            <div className="form-actions">
              <button className="button" type="submit" disabled={busy || loading}>
                <Save size={16} /> Record outcome
              </button>
            </div>
          </form>
        </>
      )}
      <h3>Completed cohort</h3>
      <form className="candidate-form" onSubmit={cohort}>
        <label>
          Receipt from (UTC)
          <input
            type="date"
            required
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setReport(null);
            }}
            disabled={busy}
          />
        </label>
        <label>
          Receipt through (UTC)
          <input
            type="date"
            required
            value={through}
            onChange={(event) => {
              setThrough(event.target.value);
              setReport(null);
            }}
            disabled={busy}
          />
        </label>
        <label>
          Observation days
          <input
            type="number"
            min={1}
            max={365}
            required
            value={days}
            onChange={(event) => {
              setDays(Number(event.target.value));
              setReport(null);
            }}
            disabled={busy}
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="button secondary" disabled={busy}>
            <RefreshCw size={16} /> Run report
          </button>
        </div>
      </form>
      {report && (
        <div className="outcome-report" role="status">
          <h3>
            {report.status === "insufficient_data"
              ? "Insufficient live data"
              : "Recorded outcome fractions"}
          </h3>
          <p className="muted">
            {report.window.from.slice(0, 10)} to {report.window.through.slice(0, 10)} UTC ·{" "}
            {report.window.observationDays} days · {report.denominator} eligible applications ·
            minimum {report.window.minimumSample}
          </p>
          <p className="muted">As of {report.window.asOf}</p>
          {report.fractions && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Outcome</th>
                    <th>Recorded</th>
                    <th>Eligible</th>
                    <th>Fraction</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(report.fractions).map(([name, value]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{value.numerator}</td>
                      <td>{value.denominator}</td>
                      <td>{value.fraction.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <dl className="outcome-exclusions">
            {Object.entries(report.exclusions).map(([name, count]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <CalibrationWorkspace />
    </section>
  );
}
