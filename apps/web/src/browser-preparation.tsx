import { AlertTriangle, CheckCircle2, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { BrowserPreparation } from "../../../packages/contracts/src/browser.js";
import type { PacketSnapshot } from "../../../packages/contracts/src/documents.js";
import type { HandoffSession } from "../../../packages/contracts/src/handoff.js";
import { request } from "./api.js";

export function BrowserPreparationPanel({ packet }: { packet: PacketSnapshot }) {
  const [country, setCountry] = useState("");
  const phone = packet.content.cv.identity.phone;
  const portfolio = packet.content.cv.identity.links[0] ?? "";
  const [sponsorship, setSponsorship] = useState("");
  const [available, setAvailable] = useState("");
  const [remote, setRemote] = useState("");
  const [attested, setAttested] = useState(false);
  const [history, setHistory] = useState<BrowserPreparation[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const [preparations, sessions] = await Promise.all([
        request<BrowserPreparation[]>("/v1/browser"),
        request<HandoffSession[]>("/v1/handoffs"),
      ]);
      setHistory(preparations);
      setHandoffs(sessions);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Browser preparations are unavailable.");
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const latest = history.find((item) => item.result.packetId === packet.manifest.id);
  const handoff = latest
    ? handoffs.find(
        (item) =>
          item.preparationId === latest.id &&
          ["open", "claimed", "rebuilding"].includes(item.state),
      )
    : undefined;
  const run = async () => {
    setBusy(true);
    try {
      await request<BrowserPreparation>("/v1/browser/dry-run", {
        packetId: packet.manifest.id,
        approvedValues: {
          country,
          sponsorship_required: sponsorship,
          available_from: available,
          remote_preference: remote,
          terms: attested,
        },
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Browser preparation failed.");
    } finally {
      setBusy(false);
    }
  };
  const openHandoff = async () => {
    if (!latest?.result.adapter) return;
    setBusy(true);
    try {
      const created = await request<{ session: HandoffSession; token: string }>("/v1/handoffs", {
        applicationId: latest.result.applicationId,
        preparationId: latest.id,
        adapterId: latest.result.adapter.id,
        targetFingerprint: latest.result.adapter.targetFingerprint,
      });
      await request<HandoffSession>(`/v1/handoffs/${created.session.id}/open`, {
        token: created.token,
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verification handoff failed.");
    } finally {
      setBusy(false);
    }
  };
  const completeHandoff = async () => {
    if (!handoff) return;
    setBusy(true);
    try {
      await request<HandoffSession>(`/v1/handoffs/${handoff.id}/complete`, {
        generation: handoff.generation,
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verification is not complete.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="browser-preparation" aria-label="Mock ATS dry run">
      <div className="section-toolbar">
        <div>
          <p className="eyebrow">MOCK ATS</p>
          <h3>Browser preparation</h3>
        </div>
        <button
          type="button"
          className="icon-button"
          title="Refresh browser preparations"
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <div className="browser-answer-grid">
        <label>
          Phone
          <input type="tel" value={phone} readOnly />
        </label>
        <label>
          Portfolio
          <input type="url" value={portfolio} readOnly />
        </label>
        <label>
          Country
          <select value={country} onChange={(event) => setCountry(event.target.value)}>
            <option value="">Select</option>
            <option value="NL">Netherlands</option>
            <option value="DE">Germany</option>
          </select>
        </label>
        <label>
          Future sponsorship
          <select value={sponsorship} onChange={(event) => setSponsorship(event.target.value)}>
            <option value="">Select</option>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </label>
        <label>
          Available from
          <input
            type="date"
            value={available}
            onChange={(event) => setAvailable(event.target.value)}
          />
        </label>
        <label>
          Remote preference
          <select value={remote} onChange={(event) => setRemote(event.target.value)}>
            <option value="">Select</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      </div>
      <div className="browser-run-row">
        <label className="browser-attestation">
          <input
            type="checkbox"
            checked={attested}
            onChange={(event) => setAttested(event.target.checked)}
          />{" "}
          I confirm these details are accurate
        </label>
        <button
          type="button"
          disabled={
            !packet.valid ||
            busy ||
            !phone ||
            !portfolio ||
            !country ||
            !sponsorship ||
            !available ||
            !remote ||
            !attested
          }
          onClick={() => void run()}
        >
          <Play size={16} /> {busy ? "Preparing" : "Run dry run"}
        </button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      {latest && (
        <div className="browser-result" data-preparation-id={latest.id}>
          <span className={`packet-state ${latest.status === "ready" ? "valid" : "invalid"}`}>
            {latest.status === "ready" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {latest.status.replaceAll("_", " ")}
          </span>
          <span>{latest.result.snapshots.length} form steps</span>
          <span>{latest.result.serverApplicationCount} submissions</span>
          <span>{new Date(latest.createdAt).toLocaleString()}</span>
          {latest.result.issues.length > 0 && (
            <ul>
              {latest.result.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          {latest.status === "challenge" && !handoff && (
            <button type="button" disabled={busy} onClick={() => void openHandoff()}>
              <Play size={16} /> Open verification
            </button>
          )}
          {handoff?.state === "claimed" && (
            <button type="button" disabled={busy} onClick={() => void completeHandoff()}>
              <CheckCircle2 size={16} /> Verification complete
            </button>
          )}
          {handoff?.state === "rebuilding" && (
            <span className="packet-state valid">
              <CheckCircle2 size={14} /> Rebuilding
            </span>
          )}
          <details>
            <summary>Form evidence</summary>
            {latest.result.snapshots.map((snapshot, index) => (
              <div key={snapshot.fingerprint} className="browser-step-evidence">
                <strong>Step {snapshot.step}</strong>
                <code>{snapshot.fingerprint}</code>
                <span>
                  {latest.result.reports[index]?.readBack.filter((field) => field.matches).length ??
                    0}{" "}
                  values verified
                </span>
                <span>Upload: {latest.result.reports[index]?.uploadStatus ?? "idle"}</span>
              </div>
            ))}
          </details>
        </div>
      )}
    </section>
  );
}
