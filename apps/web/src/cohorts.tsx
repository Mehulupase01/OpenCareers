import { GitCompareArrows, Plus, RefreshCw, Snowflake } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type CohortDimension,
  cohortDimensionSchema,
  cumulativeMilestoneSchema,
} from "../../../packages/contracts/src/cohort.js";
import type {
  compareFixedCohorts,
  fixedCohortReport,
} from "../../../packages/matching/src/cohort-report.js";
import type { CohortRepository } from "../../../packages/persistence/src/cohort-repository.js";
import { request } from "./api.js";

type Report = ReturnType<typeof fixedCohortReport>;
type Comparison = ReturnType<typeof compareFixedCohorts>;
type Catalog = Awaited<ReturnType<CohortRepository["list"]>>;
const endpoint = "/v1/outcomes/cohorts";
const dimensionLabel = (value: CohortDimension) =>
  value === "seniority"
    ? "Seniority signal"
    : value === "sponsorship"
      ? "Sponsorship signal"
      : value;
const groupLabel = (value: string) =>
  value === "explicitly_available"
    ? "Explicitly available"
    : value === "explicitly_unavailable"
      ? "Explicitly unavailable"
      : value;

export function CohortsWorkspace() {
  const [from, setFrom] = useState(new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
  const [through, setThrough] = useState(
    new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  );
  const [days, setDays] = useState(30);
  const [catalog, setCatalog] = useState<Catalog>([]);
  const [selected, setSelected] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [dimension, setDimension] = useState<CohortDimension>("source");
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const identity = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    void request<Catalog>(endpoint)
      .then((items) => {
        if (active) setCatalog(items);
      })
      .catch(() => {
        if (active) setError("Saved cohorts unavailable.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const clear = () => {
    identity.current = null;
    setComparison(null);
    setReport(null);
    setSelected("");
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setComparison(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cohort action failed.");
    } finally {
      setBusy(false);
    }
  };
  const open = (value: Report) => {
    setReport(value);
    setSelected(value.snapshotId);
    setLeft("");
    setRight("");
  };
  const groups = report?.groups.filter((group) => group.dimension === dimension) ?? [];
  const signalDimension = dimension === "seniority" || dimension === "sponsorship";
  return (
    <section className="calibration-workspace" aria-label="Fixed outcome cohorts">
      <h3>Fixed outcome cohorts</h3>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <form
        className="candidate-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            identity.current ??= crypto.randomUUID();
            open(
              await request<Report>(endpoint, {
                id: identity.current,
                from: `${from}T00:00:00.000Z`,
                through: `${through}T23:59:59.999Z`,
                observationDays: days,
              }),
            );
            setCatalog(await request<Catalog>(endpoint));
          });
        }}
      >
        <label>
          Fixed receipt from (UTC)
          <input
            type="date"
            required
            value={from}
            disabled={busy || loading}
            onChange={(event) => {
              setFrom(event.target.value);
              clear();
            }}
          />
        </label>
        <label>
          Fixed receipt through (UTC)
          <input
            type="date"
            required
            value={through}
            disabled={busy || loading}
            onChange={(event) => {
              setThrough(event.target.value);
              clear();
            }}
          />
        </label>
        <label>
          Fixed observation days
          <input
            type="number"
            required
            min={1}
            max={365}
            value={days}
            disabled={busy || loading}
            onChange={(event) => {
              setDays(Number(event.target.value));
              clear();
            }}
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="button" disabled={busy || loading}>
            <Snowflake size={16} /> Freeze cohort
          </button>
          <button
            type="button"
            className="button secondary"
            title="New cohort snapshot"
            aria-label="New cohort snapshot"
            disabled={busy || loading}
            onClick={clear}
          >
            <Plus size={16} />
          </button>
        </div>
      </form>
      <div className="candidate-form">
        <label>
          Saved cohort
          <select
            aria-label="Saved cohort"
            value={selected}
            disabled={busy || loading}
            onChange={(event) => {
              setSelected(event.target.value);
              setReport(null);
              setComparison(null);
            }}
          >
            <option value="">Select cohort</option>
            {catalog.map((item) => (
              <option key={item.id} value={item.id}>
                {item.window.asOf.slice(0, 10)} / {item.id.slice(0, 8)} / {item.denominator}{" "}
                applications
              </option>
            ))}
          </select>
        </label>
        <div className="form-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy || loading || !selected}
            onClick={() =>
              void run(async () => {
                open(await request<Report>(`${endpoint}/${selected}`));
              })
            }
          >
            <RefreshCw size={16} /> Open fixed cohort
          </button>
        </div>
      </div>
      {report && (
        <div className="outcome-report" role="status">
          <h4>
            {report.status === "measured"
              ? "Fixed horizon outcome fractions"
              : "Insufficient fixed-cohort data"}
          </h4>
          <p className="muted">
            {report.window.from} to {report.window.through} UTC / {report.window.observationDays}{" "}
            days / {report.denominator} eligible applications / minimum{" "}
            {report.window.minimumSample}
          </p>
          <p className="muted">Frozen as of {report.window.asOf}</p>
          {report.vacancySignalOrigins && (
            <p className="muted">
              Vacancy signals: {report.vacancySignalOrigins.intentClassified} classified /{" "}
              {report.vacancySignalOrigins.legacyUnavailable} legacy unavailable
            </p>
          )}
          <dl className="outcome-exclusions">
            {Object.entries(report.exclusions).map(([name, count]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          <div className="candidate-form">
            <label>
              Group dimension
              <select
                aria-label="Group dimension"
                value={dimension}
                disabled={busy}
                onChange={(event) => {
                  setDimension(event.target.value as CohortDimension);
                  setLeft("");
                  setRight("");
                  setComparison(null);
                }}
              >
                {cohortDimensionSchema.options.map((value) => (
                  <option key={value} value={value}>
                    {dimensionLabel(value)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Eligible</th>
                  <th>Result</th>
                  <th>Outcomes</th>
                  {signalDimension && <th>Signal provenance</th>}
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.value}>
                    <td>{groupLabel(group.value)}</td>
                    <td>{group.denominator}</td>
                    <td>
                      {group.status === "measured" ? "Recorded fractions" : "Insufficient data"}
                    </td>
                    <td>
                      {Object.entries(group.counts)
                        .filter(([, count]) => count > 0)
                        .map(
                          ([kind, count]) =>
                            `${kind}: ${count}/${group.denominator}${group.fractions ? ` (${group.fractions[kind]?.fraction.toFixed(3)})` : ""}`,
                        )
                        .join(", ")}
                    </td>
                    {signalDimension && (
                      <td>
                        {group.vacancySignalOrigins?.intentClassified ?? 0} classified /{" "}
                        {group.vacancySignalOrigins?.legacyUnavailable ?? group.denominator}{" "}
                        unavailable
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CumulativeOutcomes report={report} groups={groups} />
          <form
            className="candidate-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                setComparison(
                  await request<Comparison>(`${endpoint}/compare`, {
                    leftSnapshotId: report.snapshotId,
                    rightSnapshotId: report.snapshotId,
                    dimension,
                    leftValue: left,
                    rightValue: right,
                  }),
                );
              });
            }}
          >
            <label>
              Left cohort group
              <select
                aria-label="Left cohort group"
                value={left}
                required
                disabled={busy || groups.length < 2}
                onChange={(event) => {
                  setLeft(event.target.value);
                  setComparison(null);
                }}
              >
                <option value="">Select group</option>
                {groups.map((group) => (
                  <option key={group.value} value={group.value}>
                    {groupLabel(group.value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Right cohort group
              <select
                aria-label="Right cohort group"
                value={right}
                required
                disabled={busy || groups.length < 2}
                onChange={(event) => {
                  setRight(event.target.value);
                  setComparison(null);
                }}
              >
                <option value="">Select group</option>
                {groups
                  .filter((group) => group.value !== left)
                  .map((group) => (
                    <option key={group.value} value={group.value}>
                      {groupLabel(group.value)}
                    </option>
                  ))}
              </select>
            </label>
            <div className="form-actions">
              <button
                type="submit"
                className="button secondary"
                disabled={busy || !left || !right || left === right}
              >
                <GitCompareArrows size={16} /> Compare fixed groups
              </button>
            </div>
          </form>
          {comparison && (
            <div>
              <h4>
                {comparison.status === "measured"
                  ? "Descriptive group comparison"
                  : "Insufficient comparison data"}
              </h4>
              <p>
                {groupLabel(comparison.left.value)}: {comparison.left.denominator} /{" "}
                {groupLabel(comparison.right.value)}: {comparison.right.denominator}
              </p>
              {comparison.differences && (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Outcome</th>
                        <th>Left</th>
                        <th>Right</th>
                        <th>Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(comparison.differences).map(([kind, difference]) => (
                        <tr key={kind}>
                          <td>{kind}</td>
                          <td>
                            {comparison.left.counts[kind]}/{comparison.left.denominator}
                          </td>
                          <td>
                            {comparison.right.counts[kind]}/{comparison.right.denominator}
                          </td>
                          <td>{difference.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="muted">{comparison.limits.join(" ")}</p>
              <CumulativeComparison comparison={comparison} />
            </div>
          )}
          <p className="muted">{report.limits.join(" ")}</p>
        </div>
      )}
    </section>
  );
}

const milestoneLabels = { SCREENING: "Screening", INTERVIEW: "Interview", OFFER: "Offer" };
function cumulativeCell(summary: Report["cumulative"], kind: string) {
  const count = summary.counts?.[kind];
  if (count === undefined) return "Unavailable";
  const fraction = summary.fractions?.[kind]?.fraction;
  return `${count}/${summary.denominator}${fraction === undefined ? "" : ` (${fraction.toFixed(3)})`}`;
}
function CumulativeOutcomes({ report, groups }: { report: Report; groups: Report["groups"] }) {
  return (
    <section aria-label="Cumulative observed outcomes" className="cumulative-outcomes">
      <h4>Cumulative observed outcomes</h4>
      {report.cumulative.status === "unavailable" ? (
        <p>Unavailable for this legacy snapshot.</p>
      ) : (
        <>
          <p className="muted">
            {report.cumulative.withoutMilestoneEvidence} applications without positive milestone
            evidence
          </p>
          <div className="table-scroll">
            <table aria-label="Cumulative cohort counts">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Eligible</th>
                  {cumulativeMilestoneSchema.options.map((kind) => (
                    <th key={kind}>{milestoneLabels[kind]}</th>
                  ))}
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    id: "total",
                    value: "All eligible applications",
                    cumulative: report.cumulative,
                  },
                  ...groups.map((group) => ({
                    ...group,
                    id: `group:${group.dimension}:${group.value}`,
                  })),
                ].map((group) => (
                  <tr key={group.id}>
                    <td>{groupLabel(group.value)}</td>
                    <td>{group.cumulative.denominator}</td>
                    {cumulativeMilestoneSchema.options.map((kind) => (
                      <td key={kind}>{cumulativeCell(group.cumulative, kind)}</td>
                    ))}
                    <td>
                      {group.cumulative.status === "measured"
                        ? "Observed fractions"
                        : "Insufficient data"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
function CumulativeComparison({ comparison }: { comparison: Comparison }) {
  const result = comparison.cumulative;
  return (
    <section aria-label="Cumulative group comparison" className="cumulative-outcomes">
      <h4>Cumulative group comparison</h4>
      {result.status !== "measured" ? (
        <p>
          {result.status === "unavailable"
            ? "Legacy cumulative evidence unavailable."
            : "Insufficient cumulative comparison data."}
        </p>
      ) : (
        <div className="table-scroll">
          <table aria-label="Cumulative group differences">
            <thead>
              <tr>
                <th>Milestone</th>
                <th>{groupLabel(comparison.left.value)}</th>
                <th>{groupLabel(comparison.right.value)}</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {cumulativeMilestoneSchema.options.map((kind) => (
                <tr key={kind}>
                  <td>{milestoneLabels[kind]}</td>
                  <td>{cumulativeCell(result.left, kind)}</td>
                  <td>{cumulativeCell(result.right, kind)}</td>
                  <td>{result.differences?.[kind]?.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
