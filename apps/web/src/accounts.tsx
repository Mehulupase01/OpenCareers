import { KeyRound, RefreshCw, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { EmployerAccount } from "../../../packages/contracts/src/account.js";
import { request } from "./api.js";

const stateWords: Record<EmployerAccount["state"], string> = {
  prepared: "Credentials stored, signup not dispatched",
  signup_in_flight: "Signup dispatched, outcome unknown",
  active: "Signed in",
  unknown: "Outcome unknown - not retried automatically",
  needs_verification: "Awaiting employer email verification",
  locked: "Locked",
  closed: "Closed",
};

export function AccountsPanel() {
  const [accounts, setAccounts] = useState<EmployerAccount[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [origin, setOrigin] = useState("");
  const [adapterId, setAdapterId] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [list, candidate] = await Promise.all([
        request<EmployerAccount[]>("/v1/accounts"),
        request<{ candidateId: string }>("/v1/candidate"),
      ]);
      setAccounts(list);
      setCandidateId((current) => current || candidate.candidateId);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Employer accounts are unavailable.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const prepare = async () => {
    setBusy(true);
    setNotice("");
    try {
      await request<EmployerAccount>("/v1/accounts", {
        candidateId,
        employerOrigin: origin,
        adapterId,
        identityEmail: email,
      });
      setOrigin("");
      setAdapterId("");
      setNotice("A unique password was generated and sealed. It is not shown here.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Account preparation failed.");
    } finally {
      setBusy(false);
    }
  };

  const dispatch = async (account: EmployerAccount) => {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const result = await request<{ account: EmployerAccount }>(
        `/v1/accounts/${account.id}/signup`,
        { identityEmail: email },
      );
      setNotice(
        result.account
          ? `Signup ${
              result.account.state === "active"
                ? "confirmed by the employer"
                : `recorded as ${result.account.state}`
            }.`
          : "Signup dispatched.",
      );
      await refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Signup dispatch failed.";
      // Refresh first: it clears the panel error on success, so the dispatch
      // failure has to be set afterwards or it is wiped before it is read.
      await refresh();
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="accounts-panel" aria-labelledby="accounts-heading">
      <div className="section-toolbar">
        <div className="section-title">
          <KeyRound size={18} aria-hidden="true" />
          <h2 id="accounts-heading">Employer accounts</h2>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={busy}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh
        </button>
      </div>
      <p className="panel-note">
        Signup is a one-action commit: an intent and a short-lived dispatch permit are recorded
        before the single request, and a lost response becomes an unknown outcome that is never
        retried into a second account.
      </p>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="notice-banner">{notice}</p>}
      {accounts.length === 0 ? (
        <p className="empty-state">No employer accounts prepared.</p>
      ) : (
        <ul className="account-list">
          {accounts.map((account) => (
            <li key={account.id} data-account-state={account.state}>
              <div>
                <strong>{account.employerOrigin}</strong>
                <span className="account-adapter">{account.adapterId}</span>
                <p className="account-state">{stateWords[account.state]}</p>
                <p className="account-meta">
                  identity {account.identityEmailHash.slice(0, 12)}... | credential{" "}
                  {account.hasCredential ? "sealed in the vault" : "absent"} | updated{" "}
                  {account.updatedAt.slice(0, 10)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void dispatch(account)}
                disabled={busy || account.state !== "prepared"}
              >
                <UserPlus size={16} aria-hidden="true" /> Create the account
              </button>
            </li>
          ))}
        </ul>
      )}
      <fieldset className="account-form">
        <legend>Prepare an employer account</legend>
        <label htmlFor="account-candidate">Candidate</label>
        <input
          id="account-candidate"
          value={candidateId}
          onChange={(event) => setCandidateId(event.target.value)}
        />
        <label htmlFor="account-origin">Employer origin</label>
        <input
          id="account-origin"
          placeholder="https://careers.example.com"
          value={origin}
          onChange={(event) => setOrigin(event.target.value)}
        />
        <label htmlFor="account-adapter">Adapter</label>
        <input
          id="account-adapter"
          placeholder="recruitee"
          value={adapterId}
          onChange={(event) => setAdapterId(event.target.value)}
        />
        <label htmlFor="account-email">Identity email</label>
        <input
          id="account-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <p className="panel-note">
          The email is hashed on the way in and never stored. It is supplied again at dispatch and
          must hash to the same identity.
        </p>
        <button
          type="button"
          onClick={() => void prepare()}
          disabled={busy || !candidateId || !origin || !adapterId || !email}
        >
          Prepare account
        </button>
      </fieldset>
    </section>
  );
}
