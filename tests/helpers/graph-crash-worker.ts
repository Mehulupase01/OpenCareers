import { openPostgres, openSqlite } from "../../packages/persistence/src/database.js";
import { GraphRepository, graphDigest } from "../../packages/persistence/src/graph-repository.js";
import { agentBinding, agentBudget, agentNode, agentOutput } from "./agent-fixtures.js";

const [engine, location, owner] = process.argv.slice(2);
if (!location || !owner) throw new Error("Missing synthetic worker arguments.");
const db = engine === "postgres" ? await openPostgres(location) : await openSqlite(location);
const graph = new GraphRepository(db, owner);
const runId = await graph.start(agentBinding(), agentBudget);
const slot = await graph.reserveNode(runId, "extractor");
await graph.completeNode(runId, slot.ordinal, agentOutput, { tokens: 10, requests: 1 });
await graph.checkpoint(agentBinding(), graphDigest(agentNode), agentOutput);
await graph.reserveNode(runId, "match_analyst");
process.send?.({ type: "checkpointed", runId });
setInterval(() => {}, 1000);
