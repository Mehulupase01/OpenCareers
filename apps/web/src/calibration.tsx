import { FileUp, RefreshCw, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { calibrationDatasetSchema } from "../../../packages/contracts/src/calibration.js";
import type { scoreCalibration } from "../../../packages/matching/src/score-calibration.js";
import type { CalibrationRepository } from "../../../packages/persistence/src/calibration-repository.js";
import { request } from "./api.js";

type Report = ReturnType<typeof scoreCalibration>;
type Catalog = Awaited<ReturnType<CalibrationRepository["list"]>>;
type Dataset = ReturnType<typeof calibrationDatasetSchema.parse>;
const endpoint = "/v1/outcomes/calibration/datasets";
const maximumBytes = 120 * 1024;

export function CalibrationWorkspace() {
  const [catalog, setCatalog] = useState<Catalog>([]);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [selected, setSelected] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    void request<Catalog>(endpoint)
      .then((items) => {
        if (active) setCatalog(items);
      })
      .catch(() => {
        if (active) setError("Saved datasets unavailable.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      generation.current++;
    };
  }, []);
  const importFile = async (file?: File) => {
    const version = ++generation.current;
    setDataset(null);
    setReviewed(false);
    setError("");
    if (!file) return;
    if (file.size > maximumBytes) {
      setError("Review file exceeds 120 KiB.");
      return;
    }
    try {
      const text = await file.text();
      const input = calibrationDatasetSchema.parse(JSON.parse(text));
      if (new TextEncoder().encode(JSON.stringify(input)).length > maximumBytes)
        throw new Error("oversized");
      if (version === generation.current) setDataset(input);
    } catch {
      // Do not reflect arbitrary file contents or parser errors into the workspace.
      if (version === generation.current) setError("Invalid fixed review dataset.");
    }
  };
  const run = async (action: () => Promise<Report>) => {
    setBusy(true);
    setError("");
    setReport(null);
    try {
      const result = await action();
      setSelected(result.datasetId);
      setReport(result);
      setCatalog(await request<Catalog>(endpoint));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dataset action failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="calibration-workspace" aria-label="Relevance diagnostics">
      <h3>Relevance diagnostics</h3>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="candidate-form">
        <label>
          <span>
            <FileUp size={16} /> Review dataset
          </span>
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy || loading}
            onChange={(event) => void importFile(event.target.files?.[0])}
          />
        </label>
        <label>
          Saved dataset
          <select
            aria-label="Saved dataset"
            value={selected}
            disabled={busy || loading}
            onChange={(event) => {
              setSelected(event.target.value);
              setReport(null);
            }}
          >
            <option value="">{loading ? "Loading datasets" : "Select dataset"}</option>
            {catalog.map((item) => (
              <option key={item.id} value={item.id}>
                {item.window.recordedAt.slice(0, 10)} / {item.id} / {item.sampleSize} live reviews
              </option>
            ))}
          </select>
        </label>
        <div className="form-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy || loading || !selected}
            onClick={() => void run(() => request<Report>(`${endpoint}/${selected}`))}
          >
            <RefreshCw size={16} /> Open diagnostics
          </button>
        </div>
      </div>
      {dataset && (
        <div className="calibration-import">
          <dl className="outcome-exclusions">
            <div>
              <dt>Dataset</dt>
              <dd className="calibration-id">{dataset.id}</dd>
            </div>
            <div>
              <dt>Reviews</dt>
              <dd>{dataset.labels.length}</dd>
            </div>
            <div>
              <dt>Review window (UTC)</dt>
              <dd>
                {dataset.from} to {dataset.through}
              </dd>
            </div>
          </dl>
          <label className="calibration-review">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            Owner-reviewed relevance labels
          </label>
          <button
            type="button"
            className="button"
            disabled={busy || !reviewed}
            onClick={() => void run(() => request<Report>(endpoint, dataset))}
          >
            <Save size={16} /> Save fixed dataset
          </button>
        </div>
      )}
      {report && (
        <div className="outcome-report" role="status">
          <h4>
            {report.status === "measured"
              ? "Fixed relevance diagnostics"
              : report.status === "insufficient_data"
                ? "Insufficient reviewed data"
                : report.status === "insufficient_label_variation"
                  ? "Insufficient label variation"
                  : "Insufficient score variation"}
          </h4>
          <dl className="outcome-exclusions">
            <div>
              <dt>Live reviews</dt>
              <dd>{report.sampleSize}</dd>
            </div>
            <div>
              <dt>Relevant</dt>
              <dd>{report.relevant}</dd>
            </div>
            <div>
              <dt>Not relevant</dt>
              <dd>{report.irrelevant}</dd>
            </div>
            <div>
              <dt>Excluded synthetic</dt>
              <dd>{report.exclusions.synthetic}</dd>
            </div>
            <div>
              <dt>Minimum sample</dt>
              <dd>{report.minimumSample}</dd>
            </div>
          </dl>
          <p className="muted">
            {report.window.from} to {report.window.through} UTC
          </p>
          <p className="muted">Recorded {report.window.recordedAt}</p>
          {report.metrics && (
            <dl className="outcome-exclusions">
              <div>
                <dt>Spearman rank correlation</dt>
                <dd>{report.metrics.spearmanRankCorrelation.toFixed(3)}</dd>
              </div>
              <div>
                <dt>Relevance discrimination AUC</dt>
                <dd>{report.metrics.relevanceDiscriminationAuc.toFixed(3)}</dd>
              </div>
            </dl>
          )}
          {report.bands && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fit band</th>
                    <th>Reviews</th>
                    <th>Relevant</th>
                  </tr>
                </thead>
                <tbody>
                  {report.bands.map((band) => (
                    <tr key={band.lowerInclusive}>
                      <td>
                        {band.lowerInclusive} to {(band.upperExclusive ?? 101) - 1}
                      </td>
                      <td>{band.sampleSize}</td>
                      <td>{band.relevant}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted">Owner-reviewed relevance, not employer outcomes.</p>
          <p className="muted">{report.limits.join(" ")}</p>
        </div>
      )}
    </section>
  );
}
