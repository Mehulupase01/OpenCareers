import { randomUUID } from "node:crypto";
import { DomainError } from "../../contracts/src/index.js";
import type { Database, SqlExecutor } from "./database.js";

export class OwnerScope {
  constructor(
    public readonly db: Database,
    public readonly ownerId: string,
    protected readonly clock: () => Date = () => new Date(),
  ) {}
  protected now() {
    return this.clock().toISOString();
  }
  protected async lockOwner(tx: SqlExecutor) {
    const rows = await tx.query(
      `SELECT id FROM owners WHERE id=$1${tx.dialect === "postgres" ? " FOR UPDATE" : ""}`,
      [this.ownerId],
    );
    if (!rows.length) throw new DomainError("NOT_FOUND", "Owner not initialized.");
  }
  protected async audit(
    tx: SqlExecutor,
    objectId: string,
    action: string,
    revision: number,
    payload: Record<string, string | number | null> = {},
    actor = "system",
  ) {
    const id = randomUUID();
    await tx.query(
      "INSERT INTO audit_events(id,owner_id,aggregate_id,action,revision,actor,correlation_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        id,
        this.ownerId,
        objectId,
        action,
        revision,
        actor,
        objectId,
        JSON.stringify(payload),
        this.now(),
      ],
    );
    await tx.query("INSERT INTO outbox(id,owner_id,available_at) VALUES($1,$2,$3)", [
      id,
      this.ownerId,
      this.now(),
    ]);
  }
}
