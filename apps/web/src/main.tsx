import {
  Activity,
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  Circle,
  CircleAlert,
  ClipboardList,
  Command,
  Database,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  UserRound,
  Workflow,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { authorizationStatus } from "../../../packages/candidate/src/domain.js";
import type { CandidateSnapshot } from "../../../packages/contracts/src/candidate.js";
import type { OperationsSummary } from "../../../packages/contracts/src/index.js";
import { request } from "./api.js";
import { CandidateWorkspace } from "./candidate.js";
import "./styles.css";

type View = "applications" | "queue" | "workers" | "settings" | "candidate";

function App() {
  const [summary, setSummary] = useState<OperationsSummary | null>(null);
  const [candidate, setCandidate] = useState<CandidateSnapshot | null>(null);
  const [view, setView] = useState<View>("applications");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState(false);
  const [token, setToken] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const connected = Boolean(summary);

  useEffect(() => {
    if (selected) dialog.current?.showModal();
  }, [selected]);

  const refresh = useCallback(async () => {
    try {
      setSummary(await request<OperationsSummary>("/v1/operations/summary"));
      setCandidate(await request<CandidateSnapshot>("/v1/candidate"));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    const start = async () => {
      try {
        const health = await request<{ profile: string }>("/health/live");
        if (!active) return;
        if (health.profile === "demo") await request("/v1/session", {});
        else {
          setLogin(true);
          return;
        }
        await refresh();
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Connection failed.");
      }
    };
    void start();
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!connected || login) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [connected, login, refresh]);

  const command = async (path: string, body: unknown = {}) => {
    setBusy(true);
    try {
      await request(path, body);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  };
  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await request("/v1/session", { token });
      setToken("");
      setLogin(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<View, string> = {
    applications: "Applications",
    queue: "Work queue",
    workers: "Workers",
    settings: "Controls",
    candidate: "Candidate",
  };
  const navigation = [
    { id: "applications" as const, label: "Applications", icon: BriefcaseBusiness },
    { id: "candidate" as const, label: "Candidate", icon: UserRound },
    { id: "queue" as const, label: "Work queue", icon: Workflow },
    { id: "workers" as const, label: "Workers", icon: Activity },
    { id: "settings" as const, label: "Controls", icon: Settings2 },
  ];
  const jobs =
    summary?.jobs.filter((job) =>
      `${job.title} ${job.company} ${job.location}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const selectedJob = summary?.jobs.find((job) => job.id === selected);

  return (
    <div className="workspace">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="OpenCareers home">
          <span className="brand-mark">
            <Command size={23} />
          </span>
          <span>
            OpenCareers<span className="brand-sub">CAREER OPERATIONS</span>
          </span>
        </a>
        <div className="workspace-label">
          <Circle size={8} fill="currentColor" />{" "}
          {summary?.profile === "demo" ? "Synthetic workspace" : "Private workspace"}
        </div>
        <nav aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              aria-current={view === id ? "page" : undefined}
              onClick={() => setView(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === "queue" && Boolean(summary?.counts.pendingTasks) && (
                <span className="nav-count">{summary?.counts.pendingTasks}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={17} />
          <div>
            Submission policy
            <strong>{authorizationStatus(candidate?.authorization ?? null, new Date())}</strong>
          </div>
          <span className="small-dot" />
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{titles[view]}</strong>
          </div>
          <div className="topbar-status">
            <span className={`status-dot ${summary?.control.stopped ? "stopped" : ""}`} />
            {summary
              ? summary.control.stopped
                ? "Processing stopped"
                : "Connected"
              : "Connecting"}
            <span className="version">v{summary?.version ?? "0.1.0"}</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">OPERATIONS</p>
              <h1>{titles[view]}</h1>
            </div>
            <div className="heading-actions">
              <button
                className="icon-button"
                type="button"
                onClick={() => {
                  void refresh();
                }}
                aria-label="Refresh"
                title="Refresh"
                disabled={busy}
              >
                <RefreshCw size={17} />
              </button>
              {summary && (
                <button
                  type="button"
                  className={summary.control.stopped ? "button-primary" : "button-stop"}
                  disabled={busy}
                  onClick={() => {
                    void command(
                      summary.control.stopped ? "/v1/control/resume" : "/v1/control/stop",
                    );
                  }}
                >
                  {summary.control.stopped ? <Play size={15} /> : <Square size={13} />}{" "}
                  {summary.control.stopped ? "Resume" : "Stop processing"}
                </button>
              )}
            </div>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <CircleAlert size={18} />
              {error}
              <button
                type="button"
                onClick={() => {
                  void refresh();
                }}
              >
                Retry
              </button>
            </div>
          )}
          {login && (
            <form
              className="login-form"
              onSubmit={(event) => {
                void signIn(event);
              }}
            >
              <label htmlFor="token">Owner token</label>
              <input
                id="token"
                type="password"
                autoComplete="current-password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                required
              />
              <button type="submit" className="button-primary" disabled={busy}>
                Sign in <ArrowRight size={16} />
              </button>
            </form>
          )}
          {!summary && !login && !error && (
            <div className="loading" role="status">
              <LoaderCircle className="spin" size={22} /> Connecting to workspace
            </div>
          )}
          {summary && (
            <>
              {summary.profile === "demo" && (
                <div className="demo-notice">
                  <Database size={15} />
                  <strong>Synthetic data</strong>
                  <span>No real applications submitted</span>
                </div>
              )}
              {view !== "candidate" && (
                <section className="metrics" aria-label="Application counts">
                  <div className="metric">
                    <span>Confirmed</span>
                    <strong>
                      {summary.counts.confirmed}
                      <CheckCircle2 size={20} />
                    </strong>
                    <small>Receipt verified</small>
                  </div>
                  <div className="metric">
                    <span>Prepared</span>
                    <strong>
                      {summary.counts.prepared}
                      <ClipboardList size={20} />
                    </strong>
                    <small>Documents ready</small>
                  </div>
                  <div className="metric">
                    <span>Uncertain</span>
                    <strong>
                      {summary.counts.unknown}
                      <CircleAlert size={20} />
                    </strong>
                    <small>Awaiting reconciliation</small>
                  </div>
                  <div className="metric">
                    <span>Needs attention</span>
                    <strong>
                      {summary.counts.exceptions}
                      <Pause size={20} />
                    </strong>
                    <small>Open exceptions</small>
                  </div>
                </section>
              )}
              {view === "candidate" && candidate && (
                <CandidateWorkspace snapshot={candidate} refresh={refresh} />
              )}
              {view === "applications" && (
                <section className="data-section">
                  <div className="section-toolbar">
                    <div className="section-title">
                      Vacancies <span>{summary.counts.jobs}</span>
                    </div>
                    <label className="search">
                      <Search size={16} />
                      <input
                        type="search"
                        aria-label="Search vacancies"
                        placeholder="Search vacancies"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="table-scroll">
                    <table className="vacancy-table">
                      <thead>
                        <tr>
                          <th>Role / Company</th>
                          <th>Location</th>
                          <th>Stage</th>
                          <th>Source</th>
                          <th>
                            <span className="sr-only">Details</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {jobs.map((job) => {
                          const app = summary.applications.find((item) => item.jobId === job.id);
                          return (
                            <tr key={job.id}>
                              <td>
                                <button
                                  type="button"
                                  className="row-link"
                                  onClick={() => setSelected(job.id)}
                                >
                                  {job.title}
                                </button>
                                <span className="company-name">{job.company}</span>
                              </td>
                              <td>{job.location}</td>
                              <td>
                                <span className="stage">
                                  <Circle size={7} fill="currentColor" />
                                  {(app?.state ?? "DISCOVERED").replaceAll("_", " ").toLowerCase()}
                                </span>
                              </td>
                              <td>
                                <span className="muted">{job.source}</span>
                              </td>
                              <td>
                                <button
                                  className="icon-button"
                                  type="button"
                                  aria-label={`View ${job.title}`}
                                  title="View vacancy"
                                  onClick={() => setSelected(job.id)}
                                >
                                  <ArrowRight size={16} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {jobs.length === 0 && (
                      <div className="empty-state">
                        <Search size={24} />
                        <strong>No matching vacancies</strong>
                      </div>
                    )}
                  </div>
                  <div className="table-footer">
                    <span>
                      {jobs.length} of {summary.counts.jobs} vacancies
                    </span>
                    <span>Netherlands</span>
                  </div>
                </section>
              )}
              {view === "queue" && (
                <section className="data-section">
                  <div className="section-toolbar">
                    <div className="section-title">
                      Tasks <span>{summary.tasks.length}</span>
                    </div>
                    {summary.profile === "demo" && (
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={busy}
                        onClick={() => {
                          void command("/v1/demo/probe");
                        }}
                      >
                        <Play size={14} />
                        Run queue check
                      </button>
                    )}
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Task</th>
                          <th>State</th>
                          <th>Attempts</th>
                          <th>Worker</th>
                          <th>Next run</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.tasks.map((task) => (
                          <tr key={task.id}>
                            <td>
                              <strong>{task.type.replaceAll("_", " ")}</strong>
                              <span className="company-name">{task.id.slice(0, 8)}</span>
                            </td>
                            <td>
                              <span
                                className={`stage ${task.state === "completed" ? "complete" : ""}`}
                              >
                                {task.state}
                              </span>
                            </td>
                            <td>
                              {task.attempts} / {task.maxAttempts}
                            </td>
                            <td>{task.leaseOwner ?? "Unassigned"}</td>
                            <td>{new Date(task.runAfter).toLocaleTimeString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {view === "workers" && (
                <section className="data-section">
                  <div className="section-toolbar">
                    <div className="section-title">
                      Runtime <span>{summary.workers.length}</span>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Worker</th>
                          <th>Role</th>
                          <th>Health</th>
                          <th>Last heartbeat</th>
                          <th>Version</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.workers.map((worker) => (
                          <tr key={worker.id}>
                            <td>
                              <strong>{worker.id}</strong>
                            </td>
                            <td>{worker.kind}</td>
                            <td>
                              <span className="stage">
                                {Date.now() - Date.parse(worker.lastSeenAt) < 15000
                                  ? "Online"
                                  : "Stale"}
                              </span>
                            </td>
                            <td>{new Date(worker.lastSeenAt).toLocaleTimeString()}</td>
                            <td>{worker.version}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {view === "settings" && (
                <section className="controls-section">
                  <h2>Processing</h2>
                  {(["discovery", "preparation", "submissions"] as const).map((stage) => (
                    <div className="control-row" key={stage}>
                      <div>
                        <strong>
                          {stage === "submissions"
                            ? "New submissions"
                            : stage.charAt(0).toUpperCase() + stage.slice(1)}
                        </strong>
                        <span>
                          {stage === "submissions"
                            ? "Submission engine unavailable"
                            : summary.control[`${stage}Paused`]
                              ? "Paused"
                              : "Enabled"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="switch"
                        role="switch"
                        aria-label={stage}
                        aria-checked={!summary.control[`${stage}Paused`]}
                        disabled={busy || stage === "submissions"}
                        onClick={() => {
                          void command("/v1/control/pause", {
                            stage,
                            paused: !summary.control[`${stage}Paused`],
                          });
                        }}
                      >
                        <span />
                      </button>
                    </div>
                  ))}
                  <h2>Environment</h2>
                  <dl className="environment">
                    <div>
                      <dt>Profile</dt>
                      <dd>{summary.profile}</dd>
                    </div>
                    <div>
                      <dt>Database</dt>
                      <dd>{summary.profile === "server" ? "PostgreSQL" : "SQLite / WAL"}</dd>
                    </div>
                    <div>
                      <dt>Inference</dt>
                      <dd>Not configured</dd>
                    </div>
                    <div>
                      <dt>Live adapters</dt>
                      <dd>None verified</dd>
                    </div>
                  </dl>
                </section>
              )}
              <footer className="page-footer">
                <ShieldCheck size={14} /> Owner workspace{" "}
                <span>Updated {new Date(summary.asOf).toLocaleTimeString()}</span>
              </footer>
            </>
          )}
        </main>
      </div>
      {selectedJob && (
        <dialog
          ref={dialog}
          onClose={() => setSelected(null)}
          aria-modal="true"
          aria-labelledby="job-title"
          className="job-dialog"
        >
          <div className="section-toolbar">
            <span className="eyebrow">VACANCY</span>
            <button
              type="button"
              className="button-secondary"
              onClick={() => dialog.current?.close()}
            >
              Close
            </button>
          </div>
          <h2 id="job-title">{selectedJob.title}</h2>
          <p>
            {selectedJob.company} / {selectedJob.location}
          </p>
          <p>{selectedJob.description}</p>
          <dl className="environment">
            <div>
              <dt>Requisition</dt>
              <dd>{selectedJob.requisitionId}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{selectedJob.source}</dd>
            </div>
          </dl>
        </dialog>
      )}
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
