import { Play, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { BrowserPreparation } from "../../../packages/contracts/src/browser.js";
import type { PacketSnapshot } from "../../../packages/contracts/src/documents.js";
import {
  type HostedOriginPermission,
  hostedOriginSchema,
} from "../../../packages/contracts/src/hosted-preparation.js";
import { request } from "./api.js";

const dateValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function HostedPreparationPanel({ packet }: { packet: PacketSnapshot }) {
  const origin = new URL(packet.content.job.url).origin;
  const [permissions, setPermissions] = useState<HostedOriginPermission[]>([]);
  const [history, setHistory] = useState<BrowserPreparation[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [expiry, setExpiry] = useState(() => dateValue(new Date(Date.now() + 30 * 86400000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const permissions = await request<HostedOriginPermission[]>("/v1/browser/origins");
      const history = await request<BrowserPreparation[]>("/v1/browser");
      setPermissions(permissions);
      setHistory(history);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Preparation evidence is unavailable.");
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const permission = permissions.find((item) => item.origin === origin);
  const active = permission?.state === "active" && Date.parse(permission.expiresAt) > Date.now();
  const latest = history.find(
    (item) =>
      item.result.packetId === packet.manifest.id && item.result.adapter?.id === "hosted-readonly",
  );
  const execute = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Hosted preparation failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="hosted-preparation" aria-label="Hosted preparation">
      <div className="section-toolbar">
        <h3>Hosted preparation</h3>
        <button
          type="button"
          className="icon-button"
          title="Refresh preparation evidence"
          aria-label="Refresh preparation evidence"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <code className="hosted-origin">{origin}</code>
      <div className="hosted-permission-row">
        <label className="check-row">
          <input
            type="checkbox"
            checked={reviewed}
            disabled={busy}
            onChange={(event) => setReviewed(event.target.checked)}
          />
          Public read and low-risk fill reviewed
        </label>
        <label>
          Approval expires
          <input
            type="date"
            value={expiry}
            min={dateValue(new Date())}
            max={dateValue(new Date(Date.now() + 179 * 86400000))}
            disabled={busy}
            onChange={(event) => setExpiry(event.target.value)}
          />
        </label>
      </div>
      <div className="panel-actions">
        <button
          type="button"
          disabled={busy || !reviewed || !expiry || !hostedOriginSchema.safeParse(origin).success}
          title="Approve public origin"
          onClick={() =>
            void execute(() =>
              request("/v1/browser/origins/approve", {
                origin,
                expectedRevision: permission?.revision ?? 0,
                expiresAt: new Date(`${expiry}T23:59:59`).toISOString(),
                publicReadAndLowRiskFillReviewed: true,
              }),
            )
          }
        >
          <ShieldCheck size={16} />
          Approve origin
        </button>
        <button
          type="button"
          disabled={
            busy ||
            !active ||
            !packet.valid ||
            packet.manifest.validation.status !== "valid" ||
            packet.manifest.letterGeneration?.method !== "llm"
          }
          title="Prepare public native fields"
          onClick={() =>
            void execute(() =>
              request("/v1/browser/hosted/prepare", { packetId: packet.manifest.id }),
            )
          }
        >
          <Play size={16} />
          Prepare fields
        </button>
        <button
          type="button"
          disabled={busy || !permission || permission.state === "revoked"}
          title="Revoke origin approval"
          aria-label="Revoke origin approval"
          onClick={() =>
            void execute(() =>
              request("/v1/browser/origins/revoke", {
                origin,
                expectedRevision: permission?.revision ?? 0,
              }),
            )
          }
        >
          <ShieldOff size={16} />
        </button>
        <span className="state-chip">
          {active
            ? "Origin approved"
            : permission?.state === "revoked"
              ? "Approval revoked"
              : "Approval required"}
        </span>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {latest && (
        <div className="hosted-evidence">
          <span className="state-chip">{latest.status.replaceAll("_", " ")}</span>
          <ul>
            {latest.result.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Readback</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {latest.result.reports.flatMap((report) =>
                  report.readBack.map((row) => (
                    <tr key={`${report.snapshot.step}:${row.name}`}>
                      <td>
                        {report.snapshot.fields.find((field) => field.name === row.name)?.label ??
                          row.name}
                      </td>
                      <td>{String(row.actual)}</td>
                      <td>{row.matches ? "Matched" : "Mismatch"}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
