import { Check, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { VerificationRule } from "../../../packages/email/src/verification.js";
import { request } from "./api.js";

type Snapshot = {
  rules: VerificationRule[];
  links: { id: string; accountId: string; state: string; expiresAt: string }[];
};
const queryKeys: VerificationRule["queryKeys"] = [
  "token",
  "code",
  "key",
  "verification_token",
  "confirmation_token",
];
export function EmailVerification({ demo }: { demo: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [origin, setOrigin] = useState("");
  const [pathname, setPathname] = useState("");
  const [keys, setKeys] = useState<VerificationRule["queryKeys"]>(["token"]);
  const [marker, setMarker] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(
    async () => setSnapshot(await request<Snapshot>("/v1/email/verification")),
    [],
  );
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const value = await request<Snapshot>("/v1/email/verification");
        if (active) setSnapshot(value);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Verification unavailable.");
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
      setError(cause instanceof Error ? cause.message : "Verification action failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <h3>Reviewed verification routes</h3>
      <form
        className="candidate-form"
        onSubmit={(event) => {
          event.preventDefault();
          void command(async () => {
            await request("/v1/email/verification/rules", {
              employerOrigin: origin,
              pathname,
              queryKeys: keys,
              successMarker: marker,
            });
            setOrigin("");
            setPathname("");
            setMarker("");
          });
        }}
      >
        <label>
          Verification employer origin
          <input
            type="url"
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
            disabled={demo || busy}
            required
          />
        </label>
        <label>
          Verification path
          <input
            value={pathname}
            onChange={(event) => setPathname(event.target.value)}
            disabled={demo || busy}
            required
          />
        </label>
        <label>
          Token query fields
          <select
            multiple
            value={keys}
            disabled={demo || busy}
            onChange={(event) =>
              setKeys(
                Array.from(
                  event.target.selectedOptions,
                  (option) => option.value as VerificationRule["queryKeys"][number],
                ),
              )
            }
          >
            {queryKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
        <label>
          Exact success text
          <input
            value={marker}
            onChange={(event) => setMarker(event.target.value)}
            minLength={16}
            maxLength={240}
            disabled={demo || busy}
            required
          />
        </label>
        <div className="form-actions wide">
          <button className="button secondary" type="submit" disabled={demo || busy}>
            <Save size={16} /> Approve route
          </button>
        </div>
      </form>
      <ul className="email-senders">
        {snapshot?.rules.map((rule) => (
          <li key={`${rule.employerOrigin}${rule.pathname}`}>
            <span className="email-sender">
              {rule.employerOrigin}
              <strong>{rule.pathname}</strong>
            </span>
            <button
              type="button"
              className="button secondary"
              title="Remove verification route approval"
              aria-label={`Remove verification ${rule.pathname}`}
              disabled={busy}
              onClick={() =>
                void command(() =>
                  request(
                    "/v1/email/verification/rules",
                    { employerOrigin: rule.employerOrigin, pathname: rule.pathname },
                    "DELETE",
                  ),
                )
              }
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
      <h3>Account verification</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Status</th>
              <th>Expires</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {snapshot?.links.map((link) => (
              <tr key={link.id}>
                <td>{link.accountId}</td>
                <td>{link.state.replaceAll("_", " ")}</td>
                <td>{new Date(link.expiresAt).toLocaleString()}</td>
                <td>
                  <button
                    type="button"
                    className="button secondary"
                    title="Verify reviewed account"
                    aria-label={`Verify account ${link.accountId}`}
                    disabled={
                      demo ||
                      busy ||
                      link.state !== "pending" ||
                      Date.parse(link.expiresAt) <= Date.now()
                    }
                    onClick={() =>
                      void command(() => request(`/v1/email/verification/${link.id}/follow`, {}))
                    }
                  >
                    <Check size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
