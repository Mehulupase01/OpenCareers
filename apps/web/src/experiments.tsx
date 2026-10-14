import { FileUp, RefreshCw, Save, Square, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { experimentInputSchema } from "../../../packages/contracts/src/experiment.js";
import type { ExperimentGenerationView } from "../../../packages/contracts/src/experiment-generation.js";
import type { LetterVariantRecipeItem } from "../../../packages/documents/src/letter-variants.js";
import type { ExperimentGenerationRepository } from "../../../packages/persistence/src/experiment-generation-repository.js";
import type { ExperimentRepository } from "../../../packages/persistence/src/experiment-repository.js";
import { request } from "./api.js";

type Catalog = Awaited<ReturnType<ExperimentRepository["list"]>>;
type Packets = Awaited<ReturnType<ExperimentRepository["packets"]>>;
type Assignments = Awaited<ReturnType<ExperimentRepository["assignments"]>>;
const endpoint = "/v1/outcomes/experiments";

export function ExperimentsWorkspace() {
  const [catalog, setCatalog] = useState<Catalog>([]);
  const [packets, setPackets] = useState<Packets>([]);
  const [assignments, setAssignments] = useState<Assignments>([]);
  const [definition, setDefinition] = useState<ReturnType<
    typeof experimentInputSchema.parse
  > | null>(null);
  const [selected, setSelected] = useState("");
  const [packetId, setPacketId] = useState("");
  const [variant, setVariant] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [definitionReviewed, setDefinitionReviewed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const assignmentId = useRef<string | null>(null);
  const fileGeneration = useRef(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const items = await request<Catalog>(endpoint);
        const ready = await request<Packets>(`${endpoint}/packets`);
        if (active) {
          setCatalog(items);
          setPackets(ready);
        }
      } catch {
        if (active) setError("Experiments unavailable.");
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
      fileGeneration.current++;
    };
  }, []);
  const action = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await run();
      setCatalog(await request<Catalog>(endpoint));
      setPackets(await request<Packets>(`${endpoint}/packets`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Experiment action failed.");
    } finally {
      setBusy(false);
    }
  };
  const importDefinition = async (file?: File) => {
    const generation = ++fileGeneration.current;
    setDefinition(null);
    setDefinitionReviewed(false);
    setError("");
    if (!file) return;
    try {
      if (file.size > 16384) throw new Error("oversized");
      const parsed = experimentInputSchema.parse(JSON.parse(await file.text()));
      if (generation === fileGeneration.current) setDefinition(parsed);
    } catch {
      if (generation === fileGeneration.current)
        setError("Invalid experiment definition (maximum 16 KiB).");
    }
  };
  const experiment = catalog.find((item) => item.id === selected);
  const packet = packets.find((item) => item.id === packetId);
  const canAssign =
    experiment?.state === "active" &&
    Date.parse(experiment.expiresAt) > Date.now() &&
    packet &&
    variant &&
    reviewed;
  const resetAssignment = () => {
    assignmentId.current = null;
    setReviewed(false);
  };
  return (
    <section className="calibration-workspace" aria-label="Controlled experiments">
      <h3>Controlled experiments</h3>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="candidate-form">
        <label>
          <span>
            <FileUp size={16} /> Experiment definition
          </span>
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(event) => void importDefinition(event.target.files?.[0])}
          />
        </label>
        {definition && (
          <>
            <dl className="outcome-exclusions">
              <div>
                <dt>Metric</dt>
                <dd>
                  {definition.metric} / {definition.observationDays} days
                </dd>
              </div>
              <div>
                <dt>Stop conditions</dt>
                <dd>
                  {definition.expiresAt} / {definition.maximumAssignments} assignments
                </dd>
              </div>
              <div>
                <dt>Variants</dt>
                <dd style={{ overflowWrap: "anywhere" }}>
                  {definition.variants
                    .map(
                      (v) =>
                        `${v.id} (${v.kind})${v.generationRecipe ? ` / ${JSON.stringify(v.generationRecipe)}` : " / manual"}`,
                    )
                    .join(", ")}
                </dd>
              </div>
            </dl>
            <label className="calibration-review">
              <input
                type="checkbox"
                checked={definitionReviewed}
                disabled={busy}
                onChange={(event) => setDefinitionReviewed(event.target.checked)}
              />
              Owner-approved variants and stop conditions
            </label>
            <div className="form-actions">
              <button
                className="button secondary"
                type="button"
                disabled={busy || !definitionReviewed}
                onClick={() =>
                  void action(async () => {
                    await request(endpoint, definition);
                    setSelected(definition.id);
                    setVariant("");
                    setAssignments([]);
                    resetAssignment();
                  })
                }
              >
                <Save size={16} /> Record experiment
              </button>
            </div>
          </>
        )}
        <label>
          Saved experiment
          <select
            aria-label="Saved experiment"
            disabled={busy}
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              setVariant("");
              setAssignments([]);
              resetAssignment();
            }}
          >
            <option value="">Select experiment</option>
            {catalog.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id.slice(0, 8)} / {item.metric} / {item.state}
              </option>
            ))}
          </select>
        </label>
        {experiment && (
          <dl className="outcome-exclusions">
            <div>
              <dt>Status</dt>
              <dd>
                {experiment.state} / revision {experiment.revision}
              </dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{experiment.expiresAt}</dd>
            </div>
            <div>
              <dt>Assignment limit</dt>
              <dd>{experiment.maximumAssignments}</dd>
            </div>
          </dl>
        )}
        <div className="form-actions">
          <button
            className="button secondary"
            type="button"
            disabled={busy || !selected}
            onClick={() =>
              void action(async () =>
                setAssignments(await request<Assignments>(`${endpoint}/${selected}/assignments`)),
              )
            }
          >
            <RefreshCw size={16} /> Open assignments
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={busy || experiment?.state !== "active"}
            onClick={() =>
              void action(() =>
                request(`${endpoint}/${selected}/stop`, { expectedRevision: experiment?.revision }),
              )
            }
          >
            <Square size={16} /> Stop experiment
          </button>
        </div>
        <GenerationWorkspace key={selected} experiment={experiment} />
        <h4 className="wide">Exact packet assignment</h4>
        <label>
          Ready reviewed packet
          <select
            aria-label="Ready reviewed packet"
            disabled={busy}
            value={packetId}
            onChange={(event) => {
              setPacketId(event.target.value);
              resetAssignment();
            }}
          >
            <option value="">Select packet</option>
            {packets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} / {item.applicationId}
              </option>
            ))}
          </select>
        </label>
        <label>
          Approved variant
          <select
            aria-label="Approved variant"
            disabled={busy || !experiment}
            value={variant}
            onChange={(event) => {
              setVariant(event.target.value);
              resetAssignment();
            }}
          >
            <option value="">Select variant</option>
            {experiment?.variants.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} / {item.kind}
              </option>
            ))}
          </select>
        </label>
        {packet && (
          <dl className="outcome-exclusions">
            <div>
              <dt>Packet SHA-256</dt>
              <dd className="calibration-id">{packet.sha256}</dd>
            </div>
          </dl>
        )}
        <label className="calibration-review">
          <input
            type="checkbox"
            disabled={busy || !packet || !variant}
            checked={reviewed}
            onChange={(event) => setReviewed(event.target.checked)}
          />
          Exact packet reviewed against the approved variant
        </label>
        <div className="form-actions">
          <button
            className="button secondary"
            type="button"
            disabled={busy || !canAssign}
            onClick={() =>
              void action(async () => {
                if (!packet) return;
                assignmentId.current ??= crypto.randomUUID();
                await request(`${endpoint}/assignments`, {
                  id: assignmentId.current,
                  experimentId: selected,
                  variantId: variant,
                  applicationId: packet.applicationId,
                  packetId: packet.id,
                  reviewedPacketSha256: packet.sha256,
                  reviewed: true,
                });
                setAssignments(await request<Assignments>(`${endpoint}/${selected}/assignments`));
              })
            }
          >
            <Save size={16} /> Assign reviewed packet
          </button>
        </div>
      </div>
      {selected && (
        <div className="table-scroll">
          <table className="outcome-table">
            <thead>
              <tr>
                <th>Application</th>
                <th>Variant</th>
                <th>Packet</th>
                <th>Assigned (UTC)</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((item) => (
                <tr key={item.id}>
                  <td>{item.applicationId}</td>
                  <td>{item.variantId}</td>
                  <td>{item.packetId}</td>
                  <td>{item.assignedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type EligibleApplications = Awaited<
  ReturnType<ExperimentGenerationRepository["eligibleApplications"]>
>;
const generationCellStyle = {
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  minWidth: 0,
  textAlign: "left",
} as const;

function GenerationWorkspace({ experiment }: { experiment: Catalog[number] | undefined }) {
  const [recipes, setRecipes] = useState<LetterVariantRecipeItem[]>([]);
  const [applications, setApplications] = useState<EligibleApplications>([]);
  const [generations, setGenerations] = useState<ExperimentGenerationView[]>([]);
  const [applicationId, setApplicationId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const requestId = useRef<string | null>(null);
  useEffect(() => {
    void refresh;
    let active = true;
    setBusy(true);
    setReviewed(false);
    void (async () => {
      try {
        const catalog = await request<LetterVariantRecipeItem[]>(`${endpoint}/generations/recipes`);
        const eligible = await request<EligibleApplications>(
          `${endpoint}/generations/applications`,
        );
        const results = experiment
          ? await request<ExperimentGenerationView[]>(`${endpoint}/${experiment.id}/generations`)
          : [];
        if (active) {
          setRecipes(catalog);
          setApplications(eligible);
          setGenerations(results);
          setError("");
        }
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : "Generation catalog unavailable.");
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [experiment, refresh]);
  const resetReview = () => {
    setReviewed(false);
    requestId.current = null;
  };
  const variants =
    experiment?.variants.filter((item) => item.kind === "wording" && item.generationRecipe) ?? [];
  const variant = variants.find((item) => item.id === variantId);
  const binding = variant?.generationRecipe;
  const recipe = recipes.find(
    (item) =>
      item.id === binding?.id && item.version === binding.version && item.sha256 === binding.sha256,
  );
  const application = applications.find((item) => item.applicationId === applicationId);
  const active = experiment?.state === "active" && Date.parse(experiment.expiresAt) > Date.now();
  const enqueue = async () => {
    if (!active || !application || !recipe || !reviewed || busy) return;
    setBusy(true);
    setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      const result = await request<ExperimentGenerationView>(`${endpoint}/generations`, {
        id: requestId.current,
        experimentId: experiment.id,
        variantId,
        applicationId,
        assessmentId: application.assessmentId,
        expectedApplicationRevision: application.revision,
        expectedExperimentRevision: experiment.revision,
        reviewed: true,
      });
      setGenerations((items) => [result, ...items.filter((item) => item.id !== result.id)]);
      resetReview();
      setRefresh((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Generation request failed.");
      setReviewed(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Approved letter generation"
      className="wide"
      style={{ minWidth: 0, display: "grid", gap: 12 }}
    >
      <h4>Approved letter generation</h4>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <details>
        <summary>Recipe catalog</summary>
        {recipes.map(({ id, version, sha256, label, instruction }) => (
          <div key={id} style={{ overflowWrap: "anywhere" }}>
            <h5>{label}</h5>
            <p>{instruction}</p>
            <code>{JSON.stringify({ generationRecipe: { id, version, sha256 } })}</code>
          </div>
        ))}
      </details>
      <label>
        Generation variant
        <select
          aria-label="Generation variant"
          value={variantId}
          disabled={busy || !active}
          onChange={(event) => {
            setVariantId(event.target.value);
            resetReview();
          }}
        >
          <option value="">Select recipe-backed variant</option>
          {variants.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id} / {item.generationRecipe?.id}
            </option>
          ))}
        </select>
      </label>
      {experiment && variants.length === 0 && <p role="status">Manual variants only</p>}
      {binding && (
        <dl className="outcome-exclusions">
          <div>
            <dt>Recipe</dt>
            <dd>
              {binding.id} / v{binding.version}
            </dd>
          </div>
          <div>
            <dt>Recipe SHA-256</dt>
            <dd className="calibration-id">{binding.sha256}</dd>
          </div>
          <div>
            <dt>Approval SHA-256</dt>
            <dd className="calibration-id">{variant?.approvalSha256}</dd>
          </div>
        </dl>
      )}
      {binding && !recipe && !busy && (
        <p role="alert">Approved recipe does not match the catalog.</p>
      )}
      <label>
        Eligible application
        <select
          aria-label="Eligible application"
          value={applicationId}
          disabled={busy || !active}
          onChange={(event) => {
            setApplicationId(event.target.value);
            resetReview();
          }}
        >
          <option value="">Select application</option>
          {applications.map((item) => (
            <option key={item.applicationId} value={item.applicationId}>
              {item.company} / {item.title} / {item.state}
            </option>
          ))}
        </select>
      </label>
      {application && (
        <p style={{ overflowWrap: "anywhere" }}>
          Assessment: {application.assessmentId} / application revision {application.revision}
        </p>
      )}
      {!busy && applications.length === 0 && <p role="status">No eligible applications</p>}
      <label className="calibration-review">
        <input
          type="checkbox"
          checked={reviewed}
          disabled={busy || !active || !recipe || !application}
          onChange={(event) => setReviewed(event.target.checked)}
        />
        Owner-approved wording, recipe and assessment reviewed for generation
      </label>
      <div className="form-actions">
        <button
          className="button secondary"
          type="button"
          disabled={busy || !active || !recipe || !application || !reviewed}
          onClick={() => void enqueue()}
        >
          <WandSparkles size={16} /> Enqueue letter variant
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() => {
            setReviewed(false);
            setRefresh((value) => value + 1);
          }}
        >
          <RefreshCw size={16} /> Refresh generations
        </button>
      </div>
      {experiment && !busy && generations.length === 0 && (
        <p role="status">No generation requests</p>
      )}
      {generations.length > 0 && (
        <div className="table-scroll">
          <table
            className="outcome-table"
            aria-label="Generation results"
            style={{ tableLayout: "fixed", minWidth: 760, overflowWrap: "anywhere" }}
          >
            <thead>
              <tr>
                <th>Application / variant</th>
                <th>State / failure</th>
                <th>Recipe</th>
                <th>Result / review</th>
                <th>Created (UTC)</th>
              </tr>
            </thead>
            <tbody>
              {generations.map((item) => (
                <tr key={item.id}>
                  <td style={generationCellStyle}>
                    {item.applicationId} / {item.variantId}
                    <br />
                    {item.id}
                  </td>
                  <td style={generationCellStyle}>
                    {item.state}
                    {item.failureCode && (
                      <>
                        <br />
                        {item.failureCode}
                      </>
                    )}
                  </td>
                  <td style={generationCellStyle}>
                    {item.recipe.id} / v{item.recipe.version}
                    <br />
                    <span className="calibration-id">{item.recipe.sha256}</span>
                  </td>
                  <td style={generationCellStyle}>
                    {item.packetId && (
                      <>
                        <span>{item.packetId}</span>
                        <br />
                        <a
                          href={`/v1/documents/${encodeURIComponent(item.packetId)}/artifacts/letter_pdf?preview=1`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Review letter PDF
                        </a>
                        {" / "}
                        <a
                          href={`/v1/documents/${encodeURIComponent(item.packetId)}/artifacts/cv_pdf?preview=1`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Review CV PDF
                        </a>
                        <br />
                      </>
                    )}
                    {item.packetSha256 && (
                      <span className="calibration-id">Packet: {item.packetSha256}</span>
                    )}
                    {item.critiqueSha256 && (
                      <>
                        <br />
                        <span className="calibration-id">Critique: {item.critiqueSha256}</span>
                      </>
                    )}
                    {item.repaired !== null && (
                      <>
                        <br />
                        Repaired: {item.repaired ? "yes" : "no"}
                      </>
                    )}
                  </td>
                  <td style={generationCellStyle}>{item.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
