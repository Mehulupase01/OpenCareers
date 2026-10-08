import { AlertTriangle, CircleCheck, Clock, PauseCircle, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { OwnerException } from "../../../packages/contracts/src/exception.js";
import { request } from "./api.js";

const blockerWords: Record<OwnerException["blocker"], string> = {
  answer_unknown: "Needs an approved answer",
  challenge_required: "Verification challenge",
  needs_review: "Outcome needs review",
  needs_input: "Needs information",
  unsupported_form: "Form not supported",
  task_failed: "Task failed",
  account_blocked: "Account blocked",
};

const actionLabel: Record<OwnerException["actions"][number], string> = {
  resolve_answer: "Answer and resolve",
  open_session: "Open verification",
  rebuild_form: "Rebuild form",
  reconcile: "Reconcile",
  defer: "Defer",
  skip: "Skip job",
  retry: "Retry",
};

export function ExceptionsPanel() {
  const [items, setItems] = useState<OwnerException[]>([]);
  const [facts, setFacts] = useState<{ id: string; key: string }[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [factId, setFactId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [exceptions, candidate] = await Promise.all([
        request<OwnerException[]>("/v1/exceptions"),
        request<{ facts: { id: string; key: string }[] }>("/v1/candidate"),
      ]);
      setItems(exceptions);
      setFacts(candidate.facts);
      setFactId((current) => current || candidate.facts[0]?.id || "");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Exceptions are unavailable.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (item: OwnerException, action: OwnerException["actions"][number]) => {
    setBusy(item.id);
    setError("");
    setNotice("");
    try {
      const body: Record<string, unknown> = { action };
      if (action === "resolve_answer") {
        const answer = answers[item.id] ?? "";
        if (!answer.trim()) throw new Error("Enter the approved answer before resolving.");
        if (!factId) throw new Error("Select the fact that supports this answer.");
        body.answer = answer.trim();
        body.factIds = [factId];
      }
      const result = await request<{
        requeued: number;
        handoff: { sessionId: string; token: string } | null;
      }>(`/v1/exceptions/${item.id}/resolve`, body);
      if (result.handoff)
        setNotice(
          `A verification session was created. Use this one-time token now: ${result.handoff.token}`,
        );
      else
        setNotice(
          `Recorded. ${result.requeued === 1 ? "That application was requeued." : "No work was resumed."}`,
        );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action could not be completed.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="exceptions-panel" aria-labelledby="exceptions-heading">
      <div className="section-toolbar">
        <div className="section-title">
          <AlertTriangle size={18} aria-hidden="true" />
          <h2 id="exceptions-heading">Needs your decision</h2>
        </div>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      <p className="panel-note">
        One item per blocker, showing the exact question and the exact job it affects. Nothing here
        is answered for you: an unknown question stays unknown until you approve wording that cites
        a reviewed fact.
      </p>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="notice-banner">{notice}</p>}
      {items.length === 0 ? (
        <p className="empty-state">Nothing is waiting on you.</p>
      ) : (
        <ul className="exception-list">
          {items.map((item) => (
            <li key={item.id} data-blocker={item.blocker} data-state={item.state}>
              <div className="exception-head">
                <strong>{blockerWords[item.blocker]}</strong>
                <span className="exception-code">{item.code}</span>
                {item.state === "deferred" && (
                  <span className="exception-deferred">
                    <Clock size={13} aria-hidden="true" /> Deferred
                  </span>
                )}
              </div>
              <p className="exception-reason">{item.reason}</p>
              <p className="exception-job">
                {item.job.title} &middot; {item.job.company}
                {item.job.countryCode ? ` · ${item.job.countryCode}` : ""}
              </p>
              {item.question && (
                <p className="exception-question">
                  <span className="question-key">{item.question.semanticKey}</span>
                  &ldquo;{item.question.meaning}&rdquo;
                </p>
              )}
              {item.suggestedAnswer ? (
                <p className="exception-suggestion">
                  Already approved for this exact question: {String(item.suggestedAnswer.answer)}
                </p>
              ) : null}
              {item.actions.includes("resolve_answer") && item.state !== "resolved" && (
                <div className="exception-answer">
                  <label htmlFor={`answer-${item.id}`}>Approved answer</label>
                  <input
                    id={`answer-${item.id}`}
                    value={answers[item.id] ?? ""}
                    placeholder="Exact wording the employer will read"
                    onChange={(event) =>
                      setAnswers((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                  />
                </div>
              )}
              <div className="exception-actions">
                {item.actions.includes("resolve_answer") && item.state !== "resolved" && (
                  <div className="exception-answer">
                    <label htmlFor={`fact-${item.id}`}>Supporting reviewed fact</label>
                    <select
                      id={`fact-${item.id}`}
                      value={factId}
                      onChange={(event) => setFactId(event.target.value)}
                    >
                      {facts.length === 0 && <option value="">No reviewed facts available</option>}
                      {facts.map((fact) => (
                        <option key={fact.id} value={fact.id}>
                          {fact.key}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {item.actions
                  .filter((action) => !(action === "resolve_answer" && item.state === "resolved"))
                  .map((action) => (
                    <button
                      key={action}
                      type="button"
                      disabled={busy === item.id}
                      onClick={() => void act(item, action)}
                    >
                      {action === "skip" ? (
                        <PauseCircle size={15} aria-hidden="true" />
                      ) : action === "resolve_answer" ? (
                        <CircleCheck size={15} aria-hidden="true" />
                      ) : (
                        <ShieldAlert size={15} aria-hidden="true" />
                      )}
                      {actionLabel[action]}
                    </button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
