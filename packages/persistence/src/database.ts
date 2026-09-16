import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import pg from "pg";
import { DomainError } from "../../contracts/src/index.js";

export type SqlValue = string | number | null;
export type Row = Record<string, string | number | null>;
export interface SqlExecutor {
  readonly dialect: "sqlite" | "postgres";
  query<T extends Row = Row>(sql: string, values?: SqlValue[]): Promise<T[]>;
}
export interface Database extends SqlExecutor {
  transaction<T>(operation: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function sqliteVersionSafe(version: string): boolean {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  return (
    major === 3 &&
    (minor > 51 ||
      (minor === 51 && patch >= 3) ||
      (minor === 50 && patch >= 7) ||
      (minor === 44 && patch >= 6))
  );
}

export async function openSqlite(filename: string): Promise<Database> {
  if (filename !== ":memory:") await mkdir(dirname(filename), { recursive: true });
  const sqlite = new BetterSqlite3(filename);
  const version = (
    sqlite.prepare("SELECT sqlite_version() AS version").get() as { version: string }
  ).version;
  if (!sqliteVersionSafe(version)) {
    sqlite.close();
    throw new DomainError(
      "STORAGE_UNAVAILABLE",
      `SQLite ${version} lacks the required WAL-reset fix.`,
    );
  }
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  const journal = sqlite.pragma("journal_mode = WAL", { simple: true });
  sqlite.pragma("synchronous = FULL");
  if (
    (filename !== ":memory:" && journal !== "wal") ||
    sqlite.pragma("foreign_keys", { simple: true }) !== 1 ||
    sqlite.pragma("synchronous", { simple: true }) !== 2
  ) {
    sqlite.close();
    throw new DomainError("STORAGE_UNAVAILABLE", "SQLite durability configuration was rejected.");
  }
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  };
  const tx: SqlExecutor = {
    dialect: "sqlite",
    async query<T extends Row>(sql: string, values: SqlValue[] = []): Promise<T[]> {
      const statement = sqlite.prepare(sql);
      const bindings = Object.fromEntries(values.map((value, i) => [String(i + 1), value]));
      if (statement.reader) return statement.all(bindings) as T[];
      statement.run(bindings);
      return [];
    },
  };
  return {
    dialect: "sqlite",
    query: (sql, values) => exclusive(() => tx.query(sql, values)),
    transaction: (operation) =>
      exclusive(async () => {
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          const result = await operation(tx);
          sqlite.exec("COMMIT");
          return result;
        } catch (error) {
          if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
          throw error;
        }
      }),
    close: () =>
      exclusive(async () => {
        sqlite.close();
      }),
  };
}

export async function openPostgres(connectionString: string): Promise<Database> {
  const pool = new pg.Pool({
    connectionString,
    max: 8,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  pool.on("error", () => {
    /* Individual requests surface storage availability failures. */
  });
  const executor = (client: pg.Pool | pg.PoolClient): SqlExecutor => ({
    dialect: "postgres",
    async query<T extends Row>(sql: string, values: SqlValue[] = []): Promise<T[]> {
      return (await client.query(sql, values)).rows as T[];
    },
  });
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    await pool.end();
    throw error;
  }
  return {
    ...executor(pool),
    async transaction<T>(operation: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '5s'");
        const result = await operation(executor(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
