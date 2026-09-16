import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizationText } from "../../packages/candidate/src/domain.js";
import type { Extraction } from "../../packages/contracts/src/candidate.js";
import { CandidateRepository } from "../../packages/persistence/src/candidate-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { identity, policy } from "../helpers/candidate-fixtures.js";

const extraction: Extraction = {
  format: "docx",
  parserVersion: "fixture",
  quality: "review_required",
  warnings: [],
  blocks: [
    { locator: "paragraph:1", kind: "paragraph", text: "Python engineer", url: null, bounds: null },
  ],
};
for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} candidate evidence`,
    () => {
      let db: Database;
      let repo: CandidateRepository;
      let dir: string;
      let now: number;
      let owner: string;
      beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "opencareers-candidate-"));
        db =
          engine === "sqlite"
            ? await openSqlite(join(dir, "candidate.sqlite"))
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        now = Date.parse("2026-09-16T10:00:00Z");
        owner = `candidate-${randomUUID()}`;
        repo = new CandidateRepository(db, owner, () => new Date(now));
        await repo.initialize();
      });
      afterEach(async () => {
        await db?.close();
        if (dir) await rm(dir, { recursive: true, force: true });
      });
      async function ready(requisition = "req") {
        const snapshot = await repo.snapshot();
        await repo.putJob({
          id: requisition,
          employerId: "synthetic-employer",
          requisitionId: requisition,
          title: "Software Engineer",
          company: "Synthetic Co",
          location: "Amsterdam",
          countryCode: "NL",
          url: `https://synthetic.example/${requisition}`,
          source: "fixture",
          synthetic: true,
          description: "Synthetic vacancy",
        });
        const app = await repo.createApplication(requisition, snapshot.candidateId);
        await db.query("UPDATE applications SET state='READY' WHERE owner_id=$1 AND id=$2", [
          owner,
          app.id,
        ]);
        return app;
      }
      async function authorized() {
        const fact = await repo.saveFact(identity);
        const profile = await repo.publishProfile((await repo.snapshot()).revision);
        const authorization = await repo.saveAuthorization(policy(profile.id));
        const app = await ready();
        const gate = () =>
          db.transaction((tx) =>
            repo.checkCommit(tx, {
              applicationId: app.id,
              authorizationId: authorization.id,
              profileVersionId: profile.id,
            }),
          );
        return { fact, profile, authorization, app, gate };
      }
      it("deduplicates sources, validates provenance and isolates owner data", async () => {
        const input = {
          name: "synthetic.docx",
          sha256: "a".repeat(64),
          bytes: 100,
          storageKey: "synthetic",
          extraction,
        };
        const sourceId = await repo.registerSource(input);
        expect(await repo.registerSource(input)).toBe(sourceId);
        const fact = await repo.saveFact({
          expectedRevision: 0,
          key: "skill.python",
          value: { kind: "skill", name: "Python", firstUsed: null },
          provenance: { kind: "source", sourceId, locator: "paragraph:1", quote: "Python" },
          expiresOn: null,
        });
        expect(fact.status).toBe("extracted");
        const reviewed = await repo.reviewFact(fact.id, 1, "verified");
        expect(reviewed.revision).toBe(2);
        expect(
          (await db.query("SELECT * FROM fact_versions WHERE owner_id=$1", [owner])).length,
        ).toBe(2);
        const other = new CandidateRepository(db, `other-${owner}`);
        await other.initialize();
        await expect(other.source(sourceId)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          other.saveFact({
            ...identity,
            provenance: { kind: "source", sourceId, locator: "paragraph:1", quote: "Python" },
          }),
        ).rejects.toMatchObject({ code: "CLAIM_UNSUPPORTED" });
        await expect(repo.reviewFact(fact.id, 1, "verified")).rejects.toMatchObject({
          code: "REVISION_STALE",
        });
      });
      it("invalidates uncommitted packets without modifying historical snapshots", async () => {
        const { fact, profile } = await authorized();
        const app = await ready("prepared");
        const historic = await ready("historic");
        await db.query("UPDATE applications SET state='CONFIRMED' WHERE owner_id=$1 AND id=$2", [
          owner,
          historic.id,
        ]);
        for (const [id, applicationId] of [
          ["prepared-packet", app.id],
          ["historic-packet", historic.id],
        ])
          await db.query(
            "INSERT INTO packets(id,owner_id,application_id,manifest,sha256,created_at) VALUES($1,$2,$3,'{}','synthetic',$4)",
            [id ?? null, owner, applicationId ?? null, new Date(now).toISOString()],
          );
        await repo.saveFact({
          ...identity,
          id: fact.id,
          expectedRevision: fact.revision,
          value: {
            ...identity.value,
            kind: "identity",
            fullName: "Alex Updated",
            email: "alex@synthetic.example",
            phone: "",
            links: [],
          },
        });
        const next = await repo.publishProfile((await repo.snapshot()).revision);
        expect(next.id).not.toBe(profile.id);
        expect(
          await db.query("SELECT packet_id FROM packet_validity WHERE owner_id=$1", [owner]),
        ).toEqual([{ packet_id: "prepared-packet" }]);
        expect(
          JSON.parse(
            String(
              (
                await db.query("SELECT data FROM profile_versions WHERE owner_id=$1 AND id=$2", [
                  owner,
                  profile.id,
                ])
              )[0]?.data,
            ),
          ).facts[0].value.fullName,
        ).toBe("Alex Example");
        expect(
          (await db.query("SELECT COUNT(*) AS count FROM packets WHERE owner_id=$1", [owner]))[0]
            ?.count,
        ).toBe(engine === "postgres" ? "2" : 2);
      });
      it("blocks new authority immediately after revocation, with readable exact export", async () => {
        const { authorization, gate } = await authorized();
        expect((await gate()).id).toBe(authorization.id);
        expect(authorizationText(authorization)).toContain("including the final action");
        expect(authorizationText(authorization)).toContain("no numeric answer approved");
        await repo.revokeAuthorization(authorization.id);
        await expect(gate()).rejects.toMatchObject({ code: "POLICY_REVOKED" });
        await repo.revokeAuthorization(authorization.id);
        const events = await db.query("SELECT * FROM audit_events WHERE owner_id=$1", [owner]);
        expect(JSON.stringify(events)).not.toContain("alex@synthetic.example");
        expect(events.filter((e) => e.action === "authorization.revoked")).toHaveLength(1);
      });
      it("rejects changed profile facts even before a replacement profile is published", async () => {
        const { fact, gate } = await authorized();
        await repo.reviewFact(fact.id, fact.revision, "conflicting");
        await expect(gate()).rejects.toMatchObject({ code: "PROFILE_STALE" });
      });
      it("isolates missing answers, reuses approved scoped answers and rechecks expiry", async () => {
        const { fact, authorization, profile, app, gate } = await authorized();
        const other = await ready("other");
        expect(
          await repo.resolveQuestion(app.id, "salary.numeric", "Gross annual salary in EUR"),
        ).toBeNull();
        await expect(gate()).rejects.toMatchObject({ code: "ANSWER_UNKNOWN" });
        expect(
          (
            await db.transaction((tx) =>
              repo.checkCommit(tx, {
                applicationId: other.id,
                authorizationId: authorization.id,
                profileVersionId: profile.id,
              }),
            )
          ).id,
        ).toBe(authorization.id);
        await repo.resolveQuestion(other.id, "salary.numeric", "Gross annual salary in EUR");
        const answer = await repo.saveAnswer({
          semanticKey: "salary.numeric",
          meaning: "Gross annual salary in EUR",
          answer: 65000,
          validFrom: "2026-09-16",
          validUntil: "2026-09-17",
          employerIds: [],
          countries: ["NL"],
          evidenceFactIds: [fact.id],
        });
        expect(
          (await repo.resolveQuestion(app.id, "salary.numeric", "Gross annual salary in EUR"))?.id,
        ).toBe(answer.id);
        expect((await repo.summary("demo")).counts.exceptions).toBe(0);
        await gate();
        now += 2 * 86400000;
        await expect(gate()).rejects.toMatchObject({ code: "ANSWER_UNKNOWN" });
        expect(
          await repo.resolveQuestion(other.id, "salary.numeric", "Net monthly salary in EUR"),
        ).toBeNull();
      });
      it("binds answers to reviewed fact revisions, not mutable fact identities", async () => {
        const { fact, app } = await authorized();
        await repo.saveAnswer({
          semanticKey: "name",
          meaning: "Full legal name",
          answer: "Alex Example",
          validFrom: "2026-09-16",
          validUntil: "2026-10-16",
          employerIds: [],
          countries: [],
          evidenceFactIds: [fact.id],
        });
        expect(await repo.resolveQuestion(app.id, "name", "Full legal name")).not.toBeNull();
        await repo.saveFact({ ...identity, id: fact.id, expectedRevision: fact.revision });
        expect(await repo.resolveQuestion(app.id, "name", "Full legal name")).toBeNull();
      });
      it("keeps current permission distinct from future sponsorship and unrelated jobs", async () => {
        const { fact, app, authorization, profile, gate } = await authorized();
        await repo.saveAnswer({
          semanticKey: "work.current",
          meaning: "Currently authorized to work in NL",
          answer: true,
          validFrom: "2026-09-16",
          validUntil: "2026-10-16",
          employerIds: [],
          countries: ["NL"],
          evidenceFactIds: [fact.id],
        });
        expect(
          await repo.resolveQuestion(app.id, "work.current", "Currently authorized to work in NL"),
        ).not.toBeNull();
        expect(
          await repo.resolveQuestion(
            app.id,
            "work.future",
            "Will require future employer sponsorship in NL",
          ),
        ).toBeNull();
        await expect(gate()).rejects.toMatchObject({ code: "ANSWER_UNKNOWN" });
        const unrelated = await ready("unrelated-sponsorship");
        await expect(
          db.transaction((tx) =>
            repo.checkCommit(tx, {
              applicationId: unrelated.id,
              authorizationId: authorization.id,
              profileVersionId: profile.id,
            }),
          ),
        ).resolves.toMatchObject({ id: authorization.id });
      });
      it("serializes revocation against a competing policy check and rejects subsequent checks", async () => {
        const { authorization, gate } = await authorized();
        const outcomes = await Promise.allSettled([
          gate(),
          repo.revokeAuthorization(authorization.id),
        ]);
        expect(outcomes[1]?.status).toBe("fulfilled");
        await expect(gate()).rejects.toMatchObject({ code: "POLICY_REVOKED" });
      });
      it("rejects scope drift, stale policy saves and expired grants", async () => {
        const { authorization, profile, gate } = await authorized();
        await expect(repo.saveAuthorization(policy(profile.id))).rejects.toMatchObject({
          code: "REVISION_STALE",
        });
        await repo.saveAuthorization({
          ...policy(profile.id),
          expectedRevision: authorization.revision,
          blockedEmployerIds: ["synthetic-employer"],
        });
        await expect(gate()).rejects.toMatchObject({ code: "POLICY_REVOKED" });
        now = Date.parse("2026-11-01T00:00:00Z");
        await expect(
          repo.saveAuthorization({ ...policy(profile.id), expectedRevision: 2 }),
        ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
      });
    },
  );
}
