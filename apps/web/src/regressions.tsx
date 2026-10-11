import { Check, Download, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { RegressionRepository } from "../../../packages/persistence/src/regression-repository.js";
import { request } from "./api.js";

type Catalog = Awaited<ReturnType<RegressionRepository["list"]>>;
const endpoint = "/v1/outcomes/regressions";
export function RegressionsWorkspace() {
  const [items, setItems] = useState<Catalog>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let active = true;
    void request<Catalog>(endpoint)
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch(() => {
        if (active) setError("Regression proposals unavailable.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const action = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await run();
      setItems(await request<Catalog>(endpoint));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Regression action failed.");
    } finally {
      setBusy(false);
    }
  };
  const download = async (id: string) => {
    const fixture = await request<Awaited<ReturnType<RegressionRepository["export"]>>>(
      `${endpoint}/${id}/export`,
    );
    const url = URL.createObjectURL(
      new Blob([`${JSON.stringify(fixture, null, 2)}\n`], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "reviewed-regression.json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  return (
    <section className="calibration-workspace" aria-label="Regression proposals">
      <h3>Regression proposals</h3>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          title="Refresh regression proposals"
          onClick={() => void action(async () => {})}
        >
          <RefreshCw size={16} /> Refresh proposals
        </button>
      </div>
      {!items.length && !busy && <p>No regression proposals</p>}
      {items.length > 0 && (
        <div className="table-scroll">
          <table className="outcome-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Correction</th>
                <th>Status</th>
                <th>Review</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.fixture.kind}</td>
                  <td>
                    {item.fixture.kind === "workload_correction"
                      ? `${item.fixture.before} to ${item.fixture.after}`
                      : item.fixture.variant}
                  </td>
                  <td>
                    {item.state} / {item.revision}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Reviewed regression ${item.id}`}
                      disabled={busy || item.state !== "proposed"}
                      checked={item.state !== "proposed" || (reviewed[item.id] ?? false)}
                      onChange={(event) =>
                        setReviewed({ ...reviewed, [item.id]: event.target.checked })
                      }
                    />
                  </td>
                  <td>
                    <div className="regression-actions">
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Approve regression ${item.id}`}
                        title="Approve sanitized regression"
                        disabled={busy || item.state !== "proposed" || !reviewed[item.id]}
                        onClick={() =>
                          void action(() =>
                            request(`${endpoint}/${item.id}/review`, {
                              expectedRevision: item.revision,
                              decision: "approved",
                              reviewed: true,
                            }),
                          )
                        }
                      >
                        <Check size={16} />
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Dismiss regression ${item.id}`}
                        title="Dismiss regression"
                        disabled={busy || item.state !== "proposed" || !reviewed[item.id]}
                        onClick={() =>
                          void action(() =>
                            request(`${endpoint}/${item.id}/review`, {
                              expectedRevision: item.revision,
                              decision: "dismissed",
                              reviewed: true,
                            }),
                          )
                        }
                      >
                        <X size={16} />
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Export regression ${item.id}`}
                        title="Export approved regression"
                        disabled={busy || item.state !== "approved"}
                        onClick={() => void action(() => download(item.id))}
                      >
                        <Download size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
