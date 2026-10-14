import { Check, KeyRound, RefreshCw, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { EmployerAccount } from "../../../packages/contracts/src/account.js";
import { request } from "./api.js";

const stateWords: Record<EmployerAccount["state"], string> = {
  prepared: "Credentials stored, signup not dispatched",
  signup_in_flight: "Signup dispatched, outcome unknown",
  active: "Account confirmed",
  unknown: "Outcome unknown - not retried automatically",
  needs_verification: "Awaiting employer email verification",
  locked: "Locked",
  closed: "Disabled locally",
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
  const [recovery, setRecovery] = useState<EmployerAccount | null>(null);
  const [disposition, setDisposition] = useState<"verified_existing" | "closed">(
    "verified_existing",
  );
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [replacementPassword, setReplacementPassword] = useState("");
  const [evidenceSha256, setEvidenceSha256] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  const clearRecovery = () => {
    setRecovery(null);
    setRecoveryEmail("");
    setReplacementPassword("");
    setEvidenceSha256("");
    setReviewConfirmed(false);
  };
  const recordRecovery = async () => {
    if (!recovery) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const common = {
        expectedUpdatedAt: recovery.updatedAt,
        reviewedAt: new Date().toISOString(),
        evidenceSha256,
      };
      await request(
        `/v1/accounts/${recovery.id}/recovery`,
        disposition === "closed"
          ? { ...common, disposition, closePermanently: reviewConfirmed }
          : {
              ...common,
              disposition,
              employerOrigin: recovery.employerOrigin,
              adapterId: recovery.adapterId,
              identityEmail: recoveryEmail,
              replacementPassword,
              existingAccountAndReplacementCredentialVerified: reviewConfirmed,
            },
      );
      clearRecovery();
      await refresh();
      setNotice("Account recovery review recorded.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Account recovery failed.");
    } finally {
      setReplacementPassword("");
      setBusy(false);
    }
  };

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
        <button
          type="button"
          onClick={() => {
            clearRecovery();
            void refresh();
          }}
          disabled={busy}
        >
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
              {account.state === "locked" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    clearRecovery();
                    setDisposition("verified_existing");
                    setRecovery(account);
                  }}
                >
                  <KeyRound size={16} aria-hidden="true" /> Review recovery
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void dispatch(account)}
                  disabled={busy || account.state !== "prepared"}
                >
                  <UserPlus size={16} aria-hidden="true" /> Create the account
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {recovery && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void recordRecovery();
          }}
        >
          <fieldset className="account-form" disabled={busy}>
            <legend>Recovery review</legend>
            <p className="account-state">{recovery.employerOrigin}</p>
            <label htmlFor="recovery-disposition">Disposition</label>
            <select
              id="recovery-disposition"
              value={disposition}
              onChange={(event) => {
                setDisposition(event.target.value as "verified_existing" | "closed");
                setReplacementPassword("");
                setReviewConfirmed(false);
              }}
            >
              <option value="verified_existing">Existing account verified</option>
              <option value="closed">Disable account locally</option>
            </select>
            {disposition === "verified_existing" && (
              <>
                <label htmlFor="recovery-email">Verified identity email</label>
                <input
                  id="recovery-email"
                  type="email"
                  required
                  value={recoveryEmail}
                  onChange={(event) => setRecoveryEmail(event.target.value)}
                  autoComplete="off"
                />
                <label htmlFor="recovery-password">Verified replacement password</label>
                <input
                  id="recovery-password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={1024}
                  value={replacementPassword}
                  onChange={(event) => setReplacementPassword(event.target.value)}
                  autoComplete="new-password"
                />
              </>
            )}
            <label htmlFor="recovery-evidence">Review evidence SHA-256</label>
            <input
              id="recovery-evidence"
              required
              pattern="[a-f0-9]{64}"
              maxLength={64}
              value={evidenceSha256}
              onChange={(event) => setEvidenceSha256(event.target.value)}
              autoComplete="off"
            />
            <label className="account-recovery-confirm">
              <input
                type="checkbox"
                required
                checked={reviewConfirmed}
                onChange={(event) => setReviewConfirmed(event.target.checked)}
              />
              {disposition === "closed"
                ? "Permanently disable this local account"
                : "Existing account and replacement credential verified"}
            </label>
            <div className="account-recovery-actions">
              <button type="submit" disabled={!reviewConfirmed}>
                <Check size={16} aria-hidden="true" /> Record review
              </button>
              <button type="button" onClick={clearRecovery}>
                <X size={16} aria-hidden="true" /> Cancel
              </button>
            </div>
          </fieldset>
        </form>
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
