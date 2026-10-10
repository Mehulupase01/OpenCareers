import { ExternalLink, Link, Mail, RefreshCw, RotateCcw, Save, Trash2, Unlink } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { MailSnapshot } from "../../../packages/contracts/src/email.js";
import { request } from "./api.js";
import { EmailVerification } from "./email-verification.js";

export function EmailWorkspace({ demo }: { demo: boolean }) {
  const [snapshot, setSnapshot] = useState<MailSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState("");
  const [mailbox, setMailbox] = useState("");
  const [testing, setTesting] = useState(true);
  const [origin, setOrigin] = useState("");
  const [domain, setDomain] = useState("");
  const [authorization, setAuthorization] = useState<{
    authorizationUrl: string;
    expiresAt: string;
  } | null>(null);
  const [syncStatus, setSyncStatus] = useState("");
  const refresh = useCallback(async () => {
    setSnapshot(await request<MailSnapshot>("/v1/email"));
  }, []);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const value = await request<MailSnapshot>("/v1/email");
        if (active) {
          setSnapshot(value);
          if (value.connection.state !== "connecting") setAuthorization(null);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Mailbox unavailable.");
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  const command = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mailbox action failed.");
    } finally {
      setBusy(false);
    }
  };
  const configure = (event: FormEvent) => {
    event.preventDefault();
    void command(async () => {
      await request("/v1/email/configure", { credentialsPath: path, mailbox, testing });
      setPath("");
      setMailbox("");
    });
  };
  const connected = snapshot?.connection.state === "connected";
  return (
    <section className="email-workspace">
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="section-heading">
        <div>
          <h2 className="email-heading">
            <Mail size={20} /> Gmail
          </h2>
          <span className="muted">
            {snapshot?.connection.state.replaceAll("_", " ") ?? "Loading"}
          </span>
        </div>
        <div className="button-group">
          {snapshot?.connection.scanPaused && (
            <button
              type="button"
              className="button secondary"
              title="Reset paused mail scan"
              aria-label="Reset paused mail scan"
              disabled={busy || demo || !connected}
              onClick={() => void command(() => request("/v1/email/reset-scan", {}))}
            >
              <RotateCcw size={16} />
            </button>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={busy || !connected || demo}
            onClick={() =>
              void command(async () => {
                const result = await request<{ status: string; observed: number }>(
                  "/v1/email/sync",
                  {},
                );
                setSyncStatus(`${result.status.replaceAll("_", " ")} (${result.observed})`);
              })
            }
          >
            <RefreshCw size={16} /> Sync
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={
              busy ||
              demo ||
              !snapshot ||
              connected ||
              snapshot.connection.state === "unconfigured" ||
              snapshot.connection.state === "refreshing"
            }
            onClick={() =>
              void command(async () => {
                setAuthorization(await request("/v1/email/connect", {}));
              })
            }
          >
            <Link size={16} /> Connect
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={
              busy ||
              !snapshot ||
              snapshot.connection.state === "unconfigured" ||
              snapshot.connection.state === "disconnected"
            }
            onClick={() =>
              void command(async () => {
                setAuthorization(null);
                await request("/v1/email/disconnect", {});
              })
            }
          >
            <Unlink size={16} /> Disconnect
          </button>
        </div>
      </div>
      <dl className="email-status">
        <div>
          <dt>Connection status</dt>
          <dd>{snapshot?.connection.reason ?? "Loading"}</dd>
        </div>
        <div>
          <dt>Last sync</dt>
          <dd>
            {snapshot?.connection.lastSyncAt
              ? new Date(snapshot.connection.lastSyncAt).toLocaleString()
              : "Never"}
          </dd>
        </div>
        <div>
          <dt>Access</dt>
          <dd>Read-only</dd>
        </div>
        <div>
          <dt>Refresh authorization expiry</dt>
          <dd>
            {snapshot?.connection.refreshExpiresAt
              ? new Date(snapshot.connection.refreshExpiresAt).toLocaleString()
              : "Not set"}
          </dd>
        </div>
        <div>
          <dt>Scan</dt>
          <dd role="status">{syncStatus || "Not started"}</dd>
        </div>
      </dl>
      {authorization && Date.parse(authorization.expiresAt) > Date.now() && (
        <a
          className="button"
          href={authorization.authorizationUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={16} /> Google consent
        </a>
      )}
      <h3>Desktop OAuth credentials</h3>
      <form className="candidate-form" onSubmit={configure}>
        <label className="wide">
          Credentials JSON path
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            required
            disabled={demo || busy || connected}
            autoComplete="off"
          />
        </label>
        <label>
          Gmail address
          <input
            type="email"
            value={mailbox}
            onChange={(event) => setMailbox(event.target.value)}
            required
            disabled={demo || busy || connected}
            autoComplete="off"
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={testing}
            onChange={(event) => setTesting(event.target.checked)}
            disabled={demo || busy || connected}
          />{" "}
          Google app in testing
        </label>
        <div className="form-actions wide">
          <button className="button" type="submit" disabled={demo || busy || connected}>
            <Save size={16} /> Save credentials
          </button>
        </div>
      </form>
      <h3>Reviewed sender domains</h3>
      <form
        className="candidate-form"
        onSubmit={(event) => {
          event.preventDefault();
          void command(async () => {
            await request("/v1/email/senders", { employerOrigin: origin, senderDomain: domain });
            setOrigin("");
            setDomain("");
          });
        }}
      >
        <label>
          Employer origin
          <input
            type="url"
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
            disabled={demo || busy}
            required
          />
        </label>
        <label>
          Sender domain
          <input
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            disabled={demo || busy}
            required
          />
        </label>
        <div className="form-actions wide">
          <button className="button secondary" type="submit" disabled={demo || busy}>
            <Save size={16} /> Approve sender
          </button>
        </div>
      </form>
      <ul className="email-senders">
        {snapshot?.senderRules.map((rule) => (
          <li key={`${rule.employerOrigin}:${rule.senderDomain}`}>
            <span className="email-sender">
              {rule.employerOrigin}
              <strong>{rule.senderDomain}</strong>
            </span>
            <button
              type="button"
              className="button secondary"
              title="Remove sender approval"
              aria-label={`Remove ${rule.senderDomain}`}
              disabled={busy}
              onClick={() => void command(() => request("/v1/email/senders", rule, "DELETE"))}
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
      <EmailVerification demo={demo} />
      <h3>Application mail</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Received</th>
              <th>Outcome</th>
              <th>Correlation</th>
              <th>Context</th>
            </tr>
          </thead>
          <tbody>
            {snapshot?.messages.map((message) => (
              <tr key={message.id}>
                <td>{new Date(message.receivedAt).toLocaleString()}</td>
                <td>{message.kind.replaceAll("_", " ")}</td>
                <td>{message.correlation}</td>
                <td>{message.contextId ?? "Unresolved"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
