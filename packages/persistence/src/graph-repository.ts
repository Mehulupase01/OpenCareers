import { createHash, randomUUID } from "node:crypto";
import {
  type GraphBinding,
  type GraphRunBudget,
  graphBindingSchema,
  graphBudgetSchema,
  type NodeKind,
  type NodeOutput,
  nodeKindSchema,
  nodeOutputSchema,
} from "../../contracts/src/agents.js";
import { DomainError } from "../../contracts/src/index.js";
import type { SqlExecutor } from "./database.js";
import { OwnerScope } from "./owner-scope.js";

export const graphDigest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class GraphRepository extends OwnerScope {
  private async pruneTerminal(tx: SqlExecutor) {
    const oldRuns =
      "SELECT id FROM graph_runs WHERE owner_id=$1 AND state <> 'running' AND id NOT IN (SELECT id FROM graph_runs WHERE owner_id=$1 AND state <> 'running' ORDER BY ended_at DESC,id DESC LIMIT 1000)";
    await tx.query(`DELETE FROM graph_nodes WHERE owner_id=$1 AND run_id IN (${oldRuns})`, [
      this.ownerId,
    ]);
    await tx.query(`DELETE FROM graph_runs WHERE owner_id=$1 AND id IN (${oldRuns})`, [
      this.ownerId,
    ]);
  }

  async start(bindingInput: GraphBinding, budgetInput: GraphRunBudget) {
    const binding = graphBindingSchema.parse(bindingInput);
    const budget = graphBudgetSchema.parse(budgetInput);
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const running = await tx.query(
        "SELECT id,budget,started_at FROM graph_runs WHERE owner_id=$1 AND state='running' ORDER BY started_at LIMIT 100",
        [this.ownerId],
      );
      for (const run of running) {
        const caps = graphBudgetSchema.parse(JSON.parse(String(run.budget)));
        const elapsed = this.clock().getTime() - Date.parse(String(run.started_at));
        if (elapsed < 0 || elapsed >= caps.wallTimeMs) {
          await tx.query(
            "UPDATE graph_runs SET state='failed',ended_at=$1 WHERE owner_id=$2 AND id=$3 AND state='running'",
            [this.now(), this.ownerId, String(run.id)],
          );
          await this.audit(tx, String(run.id), "graph.expired", 1);
        }
      }
      const count = (
        await tx.query(
          "SELECT COUNT(*) AS count FROM graph_runs WHERE owner_id=$1 AND state='running'",
          [this.ownerId],
        )
      )[0];
      if (Number(count?.count) >= 6)
        throw new DomainError("MODEL_QUOTA_EXHAUSTED", "Active preparation run limit reached.");
      await this.pruneTerminal(tx);
      await tx.query(
        "INSERT INTO graph_runs(owner_id,id,binding,budget,state,started_at) VALUES($1,$2,$3,$4,'running',$5)",
        [this.ownerId, id, JSON.stringify(binding), JSON.stringify(budget), this.now()],
      );
      await this.audit(tx, id, "graph.started", 1, { inputSha256: binding.inputSha256 });
    });
    return id;
  }
  async reserveNode(runId: string, kindInput: NodeKind, cached = false) {
    const kind = nodeKindSchema.parse(kindInput);
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const run = (
        await tx.query("SELECT * FROM graph_runs WHERE owner_id=$1 AND id=$2", [
          this.ownerId,
          runId,
        ])
      )[0];
      if (run?.state !== "running")
        throw new DomainError("REVISION_STALE", "Graph run is not active.");
      const budget = graphBudgetSchema.parse(JSON.parse(String(run.budget)));
      const elapsed = this.clock().getTime() - Date.parse(String(run.started_at));
      const tokenCap = cached ? 0 : budget.nodeTokens;
      const requestCap = cached ? 0 : budget.nodeRequests;
      const ordinal = Number(run.steps) + 1;
      if (
        elapsed < 0 ||
        elapsed >= budget.wallTimeMs ||
        ordinal > budget.steps ||
        Number(run.tokens) + tokenCap > budget.tokens ||
        Number(run.requests) + requestCap > budget.requests
      )
        throw new DomainError("MODEL_QUOTA_EXHAUSTED", "Graph preparation budget exhausted.");
      if (
        (
          await tx.query(
            "SELECT ordinal FROM graph_nodes WHERE owner_id=$1 AND run_id=$2 AND (kind=$3 OR state='running')",
            [this.ownerId, runId, kind],
          )
        ).length
      )
        throw new DomainError(
          "REVISION_STALE",
          "Graph node is repeated or another node is active.",
        );
      await tx.query(
        "INSERT INTO graph_nodes(owner_id,run_id,ordinal,kind,state,token_cap,request_cap) VALUES($1,$2,$3,$4,'running',$5,$6)",
        [this.ownerId, runId, ordinal, kind, tokenCap, requestCap],
      );
      await tx.query(
        "UPDATE graph_runs SET steps=$1,tokens=tokens+$2,requests=requests+$3 WHERE owner_id=$4 AND id=$5",
        [ordinal, tokenCap, requestCap, this.ownerId, runId],
      );
      return { ordinal, tokenCap, requestCap };
    });
  }
  async completeNode(
    runId: string,
    ordinal: number,
    outputInput: NodeOutput,
    usage: { tokens: number; requests: number },
  ) {
    const output = nodeOutputSchema.parse(outputInput);
    if (
      !Number.isInteger(usage.tokens) ||
      usage.tokens < 0 ||
      !Number.isInteger(usage.requests) ||
      usage.requests < 0
    )
      throw new DomainError("CONFIG_INVALID", "Invalid graph usage.");
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const node = (
        await tx.query(
          "SELECT n.*,r.state AS run_state,r.budget,r.started_at FROM graph_nodes n JOIN graph_runs r ON r.owner_id=n.owner_id AND r.id=n.run_id WHERE n.owner_id=$1 AND n.run_id=$2 AND n.ordinal=$3",
          [this.ownerId, runId, ordinal],
        )
      )[0];
      if (node?.state !== "running" || node.run_state !== "running" || node.kind !== output.kind)
        throw new DomainError("REVISION_STALE", "Graph node changed before completion.");
      const budget = graphBudgetSchema.parse(JSON.parse(String(node.budget)));
      const elapsed = this.clock().getTime() - Date.parse(String(node.started_at));
      if (
        elapsed < 0 ||
        elapsed >= budget.wallTimeMs ||
        usage.tokens > Number(node.token_cap) ||
        usage.requests > Number(node.request_cap)
      )
        throw new DomainError("MODEL_QUOTA_EXHAUSTED", "Graph node exceeded its declared budget.");
      await tx.query(
        "UPDATE graph_nodes SET state='completed',output_sha256=$1 WHERE owner_id=$2 AND run_id=$3 AND ordinal=$4",
        [graphDigest(output), this.ownerId, runId, ordinal],
      );
      await tx.query(
        "UPDATE graph_runs SET tokens=tokens-$1+$2,requests=requests-$3+$4 WHERE owner_id=$5 AND id=$6",
        [
          Number(node.token_cap),
          usage.tokens,
          Number(node.request_cap),
          usage.requests,
          this.ownerId,
          runId,
        ],
      );
    });
  }
  async finish(runId: string, state: "completed" | "failed") {
    if (!["completed", "failed"].includes(state))
      throw new DomainError("CONFIG_INVALID", "Invalid graph final state.");
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      if (state === "completed") {
        const run = (
          await tx.query(
            "SELECT steps,budget,started_at FROM graph_runs WHERE owner_id=$1 AND id=$2",
            [this.ownerId, runId],
          )
        )[0];
        if (!run || Number(run.steps) < 1)
          throw new DomainError("REVISION_STALE", "Graph has no completed preparation.");
        const elapsed = this.clock().getTime() - Date.parse(String(run.started_at));
        const budget = graphBudgetSchema.parse(JSON.parse(String(run.budget)));
        if (elapsed < 0 || elapsed >= budget.wallTimeMs)
          throw new DomainError(
            "MODEL_QUOTA_EXHAUSTED",
            "Graph time budget exhausted before finalization.",
          );
      }
      if (
        state === "completed" &&
        (
          await tx.query(
            "SELECT ordinal FROM graph_nodes WHERE owner_id=$1 AND run_id=$2 AND state <> 'completed'",
            [this.ownerId, runId],
          )
        ).length
      )
        throw new DomainError("REVISION_STALE", "Graph has unfinished nodes.");
      const updated = await tx.query(
        "UPDATE graph_runs SET state=$1,ended_at=$2 WHERE owner_id=$3 AND id=$4 AND state='running' RETURNING id",
        [state, this.now(), this.ownerId, runId],
      );
      if (!updated.length) throw new DomainError("REVISION_STALE", "Graph run is stale.");
      await this.audit(tx, runId, `graph.${state}`, 1);
      await this.pruneTerminal(tx);
    });
  }
  async checkpoint(bindingInput: GraphBinding, inputHash: string, outputInput: NodeOutput) {
    const binding = graphBindingSchema.parse(bindingInput);
    const output = nodeOutputSchema.parse(outputInput);
    if (!/^[a-f0-9]{64}$/.test(inputHash))
      throw new DomainError("CONFIG_INVALID", "Invalid graph input hash.");
    const key = graphDigest({ binding, inputHash, kind: output.kind });
    const content = JSON.stringify(output);
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await tx.query(
        "INSERT INTO graph_checkpoints(owner_id,cache_key,kind,binding,output,sha256,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_id,cache_key) DO UPDATE SET output=excluded.output,sha256=excluded.sha256,created_at=excluded.created_at",
        [
          this.ownerId,
          key,
          output.kind,
          JSON.stringify(binding),
          content,
          graphDigest(output),
          this.now(),
        ],
      );
      await tx.query(
        "DELETE FROM graph_checkpoints WHERE owner_id=$1 AND cache_key NOT IN (SELECT cache_key FROM graph_checkpoints WHERE owner_id=$1 ORDER BY created_at DESC,cache_key DESC LIMIT 1000)",
        [this.ownerId],
      );
    });
  }
  async cached(
    bindingInput: GraphBinding,
    inputHash: string,
    kindInput: NodeKind,
  ): Promise<NodeOutput | null> {
    const binding = graphBindingSchema.parse(bindingInput);
    const kind = nodeKindSchema.parse(kindInput);
    if (!/^[a-f0-9]{64}$/.test(inputHash))
      throw new DomainError("CONFIG_INVALID", "Invalid graph input hash.");
    const key = graphDigest({ binding, inputHash, kind });
    const row = (
      await this.db.query("SELECT * FROM graph_checkpoints WHERE owner_id=$1 AND cache_key=$2", [
        this.ownerId,
        key,
      ])
    )[0];
    if (!row) return null;
    const output = nodeOutputSchema.parse(JSON.parse(String(row.output)));
    if (
      row.binding !== JSON.stringify(binding) ||
      output.kind !== kind ||
      graphDigest(output) !== row.sha256
    )
      throw new DomainError("STORAGE_UNAVAILABLE", "Pure graph checkpoint integrity failed.");
    return output;
  }
}
