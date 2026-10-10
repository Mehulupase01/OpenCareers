import { LockKeyhole, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SourceSessionSummary } from "../../../packages/contracts/src/source-session.js";
import { request } from "./api.js";

export function SourceSessions({ demo }: { demo: boolean }) {
  const [sessions, setSessions] = useState<SourceSessionSummary[]>([]);
  const [source, setSource] = useState("");
  const [adapter, setAdapter] = useState("");
  const [permission, setPermission] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const refresh = useCallback(
    async () => setSessions(await request<SourceSessionSummary[]>("/v1/discovery/source-sessions")),
    [],
  );
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const value = await request<SourceSessionSummary[]>("/v1/discovery/source-sessions");
        if (active) setSessions(value);
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : "Source sessions unavailable.");
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
      setError(cause instanceof Error ? cause.message : "Source session action failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <div className="section-heading">
        <h3>
          <LockKeyhole size={18} /> Owner-source sessions
        </h3>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <form
        className="candidate-form"
        onSubmit={(event) => {
          event.preventDefault();
          void command(async () => {
            const selected = file.current?.files?.[0];
            if (!selected || selected.size > 64000)
              throw new Error("Choose a bounded scoped-session JSON file.");
            let session: unknown;
            try {
              session = JSON.parse(await selected.text());
            } catch {
              throw new Error("The scoped-session file is not valid JSON.");
            }
            await request("/v1/discovery/source-sessions", {
              sourceId: source,
              adapterId: adapter,
              expectedRevision: sessions.find((item) => item.sourceId === source)?.revision ?? 0,
              ownedAccount: true,
              permissionEvidenceSha256: permission,
              expiresAt: new Date(expires).toISOString(),
              session,
            });
            if (file.current) file.current.value = "";
            setSource("");
            setAdapter("");
            setPermission("");
            setExpires("");
          });
        }}
      >
        <label>
          Source identifier
          <input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            pattern="[a-z][a-z0-9_-]{1,79}"
            required
            disabled={demo || busy}
          />
        </label>
        <label>
          Source adapter
          <input
            value={adapter}
            onChange={(event) => setAdapter(event.target.value)}
            pattern="[a-z][a-z0-9_-]{1,99}"
            required
            disabled={demo || busy}
          />
        </label>
        <label className="wide">
          Permission evidence SHA-256
          <input
            value={permission}
            onChange={(event) => setPermission(event.target.value)}
            pattern="[a-f0-9]{64}"
            required
            disabled={demo || busy}
          />
        </label>
        <label>
          Session authority expiry
          <input
            type="datetime-local"
            value={expires}
            onChange={(event) => setExpires(event.target.value)}
            required
            disabled={demo || busy}
          />
        </label>
        <label>
          Scoped session JSON
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            required
            disabled={demo || busy}
          />
        </label>
        <div className="form-actions wide">
          <button className="button secondary" type="submit" disabled={demo || busy}>
            <Upload size={16} /> Import source session
          </button>
        </div>
      </form>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Origin</th>
              <th>Adapter</th>
              <th>Status</th>
              <th>Expires</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.sourceId}>
                <td>{session.sourceId}</td>
                <td>{session.origin}</td>
                <td>{session.adapterId}</td>
                <td>{session.state}</td>
                <td>{new Date(session.expiresAt).toLocaleString()}</td>
                <td>
                  <button
                    type="button"
                    className="button secondary"
                    title="Revoke source session"
                    aria-label={`Revoke source ${session.sourceId}`}
                    disabled={busy || session.state === "revoked"}
                    onClick={() =>
                      void command(() =>
                        request(
                          `/v1/discovery/source-sessions/${encodeURIComponent(session.sourceId)}`,
                          { expectedRevision: session.revision },
                          "DELETE",
                        ),
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
