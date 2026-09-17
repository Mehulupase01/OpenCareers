import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  FileText,
  FolderOpen,
  GitMerge,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type DiscoveryListing,
  type DiscoverySnapshot,
  type DiscoverySource,
  type HistoryRecord,
  type SourceInput,
  type SourcePageEvidence,
  type SourceRun,
  sourceInputSchema,
} from "../../../packages/contracts/src/discovery.js";
import { request } from "./api.js";

type Act = (operation: () => Promise<unknown>) => Promise<boolean>;
const words = (text: string) => text.replaceAll("_", " ");
const date = (value: string | null) => (value ? new Date(value).toLocaleString() : "Never");

function SourceEditor({
  demo,
  close,
  act,
  busy,
}: {
  demo: boolean;
  close: () => void;
  act: Act;
  busy: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [connector, setConnector] = useState<SourceInput["connector"]>("greenhouse");
  const [region, setRegion] = useState<SourceInput["region"]>("global");
  const [board, setBoard] = useState(demo ? "synthetic-board" : "");
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const ok = await act(() =>
      request("/v1/discovery/sources", {
        expectedRevision: 0,
        connector,
        board,
        region,
        employerId: String(data.get("employer")),
        company: String(data.get("company")),
        intervalSeconds: Number(data.get("minutes")) * 60,
        enabled: true,
        mode: demo ? "fixture" : "live",
      }),
    );
    if (ok) close();
    else setError("Source was not saved. Check its identity and configuration.");
  };
  return (
    <dialog
      ref={dialog}
      className="candidate-dialog"
      onCancel={close}
      aria-label="Add discovery source"
    >
      <div className="section-toolbar">
        <h2>Add source</h2>
        <button
          type="button"
          className="icon-button"
          title="Close"
          aria-label="Close source editor"
          onClick={close}
        >
          <X size={17} />
        </button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <form
        className="candidate-form"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <label className="wide">
          Vacancy URL
          <input
            type="url"
            name="url"
            onBlur={(event) => {
              if (!event.target.value) return;
              void request<{
                connector: SourceInput["connector"];
                board: string;
                region: SourceInput["region"];
              }>("/v1/discovery/recognize", { url: event.target.value })
                .then((source) => {
                  setConnector(source.connector);
                  setBoard(source.board);
                  setRegion(source.region);
                  setError("");
                })
                .catch((error: Error) => setError(error.message));
            }}
          />
        </label>
        <label>
          Connector
          <select
            value={connector}
            onChange={(event) => setConnector(event.target.value as SourceInput["connector"])}
          >
            <option value="greenhouse">Greenhouse</option>
            <option value="lever">Lever</option>
          </select>
        </label>
        <label>
          Board token
          <input
            value={board}
            required
            pattern="[a-zA-Z0-9_-]+"
            maxLength={100}
            onChange={(event) => setBoard(event.target.value)}
          />
        </label>
        <label>
          Region
          <select
            value={region}
            onChange={(event) => setRegion(event.target.value as SourceInput["region"])}
          >
            <option value="global">Global</option>
            <option value="eu">EU</option>
          </select>
        </label>
        <label>
          Company
          <input
            name="company"
            required
            maxLength={240}
            defaultValue={demo ? "Synthetic Employer" : ""}
          />
        </label>
        <label>
          Employer ID
          <input
            name="employer"
            required
            pattern="[a-zA-Z0-9_.:-]+"
            maxLength={180}
            defaultValue={demo ? "synthetic-employer" : ""}
          />
        </label>
        <label>
          Poll interval (minutes)
          <input name="minutes" type="number" min={5} max={1440} defaultValue={60} required />
        </label>
        <div className="form-actions wide">
          <button type="submit" className="button-primary" disabled={busy}>
            <Plus size={15} />
            Add source
          </button>
        </div>
      </form>
    </dialog>
  );
}

function VacancyDetail({ listing, close }: { listing: DiscoveryListing; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [evidence, setEvidence] = useState<{
    run: SourceRun;
    pages: SourcePageEvidence[];
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="candidate-dialog discovery-detail"
      onCancel={close}
      aria-label="Vacancy evidence"
    >
      <div className="section-toolbar">
        <h2>{listing.job.title}</h2>
        <button
          type="button"
          className="icon-button"
          onClick={close}
          title="Close"
          aria-label="Close vacancy evidence"
        >
          <X size={17} />
        </button>
      </div>
      <p>
        {listing.job.company} | {listing.job.location}
      </p>
      <dl className="discovery-facts">
        <div>
          <dt>Status</dt>
          <dd>{listing.state}</dd>
        </div>
        <div>
          <dt>Country / City</dt>
          <dd>
            {listing.job.countryCode ?? "Unknown"} / {listing.job.city ?? "Unknown"}
          </dd>
        </div>
        <div>
          <dt>Workplace</dt>
          <dd>{words(listing.job.remote)}</dd>
        </div>
        <div>
          <dt>First seen</dt>
          <dd>{date(listing.firstSeenAt)}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd>{date(listing.lastSeenAt)}</dd>
        </div>
        <div>
          <dt>Posted / Updated</dt>
          <dd>
            {date(listing.job.postedAt)} / {date(listing.job.updatedAt)}
          </dd>
        </div>
        <div>
          <dt>Requisition</dt>
          <dd>{listing.job.providerRequisition ?? listing.job.requisitionId}</dd>
        </div>
        <div>
          <dt>Source locator</dt>
          <dd>{listing.job.evidence.locator}</dd>
        </div>
      </dl>
      <div className="form-actions">
        <a
          className="button-secondary"
          href={listing.job.canonicalUrl}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={15} />
          Original vacancy
        </a>
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            void request<{ run: SourceRun; pages: SourcePageEvidence[] }>(
              `/v1/discovery/runs/${listing.lastRunId}`,
            )
              .then(setEvidence)
              .catch((error: Error) => setError(error.message));
          }}
        >
          <FileText size={15} />
          Source evidence
        </button>
      </div>
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      {evidence && (
        <div className="discovery-evidence">
          {evidence.pages.map((page) => (
            <dl key={`${page.url}:${page.sha256}`}>
              <dt>Public source</dt>
              <dd>{page.url}</dd>
              <dt>Observed</dt>
              <dd>
                {date(page.fetchedAt)} | HTTP {page.status}
              </dd>
              <dt>SHA-256</dt>
              <dd>{page.sha256}</dd>
            </dl>
          ))}
        </div>
      )}
      <pre className="vacancy-description">{listing.job.description}</pre>
    </dialog>
  );
}

function HistoryPanel({
  snapshot,
  act,
  busy,
}: {
  snapshot: DiscoverySnapshot;
  act: Act;
  busy: boolean;
}) {
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<"json" | "csv">("json");
  const [preview, setPreview] = useState<HistoryRecord[] | null>(null);
  const [documents, setDocuments] = useState<HistoryRecord["documents"]>([]);
  const directory = useRef<HTMLInputElement>(null);
  useEffect(() => {
    directory.current?.setAttribute("webkitdirectory", "");
  }, []);
  return (
    <section className="candidate-section">
      <div className="section-toolbar">
        <h2>Historical records</h2>
        <label className="button-secondary upload-button">
          <Upload size={15} />
          Import history
          <input
            type="file"
            accept=".json,.csv"
            aria-label="History file"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              setPreview(null);
              if (!file) return;
              void act(async () => {
                if (file.size > 2 * 1024 * 1024) throw new Error("History exceeds 2 MiB.");
                const text = await file.text();
                const kind = file.name.toLowerCase().endsWith(".csv") ? "csv" : "json";
                const response = await request<{ records: HistoryRecord[] }>(
                  "/v1/discovery/history",
                  { format: kind, content: text, preview: true },
                );
                setContent(text);
                setFormat(kind);
                setPreview(response.records);
              });
            }}
          />
        </label>
      </div>
      {preview && (
        <div className="history-preview">
          <h3>Import preview: {preview.length} records</h3>
          <ul>
            {preview.slice(0, 20).map((record) => (
              <li key={record.externalId}>
                {record.company}: {record.title}{" "}
                <span className="stage">
                  {record.submitted ? "Owner-asserted submission" : "Documents only"}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="button-primary"
            disabled={busy}
            onClick={() => {
              void act(async () => {
                await request("/v1/discovery/history", { content, format, preview: false });
                setPreview(null);
              });
            }}
          >
            <Check size={15} />
            Import records
          </button>
        </div>
      )}
      <details className="folder-import">
        <summary>Document-folder metadata</summary>
        <form
          className="candidate-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void act(async () => {
              const record: HistoryRecord = {
                externalId: String(data.get("externalId")),
                url: String(data.get("url")),
                company: String(data.get("company")),
                title: String(data.get("title")),
                location: "Unknown",
                submitted: false,
                submittedOn: null,
                ownerAssertion: "",
                documents,
              };
              const text = JSON.stringify([record]);
              const response = await request<{ records: HistoryRecord[] }>(
                "/v1/discovery/history",
                { format: "json", content: text, preview: true },
              );
              setContent(text);
              setFormat("json");
              setPreview(response.records);
            });
          }}
        >
          <label>
            External record ID
            <input name="externalId" required />
          </label>
          <label>
            Vacancy URL
            <input name="url" type="url" required />
          </label>
          <label>
            Company
            <input name="company" required />
          </label>
          <label>
            Role title
            <input name="title" required />
          </label>
          <label className="wide">
            Folder
            <input
              ref={directory}
              type="file"
              multiple
              aria-label="Document folder"
              disabled={busy}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                void act(async () => {
                  if (files.length > 50)
                    throw new Error("A folder record supports up to 50 documents.");
                  const result: HistoryRecord["documents"] = [];
                  for (const file of files) {
                    if (file.size > 10 * 1024 * 1024) throw new Error("A document exceeds 10 MiB.");
                    const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
                    result.push({
                      name: file.name,
                      sha256: Array.from(new Uint8Array(hash), (b) =>
                        b.toString(16).padStart(2, "0"),
                      ).join(""),
                    });
                  }
                  setDocuments(result);
                });
              }}
            />
          </label>
          <div className="form-actions wide">
            <span>{documents.length} document references</span>
            <button type="submit" className="button-secondary" disabled={busy || !documents.length}>
              <FolderOpen size={15} />
              Preview folder record
            </button>
          </div>
        </form>
      </details>
      <div className="answer-list">
        {snapshot.history.map((record) => (
          <article key={record.id}>
            <strong>
              {record.company}: {record.title}
            </strong>
            <p>
              {record.submitted
                ? `Owner-asserted submission on ${record.submittedOn}`
                : "Document reference only"}
            </p>
            <small>
              {record.externalId} | {record.documents.length} document(s) |{" "}
              {record.jobId ? "Linked vacancy" : "Awaiting discovery"}
            </small>
          </article>
        ))}
      </div>
    </section>
  );
}

export function DiscoveryWorkspace({ demo }: { demo: boolean }) {
  const [snapshot, setSnapshot] = useState<DiscoverySnapshot | null>(null);
  const [tab, setTab] = useState("vacancies");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<DiscoveryListing | null>(null);
  const refresh = useCallback(async () => {
    setSnapshot(
      await request<DiscoverySnapshot>(
        `/v1/discovery?offset=${offset}&q=${encodeURIComponent(query)}`,
      ),
    );
  }, [offset, query]);
  useEffect(() => {
    let active = true;
    const update = () => {
      void refresh().catch((error: Error) => {
        if (active) setError(error.message);
      });
    };
    update();
    const timer = window.setInterval(update, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refresh]);
  const act: Act = async (operation) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Operation failed.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const toggle = (source: DiscoverySource) =>
    act(() =>
      request("/v1/discovery/sources", {
        ...sourceInputSchema.strip().parse(source),
        expectedRevision: source.revision,
        enabled: !source.enabled,
      }),
    );
  return (
    <div className="candidate-workspace discovery-workspace">
      <div className="candidate-tabs" role="tablist" aria-label="Discovery views">
        {["vacancies", "sources", "history", "identity"].map((value) => (
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
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {!snapshot ? (
        <div role="status" className="empty-state">
          Loading discovery
        </div>
      ) : (
        <>
          {tab === "vacancies" && (
            <section className="data-section">
              <div className="section-toolbar">
                <h2>
                  Discovered vacancies <span className="muted">{snapshot.listingCount}</span>
                </h2>
                <label className="search">
                  <Search size={16} />
                  <input
                    type="search"
                    aria-label="Search discovered vacancies"
                    placeholder="Search vacancies"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setOffset(0);
                    }}
                  />
                </label>
              </div>
              <div className="table-scroll">
                <table className="vacancy-table">
                  <thead>
                    <tr>
                      <th>Role / Company</th>
                      <th>Location</th>
                      <th>Freshness</th>
                      <th>Source</th>
                      <th>
                        <span className="sr-only">Details</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.listings.map((listing) => (
                      <tr key={listing.id}>
                        <td>
                          <button
                            type="button"
                            className="row-link"
                            onClick={() => setSelected(listing)}
                          >
                            {listing.job.title}
                          </button>
                          <span className="company-name">{listing.job.company}</span>
                        </td>
                        <td>{listing.job.location}</td>
                        <td>
                          <span className={`stage ${listing.state === "open" ? "complete" : ""}`}>
                            {listing.state}
                          </span>
                        </td>
                        <td>{listing.job.source}</td>
                        <td>
                          <button
                            type="button"
                            className="icon-button"
                            title="View evidence"
                            aria-label={`Inspect ${listing.job.title}`}
                            onClick={() => setSelected(listing)}
                          >
                            <ArrowRight size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!snapshot.listings.length && (
                  <div className="empty-state">No discovered vacancies</div>
                )}
              </div>
              <div className="table-footer">
                <span>
                  {snapshot.listingCount ? offset + 1 : 0}-{offset + snapshot.listings.length} of{" "}
                  {snapshot.listingCount}
                </span>
                <div className="heading-actions">
                  <button
                    type="button"
                    className="icon-button"
                    title="Previous page"
                    aria-label="Previous vacancies"
                    disabled={!offset}
                    onClick={() => setOffset(Math.max(0, offset - 50))}
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    title="Next page"
                    aria-label="Next vacancies"
                    disabled={offset + 50 >= snapshot.listingCount}
                    onClick={() => setOffset(offset + 50)}
                  >
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </section>
          )}
          {tab === "sources" && (
            <section className="candidate-section">
              <div className="section-toolbar">
                <h2>Source health</h2>
                <button type="button" className="button-primary" onClick={() => setAdding(true)}>
                  <Plus size={15} />
                  Add source
                </button>
              </div>
              <div className="source-health-list">
                {snapshot.sources.map((source) => (
                  <article key={source.id}>
                    <div>
                      <strong>{source.company}</strong>
                      <p>
                        {source.connector} / {source.region} / {source.board}
                      </p>
                      <span className="stage">
                        {source.enabled ? words(source.health) : "Paused"}
                      </span>{" "}
                      <span className="muted">
                        {source.count} postings | {source.mode}
                      </span>
                      <small>
                        Last success: {date(source.lastSuccessAt)}
                        <br />
                        Next poll: {date(source.nextPollAt)}
                      </small>
                    </div>
                    <div className="fact-actions">
                      <button
                        type="button"
                        className="icon-button"
                        title={source.enabled ? "Pause source" : "Enable source"}
                        aria-label={`${source.enabled ? "Pause" : "Enable"} ${source.company}`}
                        disabled={busy}
                        onClick={() => {
                          void toggle(source);
                        }}
                      >
                        {source.enabled ? <Pause size={16} /> : <Play size={16} />}
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        title="Schedule source poll"
                        aria-label={`Poll ${source.company}`}
                        disabled={busy || !source.enabled}
                        onClick={() => {
                          void act(() => request(`/v1/discovery/sources/${source.id}/poll`, {}));
                        }}
                      >
                        <RefreshCw size={16} />
                      </button>
                      {source.health === "quality_warning" && (
                        <button
                          type="button"
                          className="button-secondary"
                          disabled={busy}
                          onClick={() => {
                            void act(() =>
                              request(`/v1/discovery/sources/${source.id}/poll`, {
                                acknowledgeQuality: true,
                              }),
                            );
                          }}
                        >
                          <Check size={15} />
                          Accept changed baseline
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              <h3>Recent polls</h3>
              <div className="source-run-list">
                {snapshot.runs.slice(0, 20).map((run) => (
                  <details key={run.id}>
                    <summary>
                      {date(run.completedAt)} | {words(run.health)} | {run.count} postings |{" "}
                      {run.durationMs} ms
                    </summary>
                    <ul>
                      {[...new Set(run.warnings)].map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </section>
          )}
          {tab === "history" && <HistoryPanel snapshot={snapshot} act={act} busy={busy} />}
          {tab === "identity" && (
            <section className="candidate-section">
              <h2>Requisition identity</h2>
              <form
                className="candidate-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void act(() =>
                    request("/v1/discovery/identities", {
                      from: data.get("from"),
                      to: data.get("to"),
                      reason: data.get("reason"),
                    }),
                  );
                }}
              >
                <label>
                  Source vacancy
                  <select name="from" required>
                    <option value="">Choose vacancy</option>
                    {snapshot.listings.map((l) => (
                      <option key={l.id} value={l.originalJobId}>
                        {l.job.company}: {l.job.title} ({l.job.postingId})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Canonical vacancy
                  <select name="to" required>
                    <option value="">Choose vacancy</option>
                    {snapshot.listings.map((l) => (
                      <option key={l.id} value={l.jobId}>
                        {l.job.company}: {l.job.title} ({l.job.postingId})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="wide">
                  Identity evidence
                  <textarea name="reason" required maxLength={2000} rows={3} />
                </label>
                <div className="form-actions wide">
                  <button className="button-primary" type="submit" disabled={busy}>
                    <GitMerge size={15} />
                    Confirm same requisition
                  </button>
                </div>
              </form>
              <div className="answer-list">
                {snapshot.resolutions.map((r) => (
                  <article key={r.id}>
                    <strong>{r.reason}</strong>
                    <p>{r.reversedAt ? "Split" : "Merged"}</p>
                    <small>
                      {r.from} to {r.to}
                    </small>
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={busy || Boolean(r.reversedAt)}
                      onClick={() => {
                        void act(() => request(`/v1/discovery/identities/${r.id}/split`, {}));
                      }}
                    >
                      <RotateCcw size={15} />
                      Split requisitions
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {adding && <SourceEditor demo={demo} act={act} busy={busy} close={() => setAdding(false)} />}
      {selected && <VacancyDetail listing={selected} close={() => setSelected(null)} />}
    </div>
  );
}
