import { FileUp, RefreshCw, Save, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { experimentInputSchema } from "../../../packages/contracts/src/experiment.js";
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
                <dd>{definition.variants.map((v) => `${v.id} (${v.kind})`).join(", ")}</dd>
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
        <div className="calibration-table-wrap">
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
