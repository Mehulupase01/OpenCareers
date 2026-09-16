import {
  Check,
  Download,
  FileText,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  ShieldOff,
  Upload,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  authorizationStatus,
  chronology,
  describeFact,
  factStatus,
  usableFact,
} from "../../../packages/candidate/src/domain.js";
import {
  type CandidateFact,
  type CandidateSnapshot,
  type FactValue,
  factValueSchema,
  type PolicyInput,
  policyInputSchema,
  type SourceDocument,
} from "../../../packages/contracts/src/candidate.js";
import { request } from "./api.js";

type Field = {
  key: string;
  label: string;
  type?: "text" | "email" | "number" | "date" | "month" | "textarea" | "list";
  optional?: boolean;
  options?: string[];
};
const periods: Field[] = [
  { key: "start", label: "Start month", type: "month" },
  { key: "end", label: "End month", type: "month", optional: true },
];
const fields: Record<FactValue["kind"], Field[]> = {
  identity: [
    { key: "fullName", label: "Full name" },
    { key: "email", label: "Email", type: "email" },
    { key: "phone", label: "Phone", optional: true },
    { key: "links", label: "Profile links", type: "list", optional: true },
  ],
  employment: [
    { key: "employer", label: "Employer" },
    { key: "title", label: "Job title" },
    ...periods,
    { key: "workload", label: "Workload", options: ["full_time", "part_time"] },
    { key: "description", label: "Responsibilities", type: "textarea", optional: true },
  ],
  education: [
    { key: "institution", label: "Institution" },
    { key: "qualification", label: "Qualification" },
    ...periods,
  ],
  skill: [
    { key: "name", label: "Skill" },
    { key: "firstUsed", label: "First used", type: "month", optional: true },
  ],
  language: [
    { key: "name", label: "Language" },
    {
      key: "level",
      label: "Level",
      options: ["unspecified", "A1", "A2", "B1", "B2", "C1", "C2", "native"],
    },
  ],
  project: [
    { key: "name", label: "Project" },
    { key: "description", label: "Description", type: "textarea" },
    ...periods,
  ],
  metric: [
    { key: "statement", label: "Achievement" },
    { key: "value", label: "Value", type: "number" },
    { key: "unit", label: "Unit" },
    { key: "context", label: "Context" },
  ],
  availability: [
    { key: "earliestDate", label: "Earliest start date", type: "date", optional: true },
    { key: "noticeDays", label: "Notice period (days)", type: "number", optional: true },
  ],
  work_authorization: [
    { key: "country", label: "Country code" },
    {
      key: "currentlyAuthorized",
      label: "Current work permission",
      options: ["unknown", "yes", "no"],
    },
    { key: "permitExpiresOn", label: "Permit expiry", type: "date", optional: true },
    {
      key: "futureSponsorship",
      label: "Future sponsorship required",
      options: ["unknown", "yes", "no"],
    },
    { key: "approvedWording", label: "Approved wording", type: "textarea", optional: true },
  ],
};
const words = (value: string) => value.replaceAll("_", " ");
const list = (value: string) =>
  value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
const day = () => new Date().toISOString().slice(0, 10);
const later = () => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
type Action = (operation: () => Promise<unknown>) => Promise<boolean>;

function FactEditor({
  snapshot,
  fact,
  onSave,
  close,
  busy,
}: {
  snapshot: CandidateSnapshot;
  fact: CandidateFact | null;
  onSave: Action;
  close: () => void;
  busy: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<FactValue["kind"]>(fact?.value.kind ?? "identity");
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(fact?.value ?? {}).map(([k, v]) => [
        k,
        Array.isArray(v) ? v.join("\n") : String(v ?? ""),
      ]),
    ),
  );
  const [key, setKey] = useState(fact?.key ?? "");
  const [provenance, setProvenance] = useState(fact?.provenance.kind ?? "owner");
  const [statement, setStatement] = useState(
    fact?.provenance.kind === "owner" ? fact.provenance.statement : "",
  );
  const [sourceId, setSourceId] = useState(
    fact?.provenance.kind === "source" ? fact.provenance.sourceId : "",
  );
  const [source, setSource] = useState<SourceDocument | null>(null);
  const [locator, setLocator] = useState(
    fact?.provenance.kind === "source" ? fact.provenance.locator : "",
  );
  const [quote, setQuote] = useState(
    fact?.provenance.kind === "source" ? fact.provenance.quote : "",
  );
  const [expiry, setExpiry] = useState(fact?.expiresOn ?? "");
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let active = true;
    setSource(null);
    if (sourceId)
      void request<SourceDocument>(`/v1/candidate/sources/${encodeURIComponent(sourceId)}`)
        .then((value) => {
          if (active) setSource(value);
        })
        .catch(() => {
          if (active) setError("Source could not be loaded.");
        });
    return () => {
      active = false;
    };
  }, [sourceId]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const value: Record<string, unknown> = { kind };
    for (const field of fields[kind]) {
      const raw = values[field.key] ?? field.options?.[0] ?? "";
      value[field.key] =
        field.type === "list"
          ? list(raw)
          : field.type === "number"
            ? raw === ""
              ? null
              : Number(raw)
            : ["date", "month"].includes(field.type ?? "")
              ? raw || null
              : raw;
    }
    const parsed = factValueSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }
    const ok = await onSave(() =>
      request("/v1/candidate/facts", {
        ...(fact ? { id: fact.id } : {}),
        expectedRevision: fact?.revision ?? 0,
        key: key || `${kind}.${crypto.randomUUID()}`,
        value: parsed.data,
        provenance:
          provenance === "owner"
            ? { kind: "owner", statement }
            : { kind: "source", sourceId, locator, quote },
        expiresOn: expiry || null,
      }),
    );
    if (ok) close();
    else setError("Fact was not saved. Check the evidence and current revision, then try again.");
  };
  return (
    <dialog
      className="candidate-dialog"
      ref={dialog}
      onCancel={close}
      aria-label={fact ? "Edit fact" : "New fact"}
    >
      <div className="section-toolbar">
        <h2>{fact ? "Edit fact" : "New fact"}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close fact editor"
          title="Close"
          onClick={close}
        >
          <X size={17} />
        </button>
      </div>
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      <form
        onSubmit={(e) => {
          void submit(e);
        }}
        className="candidate-form"
      >
        <label>
          Category
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as FactValue["kind"]);
              setValues({});
            }}
          >
            {Object.keys(fields).map((k) => (
              <option key={k} value={k}>
                {words(k)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fact key
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            pattern="[a-zA-Z0-9_.:-]+"
            placeholder="Optional stable key"
          />
        </label>
        {fields[kind].map((field) => (
          <label
            key={field.key}
            htmlFor={`fact-${field.key}`}
            className={field.type === "textarea" || field.type === "list" ? "wide" : ""}
          >
            {field.label}
            {field.options ? (
              <select
                id={`fact-${field.key}`}
                value={values[field.key] ?? field.options[0]}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
              >
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {words(option)}
                  </option>
                ))}
              </select>
            ) : field.type === "textarea" || field.type === "list" ? (
              <textarea
                id={`fact-${field.key}`}
                value={values[field.key] ?? ""}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                required={!field.optional}
                rows={3}
              />
            ) : (
              <input
                id={`fact-${field.key}`}
                type={field.type ?? "text"}
                step={field.type === "number" ? "any" : undefined}
                value={values[field.key] ?? ""}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                required={!field.optional}
              />
            )}
          </label>
        ))}
        <label>
          Evidence
          <select
            value={provenance}
            onChange={(e) => setProvenance(e.target.value as "owner" | "source")}
          >
            <option value="owner">Owner assertion</option>
            <option value="source">Imported document</option>
          </select>
        </label>
        <label>
          Fact valid until
          <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </label>
        {provenance === "owner" ? (
          <label className="wide">
            Owner assertion
            <textarea
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              required
              maxLength={2000}
              rows={3}
            />
          </label>
        ) : (
          <>
            <label className="wide">
              Document
              <select
                value={sourceId}
                onChange={(e) => {
                  setSourceId(e.target.value);
                  setLocator("");
                  setQuote("");
                }}
                required
              >
                <option value="">Choose document</option>
                {snapshot.sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              Source locator
              <select
                value={locator}
                onChange={(e) => {
                  setLocator(e.target.value);
                  setQuote(
                    source?.blocks.find((b) => b.locator === e.target.value)?.text.slice(0, 2000) ??
                      "",
                  );
                }}
                required
              >
                <option value="">Choose source passage</option>
                {source?.blocks
                  .filter((b) => b.text.trim())
                  .map((b) => (
                    <option key={b.locator} value={b.locator}>
                      {b.locator}: {b.text.slice(0, 90)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="wide">
              Evidence quote
              <textarea
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
                required
                maxLength={2000}
                rows={3}
              />
            </label>
          </>
        )}
        <div className="form-actions wide">
          <button type="submit" className="button-primary" disabled={busy}>
            <Save size={15} />
            Save fact
          </button>
        </div>
      </form>
    </dialog>
  );
}

function AuthorizationForm({
  snapshot,
  act,
  busy,
}: {
  snapshot: CandidateSnapshot;
  act: Action;
  busy: boolean;
}) {
  const policy = snapshot.authorization;
  const [mode, setMode] = useState<PolicyInput["mode"]>(policy?.mode ?? "review_only");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(policy?.revision ?? 0);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    const data = new FormData(e.currentTarget);
    const get = (key: string) => String(data.get(key) ?? "").trim();
    const input = policyInputSchema.safeParse({
      expectedRevision: revision.current,
      mode,
      profileVersionId: snapshot.profile?.id ?? "",
      roleTerms: list(get("roles")),
      countries: list(get("countries")).map((s) => s.toUpperCase()),
      blockedEmployerIds: list(get("blocked")),
      dailyLimit: Number(get("limit")),
      allowAccountCreation: data.has("accounts"),
      allowOptionalDisclosures: data.has("disclosures"),
      sponsorshipWording: get("sponsorship") || null,
      salary:
        get("minimum") || get("maximum")
          ? {
              minimum: Number(get("minimum")),
              maximum: Number(get("maximum")),
              currency: get("currency").toUpperCase(),
              period: get("period"),
            }
          : null,
      salaryNegotiable: get("negotiable") === "unknown" ? null : get("negotiable") === "yes",
      effectiveAt: `${get("effective")}T00:00:00.000Z`,
      expiresAt: `${get("expires")}T23:59:59.000Z`,
      autoSubmitAcknowledged: ack,
    });
    if (!input.success) {
      setError(input.error.issues.map((i) => i.message).join("; "));
      return;
    }
    await act(() => request("/v1/candidate/authorization", input.data));
  };
  return (
    <section className="candidate-section">
      <div className="section-toolbar">
        <h2>Standing authorization</h2>
        <span className="stage">
          {authorizationStatus(policy, new Date())}
          {policy ? ` | Revision ${policy.revision}` : ""}
        </span>
      </div>
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      {!snapshot.profile && <div className="state-notice">No published candidate profile</div>}
      <form
        className="candidate-form"
        onSubmit={(e) => {
          void submit(e);
        }}
      >
        <fieldset className="mode-options wide">
          <legend>Operating mode</legend>
          {(["review_only", "fill_only", "auto_submit"] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="mode"
                value={value}
                checked={mode === value}
                onChange={() => {
                  setMode(value);
                  setAck(false);
                }}
              />
              {words(value)}
            </label>
          ))}
        </fieldset>
        <label>
          Role terms
          <textarea
            name="roles"
            required
            defaultValue={policy?.roleTerms.join("\n") ?? ""}
            rows={3}
          />
        </label>
        <label>
          Country codes
          <input name="countries" required defaultValue={policy?.countries.join(", ") ?? "NL"} />
        </label>
        <label>
          Blocked employer IDs
          <textarea
            name="blocked"
            defaultValue={policy?.blockedEmployerIds.join("\n") ?? ""}
            rows={3}
          />
        </label>
        <label>
          Daily submission limit
          <input
            name="limit"
            type="number"
            min={1}
            max={200}
            required
            defaultValue={policy?.dailyLimit ?? 5}
          />
        </label>
        <label>
          Effective date
          <input name="effective" type="date" required defaultValue={day()} />
        </label>
        <label>
          Expiry date
          <input name="expires" type="date" required defaultValue={later()} />
        </label>
        <label>
          Salary minimum
          <input
            name="minimum"
            type="number"
            min={0}
            step="any"
            defaultValue={policy?.salary?.minimum ?? ""}
          />
        </label>
        <label>
          Salary maximum
          <input
            name="maximum"
            type="number"
            min={0}
            step="any"
            defaultValue={policy?.salary?.maximum ?? ""}
          />
        </label>
        <label>
          Currency
          <input
            name="currency"
            defaultValue={policy?.salary?.currency ?? "EUR"}
            maxLength={3}
            pattern="[A-Za-z]{3}"
          />
        </label>
        <label>
          Salary period
          <select name="period" defaultValue={policy?.salary?.period ?? "year"}>
            <option value="year">Annual</option>
            <option value="month">Monthly</option>
            <option value="hour">Hourly</option>
          </select>
        </label>
        <label>
          Salary negotiable
          <select
            name="negotiable"
            defaultValue={
              policy?.salaryNegotiable === null || policy?.salaryNegotiable === undefined
                ? "unknown"
                : policy.salaryNegotiable
                  ? "yes"
                  : "no"
            }
          >
            <option value="unknown">Unspecified</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label className="wide">
          Sponsorship wording
          <textarea
            name="sponsorship"
            maxLength={2000}
            defaultValue={policy?.sponsorshipWording ?? ""}
            rows={3}
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="accounts"
            defaultChecked={policy?.allowAccountCreation ?? false}
          />
          Allow account creation
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="disclosures"
            defaultChecked={policy?.allowOptionalDisclosures ?? false}
          />
          Allow optional disclosures
        </label>
        {mode === "auto_submit" && (
          <label className="checkbox-field wide consent">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              required
            />
            I authorize final submissions within this policy without per-application confirmation.
          </label>
        )}
        <div className="form-actions wide">
          <button type="submit" className="button-primary" disabled={busy || !snapshot.profile}>
            <Save size={15} />
            Save authorization
          </button>
          {policy && (
            <>
              <a className="button-secondary link-button" href="/v1/candidate/authorization/export">
                <Download size={15} />
                Export authorization
              </a>
              <button
                type="button"
                className="button-stop"
                disabled={busy || Boolean(policy.revokedAt)}
                onClick={() => {
                  void act(() => request(`/v1/candidate/authorization/${policy.id}/revoke`, {}));
                }}
              >
                <ShieldOff size={15} />
                Revoke authorization
              </button>
            </>
          )}
        </div>
      </form>
    </section>
  );
}

function AnswerForm({
  snapshot,
  act,
  busy,
}: {
  snapshot: CandidateSnapshot;
  act: Action;
  busy: boolean;
}) {
  const [type, setType] = useState("text");
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const get = (name: string) => String(data.get(name) ?? "");
    const ok = await act(() =>
      request("/v1/candidate/answers", {
        semanticKey: get("key"),
        meaning: get("meaning"),
        answer:
          type === "number"
            ? Number(get("answer"))
            : type === "boolean"
              ? get("answer") === "true"
              : get("answer"),
        validFrom: get("from"),
        validUntil: get("until"),
        employerIds: list(get("employers")),
        countries: list(get("countries")).map((c) => c.toUpperCase()),
        evidenceFactIds: data.getAll("evidence").map(String),
      }),
    );
    if (ok) form.reset();
  };
  return (
    <section className="candidate-section">
      <h2>Approved answers</h2>
      <div className="answer-list">
        {snapshot.answers.map((a) => (
          <article key={a.id}>
            <strong>{a.meaning}</strong>
            <p>{String(a.answer)}</p>
            <small>
              {a.semanticKey} | Revision {a.revision} | Valid {a.validFrom} to {a.validUntil}
            </small>
          </article>
        ))}
      </div>
      <form
        className="candidate-form"
        onSubmit={(e) => {
          void submit(e);
        }}
      >
        <label>
          Semantic key
          <input name="key" required pattern="[a-zA-Z0-9_.:-]+" />
        </label>
        <label>
          Exact question meaning
          <input name="meaning" required maxLength={2000} />
        </label>
        <label>
          Answer type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="boolean">Yes / No</option>
          </select>
        </label>
        <label htmlFor="approved-answer">
          Approved answer
          {type === "boolean" ? (
            <select name="answer" id="approved-answer">
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : (
            <input
              key={type}
              id="approved-answer"
              type={type === "number" ? "number" : "text"}
              step="any"
              name="answer"
              required
            />
          )}
        </label>
        <label>
          Valid from
          <input type="date" name="from" defaultValue={day()} required />
        </label>
        <label>
          Valid until
          <input type="date" name="until" defaultValue={later()} required />
        </label>
        <label>
          Employer scope
          <input name="employers" />
        </label>
        <label>
          Country scope
          <input name="countries" />
        </label>
        <fieldset className="evidence-options wide">
          <legend>Reviewed evidence</legend>
          {snapshot.facts
            .filter((f) => usableFact(f, day()))
            .map((f) => (
              <label key={f.id} className="checkbox-field">
                <input type="checkbox" name="evidence" value={f.id} />
                {describeFact(f.value)}
              </label>
            ))}
        </fieldset>
        <div className="form-actions wide">
          <button type="submit" className="button-primary" disabled={busy}>
            <Check size={15} />
            Approve answer
          </button>
        </div>
      </form>
    </section>
  );
}

export function CandidateWorkspace({
  snapshot,
  refresh,
}: {
  snapshot: CandidateSnapshot;
  refresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState("profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<CandidateFact | null | undefined>(undefined);
  const [source, setSource] = useState<SourceDocument | null>(null);
  const act: Action = async (operation) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const experience = chronology(snapshot.facts, day());
  const usable = snapshot.facts.filter((f) => usableFact(f, day()));
  const unpublished =
    snapshot.profile &&
    (usable.length !== snapshot.profile.facts.length ||
      usable.some(
        (fact) =>
          !snapshot.profile?.facts.some((f) => f.id === fact.id && f.revision === fact.revision),
      ));
  const publish = () =>
    act(() => request("/v1/candidate/profile", { expectedRevision: snapshot.revision }));
  return (
    <div className="candidate-workspace">
      <div className="candidate-tabs" role="tablist" aria-label="Candidate views">
        {["profile", "sources", "authorization", "answers"].map((value) => (
          <button
            type="button"
            role="tab"
            key={value}
            aria-selected={tab === value}
            onClick={() => setTab(value)}
          >
            {value.charAt(0).toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      {busy && (
        <div className="inline-status" role="status">
          <LoaderCircle className="spin" size={16} />
          Saving changes
        </div>
      )}
      {tab === "profile" && (
        <section className="candidate-section">
          <div className="section-toolbar">
            <div>
              <h2>Candidate facts</h2>
              <span className="muted">
                {snapshot.profile
                  ? `Published revision ${snapshot.profile.revision}`
                  : "No published profile"}
              </span>
            </div>
            <div className="heading-actions">
              <button
                type="button"
                className="button-secondary"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                <Plus size={15} />
                Add fact
              </button>
              <button
                type="button"
                className="button-primary"
                disabled={busy || !snapshot.facts.length}
                onClick={() => {
                  void publish();
                }}
              >
                <Check size={15} />
                Publish profile
              </button>
            </div>
          </div>
          {unpublished && <div className="state-notice">Unpublished profile changes</div>}
          <dl className="candidate-totals">
            <div>
              <dt>Usable facts</dt>
              <dd>{snapshot.facts.filter((f) => usableFact(f, day())).length}</dd>
            </div>
            <div>
              <dt>Experience</dt>
              <dd>{experience.totalMonths} months</dd>
            </div>
            <div>
              <dt>Full-time / Part-time</dt>
              <dd>
                {experience.fullTimeMonths} / {experience.partTimeMonths} months
              </dd>
            </div>
          </dl>
          {experience.issues.length > 0 && (
            <div className="state-notice" role="alert">
              {experience.issues.length} chronology issue(s) require review
            </div>
          )}
          {!snapshot.facts.length ? (
            <div className="empty-state">No candidate facts</div>
          ) : (
            <div className="fact-list">
              {snapshot.facts.map((fact) => (
                <article key={fact.id}>
                  <div className="fact-main">
                    <span className={`stage ${usableFact(fact, day()) ? "complete" : ""}`}>
                      {words(factStatus(fact, day()))}
                    </span>
                    <strong>{describeFact(fact.value)}</strong>
                    <small>
                      {fact.key} | Revision {fact.revision} |{" "}
                      {fact.provenance.kind === "source"
                        ? fact.provenance.locator
                        : "Owner assertion"}
                    </small>
                    {fact.provenance.kind === "source" && (
                      <blockquote>{fact.provenance.quote}</blockquote>
                    )}
                  </div>
                  <div className="fact-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Edit ${fact.key}`}
                      title="Edit fact"
                      onClick={() => setEditing(fact)}
                      disabled={busy}
                    >
                      <Pencil size={15} />
                    </button>
                    {fact.status !== "verified" && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Verify ${fact.key}`}
                        title="Verify fact"
                        disabled={busy}
                        onClick={() => {
                          void act(() =>
                            request(`/v1/candidate/facts/${fact.id}/review`, {
                              expectedRevision: fact.revision,
                              status: "verified",
                            }),
                          );
                        }}
                      >
                        <Check size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Withhold ${fact.key}`}
                      title="Withhold conflicting fact"
                      disabled={busy || fact.status === "conflicting"}
                      onClick={() => {
                        void act(() =>
                          request(`/v1/candidate/facts/${fact.id}/review`, {
                            expectedRevision: fact.revision,
                            status: "conflicting",
                          }),
                        );
                      }}
                    >
                      <X size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {tab === "sources" && (
        <section className="candidate-section">
          <div className="section-toolbar">
            <h2>Source documents</h2>
            <label className="button-secondary upload-button">
              <Upload size={15} />
              Import document
              <input
                type="file"
                aria-label="Import document"
                accept=".pdf,.docx"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  void act(async () => {
                    const form = new FormData();
                    form.append("file", file);
                    const response = await fetch("/v1/candidate/sources", {
                      method: "POST",
                      body: form,
                      credentials: "same-origin",
                    });
                    const body = await response.json();
                    if (!response.ok) throw new Error(body.message ?? "Import failed.");
                    setSource(body as SourceDocument);
                  });
                }}
              />
            </label>
          </div>
          <div className="source-list">
            {snapshot.sources.map((document) => (
              <button
                type="button"
                key={document.id}
                className="source-row"
                disabled={busy}
                onClick={() => {
                  void act(async () =>
                    setSource(
                      await request<SourceDocument>(`/v1/candidate/sources/${document.id}`),
                    ),
                  );
                }}
              >
                <FileText size={20} />
                <span>
                  <strong>{document.name}</strong>
                  <small>
                    {document.blockCount} passages | {document.quality.replaceAll("_", " ")} |{" "}
                    {document.sha256.slice(0, 12)}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {source && (
            <div className="source-detail">
              <h3>{source.name}</h3>
              {source.warnings.map((warning) => (
                <p className="state-notice" key={warning}>
                  {warning}
                </p>
              ))}
              <div className="source-passages">
                {source.blocks.map((block) => (
                  <div key={block.locator}>
                    <code>{block.locator}</code>
                    <p>{block.text}</p>
                    {block.url && (
                      <a href={block.url} rel="noreferrer" target="_blank">
                        {block.url}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
      {tab === "authorization" && (
        <AuthorizationForm
          key={snapshot.authorization?.id ?? "new"}
          snapshot={snapshot}
          act={act}
          busy={busy}
        />
      )}
      {tab === "answers" && <AnswerForm snapshot={snapshot} act={act} busy={busy} />}
      {editing !== undefined && (
        <FactEditor
          snapshot={snapshot}
          fact={editing}
          onSave={act}
          close={() => setEditing(undefined)}
          busy={busy}
        />
      )}
    </div>
  );
}
