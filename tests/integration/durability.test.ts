import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openPostgres, openSqlite } from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { Repository } from "../../packages/persistence/src/repository.js";

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} crash durability`,
    () => {
      for (const mode of ["crash-prepare", "crash-submit"] as const) {
        it(`recovers after SIGKILL: ${mode}`, async () => {
          const dir = await mkdtemp(join(tmpdir(), "opencareers-crash-"));
          const location =
            engine === "postgres"
              ? (process.env.AUTOPILOT_TEST_DATABASE_URL as string)
              : join(dir, "crash.sqlite");
          const owner = `crash-${randomUUID()}`;
          let now = Date.parse("2026-09-16T10:00:00.000Z");
          const db =
            engine === "postgres" ? await openPostgres(location) : await openSqlite(location);
          const repository = new Repository(db, owner, () => new Date(now));
          await migrate(db);
          await repository.initialize();
          await repository.putJob({
            id: "job",
            employerId: "employer",
            requisitionId: "req",
            title: "Synthetic role",
            company: "Synthetic Co",
            location: "NL",
            url: "https://synthetic.example",
            description: "Fixture",
            source: "fixture",
            synthetic: true,
          });
          const app = await repository.createApplication("job", "candidate");
          if (mode === "crash-submit") {
            await repository.setControl({ submissionsPaused: false });
            await db.transaction(async (tx) => {
              const at = new Date(now).toISOString();
              await tx.query(
                "INSERT INTO authorizations(id,owner_id,revision,data,effective_at,expires_at) VALUES('policy',$1,1,'{}',$2,'2027-01-01T00:00:00.000Z')",
                [owner, at],
              );
              await tx.query(
                "INSERT INTO packets(id,owner_id,application_id,manifest,sha256,created_at) VALUES('packet',$1,$2,'{}','synthetic',$3)",
                [owner, app.id, at],
              );
              await tx.query(
                "INSERT INTO intents(id,owner_id,application_id,packet_id,authorization_id,snapshot,sha256,created_at) VALUES('intent',$1,$2,'packet','policy','{}','synthetic',$3)",
                [owner, app.id, at],
              );
              await tx.query(
                "INSERT INTO attempts(id,owner_id,application_id,intent_id,fence,state,started_at) VALUES('attempt',$1,$2,'intent',0,'INTENT_RECORDED',$3)",
                [owner, app.id, at],
              );
            });
          }
          await repository.enqueue({
            type: mode === "crash-submit" ? "submit" : "prepare",
            applicationId: app.id,
            domain: "synthetic.example",
            dedupeKey: mode,
          });
          const child = fork(
            fileURLToPath(new URL("../helpers/claim-worker.ts", import.meta.url)),
            [engine, location, owner, new Date(now).toISOString(), mode],
            { execArgv: ["--import", "tsx"], silent: true },
          );
          try {
            const [ready] = await once(child, "message");
            expect(ready.type).toBe("ready");
            const claimedPromise = once(child, "message");
            child.send("go");
            const [claimed] = await claimedPromise;
            expect(claimed.type).toBe("claimed");
            expect(claimed.task).not.toBeNull();
            const exited = once(child, "exit");
            child.kill("SIGKILL");
            await exited;
            now += 1001;
            const resumed = await repository.claim(
              "replacement-worker",
              mode === "crash-submit" ? ["submit"] : ["prepare"],
            );
            if (mode === "crash-submit") {
              expect(resumed).toBeNull();
              expect((await repository.summary("demo")).applications[0]?.state).toBe("UNKNOWN");
              expect(
                (await db.query("SELECT state FROM attempts WHERE owner_id=$1", [owner]))[0]?.state,
              ).toBe("UNKNOWN");
              expect((await repository.claim("reconciler", ["reconcile"]))?.applicationId).toBe(
                app.id,
              );
            } else {
              expect(resumed?.attempts).toBe(2);
              expect(resumed?.fence).toBeGreaterThan(claimed.task.fence);
            }
          } finally {
            if (child.exitCode === null && child.signalCode === null) {
              const exited = once(child, "exit");
              child.kill("SIGKILL");
              await exited;
            }
            await db.close();
            await rm(dir, { recursive: true, force: true });
          }
        }, 30000);
      }
    },
  );
}

for (const engine of ["sqlite", "postgres"] as const) {
  it.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `upgrades a populated ${engine} schema without changing application identity or audit history`,
    async () => {
      const schema = `migration_${randomUUID().replaceAll("-", "")}`;
      const admin =
        engine === "postgres"
          ? await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string)
          : undefined;
      let location = process.env.AUTOPILOT_TEST_DATABASE_URL ?? "";
      if (admin) {
        await admin.query(`CREATE SCHEMA ${schema}`);
        const url = new URL(location);
        url.searchParams.set("options", `-c search_path=${schema}`);
        location = url.toString();
      }
      const db =
        engine === "postgres" ? await openPostgres(location) : await openSqlite(":memory:");
      try {
        await migrate(db, 1);
        const repository = new Repository(db, "migration-owner");
        await repository.initialize();
        await repository.putJob({
          id: "job",
          employerId: "employer",
          requisitionId: "req",
          title: "Synthetic",
          company: "Synthetic",
          location: "NL",
          url: "https://synthetic.example",
          description: "Fixture",
          source: "fixture",
          synthetic: true,
        });
        await db.query(
          "INSERT INTO applications(id,owner_id,candidate_id,job_id,state,created_at,updated_at) VALUES('legacy-app','migration-owner','candidate','job','DISCOVERED','2026-09-16T00:00:00Z','2026-09-16T00:00:00Z')",
        );
        const app = (await repository.summary("demo")).applications[0];
        const before = await db.query("SELECT * FROM audit_events");
        await migrate(db);
        expect((await repository.summary("demo")).applications[0]).toEqual(app);
        expect(await db.query("SELECT * FROM audit_events")).toEqual(before);
        expect(
          (await db.query("SELECT MAX(version) AS version FROM schema_migrations"))[0]?.version,
        ).toBe(5);
      } finally {
        await db.close();
        if (admin) {
          await admin.query(`DROP SCHEMA ${schema} CASCADE`);
          await admin.close();
        }
      }
    },
  );
}

it.skipIf(!process.env.AUTOPILOT_TEST_DATABASE_URL)(
  "retains the original PostgreSQL connection-loss error when rollback also fails",
  async () => {
    const db = await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
    try {
      await expect(
        db.transaction(async (tx) => {
          await tx.query("SELECT pg_terminate_backend(pg_backend_pid())");
        }),
      ).rejects.toMatchObject({ code: "57P01" });
      expect((await db.query("SELECT 1 AS alive"))[0]?.alive).toBe(1);
    } finally {
      await db.close();
    }
  },
);

it("rolls back atomically on a real SQLite SQLITE_FULL write error", async () => {
  const db = await openSqlite(":memory:");
  try {
    await migrate(db);
    const pages = Number((await db.query("PRAGMA page_count"))[0]?.page_count);
    await db.query(`PRAGMA max_page_count = ${pages}`);
    await expect(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO owners(id,created_at) VALUES('disk-test','now')");
        await tx.query("INSERT INTO controls(owner_id,data) VALUES('disk-test',$1)", [
          "x".repeat(1000000),
        ]);
      }),
    ).rejects.toMatchObject({ code: "SQLITE_FULL" });
    expect(await db.query("SELECT * FROM owners WHERE id='disk-test'")).toEqual([]);
  } finally {
    await db.close();
  }
});
