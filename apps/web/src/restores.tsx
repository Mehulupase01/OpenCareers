import { Check, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Control } from "../../../packages/contracts/src/index.js";
import { request } from "./api.js";

interface RestoreRun {
  id: string;
  state: "open" | "completed";
  snapshot_sha256: string;
  snapshot_created_at: string | null;
  started_at: string;
}
interface RestoreReview {
  run_id: string;
  application_id: string;
  disposition: "pending" | "quarantined" | "receipt";
  receipt_id: string | null;
}
interface RestoreStatus {
  control: Control;
  runs: RestoreRun[];
  reviews: RestoreReview[];
}
const hashPattern = "[a-f0-9]{64}";

export function RestoresPanel({ onReleased }: { onReleased: () => Promise<void> }) {
  const [status, setStatus] = useState<RestoreStatus | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    const next = await request<RestoreStatus>("/v1/restores");
    setStatus(next);
    setSelected((current) =>
      next.runs.some((run) => run.id === current)
        ? current
        : (next.runs.find((run) => run.state === "open")?.id ?? next.runs[0]?.id ?? ""),
    );
  }, []);
  useEffect(() => {
    void refresh().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Recovery status is unavailable.");
    });
  }, [refresh]);
  const run = status?.runs.find((item) => item.id === selected);
  const reviews = status?.reviews.filter((item) => item.run_id === selected) ?? [];
  const act = async (path?: string, body?: unknown) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (path) await request(path, body);
      await refresh();
      if (path?.endsWith("/release")) await onReleased();
      if (path) setNotice("Recovery review recorded. Submissions remain paused.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recovery review failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="restore-workspace" aria-label="Backup recovery">
      <div className="section-toolbar">
        <h2>Backup recovery</h2>
        <button
          type="button"
          className="button secondary"
          title="Refresh recovery"
          aria-label="Refresh recovery"
          disabled={busy}
          onClick={() => void act()}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {status && !run && <p>No restore reviews.</p>}
      {run && (
        <>
          <label className="restore-run-select">
            Restore run
            <select
              value={selected}
              disabled={busy}
              onChange={(event) => {
                setSelected(event.target.value);
                setError("");
                setNotice("");
              }}
            >
              {status?.runs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.started_at} / {item.state}
                </option>
              ))}
            </select>
          </label>
          <dl className="environment restore-metadata">
            <div>
              <dt>Snapshot SHA-256</dt>
              <dd>{run.snapshot_sha256}</dd>
            </div>
            <div>
              <dt>Backup history boundary (UTC)</dt>
              <dd>{run.snapshot_created_at ?? "Not verified"}</dd>
            </div>
            <div>
              <dt>Restore started</dt>
              <dd>{run.started_at}</dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>{run.state === "open" ? "Blocked pending review" : "Review completed"}</dd>
            </div>
          </dl>
          {run.state === "open" && (
            <div key={run.id} className="restore-steps">
              {!run.snapshot_created_at && (
                <form
                  className="restore-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void act(`/v1/restores/${run.id}/backup-boundary`, {
                      snapshotSha256: run.snapshot_sha256,
                      capturedAtOrAfter: String(data.get("boundary")),
                      evidenceSha256: String(data.get("evidence")),
                      backupBoundaryVerified: data.get("verified") === "on",
                    });
                  }}
                >
                  <fieldset disabled={busy}>
                    <legend>Legacy backup boundary</legend>
                    <label>
                      Verified capture lower bound (UTC)
                      <input
                        name="boundary"
                        type="text"
                        required
                        placeholder="2026-01-01T00:00:00.000Z"
                      />
                    </label>
                    <label>
                      Boundary evidence SHA-256
                      <input name="evidence" required pattern={hashPattern} maxLength={64} />
                    </label>
                    <label className="restore-confirm">
                      <input name="verified" type="checkbox" required />I verified this backup was
                      captured at or after this boundary
                    </label>
                    <button type="submit" className="button secondary">
                      <Check size={16} />
                      Record backup boundary
                    </button>
                  </fieldset>
                </form>
              )}
              <h3>Application reviews</h3>
              {reviews.length === 0 && <p>No applications in this snapshot.</p>}
              <ul className="restore-review-list">
                {reviews.map((review) => (
                  <RestoreApplicationReview
                    key={review.application_id}
                    runId={run.id}
                    review={review}
                    busy={busy}
                    act={act}
                  />
                ))}
              </ul>
              <form
                className="restore-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void act(`/v1/restores/${run.id}/release`, {
                    externalHistoryReviewedAndImported: data.get("verified") === "on",
                    evidenceSha256: String(data.get("evidence")),
                    from: String(data.get("from")),
                    through: String(data.get("through")),
                  });
                }}
              >
                <fieldset
                  disabled={
                    busy ||
                    !run.snapshot_created_at ||
                    reviews.some((review) => review.disposition === "pending")
                  }
                >
                  <legend>External-history review</legend>
                  <label>
                    History reviewed from (UTC)
                    <input
                      key={run.snapshot_created_at}
                      name="from"
                      required
                      defaultValue={run.snapshot_created_at ?? ""}
                    />
                  </label>
                  <label>
                    History reviewed through (UTC)
                    <input name="through" required placeholder="2026-01-01T00:00:00.000Z" />
                  </label>
                  <label>
                    History evidence SHA-256
                    <input name="evidence" required pattern={hashPattern} maxLength={64} />
                  </label>
                  <label className="restore-confirm">
                    <input name="verified" type="checkbox" required />I reviewed external history
                    and imported missing post-backup applications
                  </label>
                  <button type="submit" className="button secondary">
                    <ShieldCheck size={16} />
                    Complete restore review
                  </button>
                </fieldset>
              </form>
            </div>
          )}
          {run.state === "completed" &&
            reviews.map((review) => (
              <p className="restore-completed-review" key={review.application_id}>
                {review.application_id}: {review.disposition}
                {review.receipt_id ? ` / ${review.receipt_id}` : ""}
              </p>
            ))}
        </>
      )}
    </section>
  );
}

function RestoreApplicationReview({
  runId,
  review,
  busy,
  act,
}: {
  runId: string;
  review: RestoreReview;
  busy: boolean;
  act: (path: string, body: unknown) => Promise<void>;
}) {
  const [disposition, setDisposition] = useState("quarantined");
  return (
    <li>
      <strong className="restore-identity">{review.application_id}</strong>
      <span>{review.disposition}</span>
      {review.disposition !== "receipt" ? (
        <form
          className="restore-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void act(`/v1/restores/${runId}/applications/${review.application_id}/review`, {
              disposition,
              ...(disposition === "receipt" ? { receiptId: String(data.get("receipt")) } : {}),
              note: String(data.get("note")),
            });
          }}
        >
          <fieldset disabled={busy}>
            <legend>Application disposition</legend>
            <label>
              Disposition
              <select value={disposition} onChange={(event) => setDisposition(event.target.value)}>
                <option value="quarantined">Quarantine permanently</option>
                <option value="receipt">Correlated confirmed receipt</option>
              </select>
            </label>
            {disposition === "receipt" && (
              <label>
                Confirmed receipt ID
                <input name="receipt" required />
              </label>
            )}
            <label>
              Review note
              <input name="note" required maxLength={2000} />
            </label>
            <button type="submit" className="button secondary">
              <Check size={16} />
              Record application review
            </button>
          </fieldset>
        </form>
      ) : (
        <span className="restore-identity">{review.receipt_id}</span>
      )}
    </li>
  );
}
