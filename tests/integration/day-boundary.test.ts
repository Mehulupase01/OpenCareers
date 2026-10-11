import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { localDay, localDayStart } from "../../packages/domain/src/state.js";
import { CandidateRepository } from "../../packages/persistence/src/candidate-repository.js";
import {
  type Database,
  openPostgres,
  openSqlite,
} from "../../packages/persistence/src/database.js";
import { MatchingRepository } from "../../packages/persistence/src/matching-repository.js";
import { migrate } from "../../packages/persistence/src/migrations.js";
import { identity, policy } from "../helpers/candidate-fixtures.js";

const boundaries = [
  ["ordinary day", "2026-09-16T21:59:59.000Z", "2026-09-16T22:00:00.000Z", 24],
  ["spring short day", "2026-03-29T21:59:59.000Z", "2026-03-29T22:00:00.000Z", 23],
  ["autumn long day", "2026-10-25T22:59:59.000Z", "2026-10-25T23:00:00.000Z", 25],
] as const;
const transitions = [
  ["spring skipped hour", "2026-03-29T00:59:59.000Z", "2026-03-29T01:00:00.000Z"],
  ["autumn repeated hour", "2026-10-25T00:59:59.000Z", "2026-10-25T01:00:00.000Z"],
] as const;

for (const engine of ["sqlite", "postgres"] as const) {
  describe.skipIf(engine === "postgres" && !process.env.AUTOPILOT_TEST_DATABASE_URL)(
    `${engine} Amsterdam budget rollover`,
    () => {
      let db: Database;
      afterEach(async () => {
        await db?.close();
      });

      async function budgets(instant: string, identityExpiresOn: string | null = null) {
        db =
          engine === "sqlite"
            ? await openSqlite(":memory:")
            : await openPostgres(process.env.AUTOPILOT_TEST_DATABASE_URL as string);
        await migrate(db);
        const owner = `day-boundary-${randomUUID()}`;
        let now = Date.parse(instant);
        const clock = () => new Date(now);
        const candidate = new CandidateRepository(db, owner, clock);
        const matching = new MatchingRepository(db, owner, clock);
        await candidate.initialize();
        await candidate.saveFact({ ...identity, expiresOn: identityExpiresOn });
        const profile = await candidate.publishProfile((await candidate.snapshot()).revision);
        const authorization = await candidate.saveAuthorization({
          ...policy(profile.id),
          dailyLimit: 1,
          effectiveAt: new Date(now - 86400000).toISOString(),
          expiresAt: new Date(now + 7 * 86400000).toISOString(),
        });
        await matching.setFixtureRoute("synthetic/model:free", "synthetic-provider");
        const jobId = `synthetic-${randomUUID()}`;
        await candidate.putJob({
          id: jobId,
          employerId: "synthetic-employer",
          requisitionId: jobId,
          title: "Software Engineer",
          company: "Synthetic Co",
          location: "Amsterdam",
          countryCode: "NL",
          url: `https://synthetic.example/${jobId}`,
          source: "fixture",
          synthetic: true,
          description: "Synthetic counter fixture, not a dispatched application.",
        });
        const app = await candidate.createApplication(jobId, profile.candidateId);
        await db.query("UPDATE applications SET state='READY' WHERE owner_id=$1 AND id=$2", [
          owner,
          app.id,
        ]);
        const gate = () =>
          db.transaction((tx) =>
            new CandidateRepository(db, owner, clock).checkCommit(tx, {
              applicationId: app.id,
              authorizationId: authorization.id,
              profileVersionId: profile.id,
            }),
          );
        await gate();
        const reservation = await matching.reserve("synthetic/model:free", "synthetic-provider", 1);
        await matching.markSent(reservation.id, "a".repeat(64));
        await matching.finish(reservation.id, {
          status: "completed",
          responseHash: "b".repeat(64),
        });

        // Seed historical counter evidence only: no permit, final click or receipt is fabricated.
        const packetId = randomUUID();
        const intentId = randomUUID();
        await db.query(
          "INSERT INTO packets(id,owner_id,application_id,manifest,sha256,created_at) VALUES($1,$2,$3,$4,$5,$6)",
          [packetId, owner, app.id, '{"syntheticCounterFixture":true}', "c".repeat(64), instant],
        );
        await db.query(
          "INSERT INTO intents(id,owner_id,application_id,packet_id,authorization_id,snapshot,sha256,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [intentId, owner, app.id, packetId, authorization.id, "{}", "d".repeat(64), instant],
        );
        await db.query(
          "INSERT INTO attempts(id,owner_id,application_id,intent_id,fence,state,started_at,ended_at) VALUES($1,$2,$3,$4,1,'UNKNOWN',$5,$5)",
          [randomUUID(), owner, app.id, intentId, instant],
        );
        const timestamps = async () => ({
          attempts: await db.query(
            "SELECT started_at,ended_at FROM attempts WHERE owner_id=$1 ORDER BY id",
            [owner],
          ),
          inference: await db.query(
            "SELECT created_at,expires_at,completed_at FROM inference_reservations WHERE owner_id=$1 AND id=$2",
            [owner, reservation.id],
          ),
        });
        const baseline = await timestamps();
        return {
          owner,
          gate,
          timestamps,
          baseline,
          rewriteLegacyDay: () =>
            db.query("UPDATE inference_reservations SET day=$1 WHERE owner_id=$2 AND id=$3", [
              "2000-01-01",
              owner,
              reservation.id,
            ]),
          advance: (value: string) => {
            now = Date.parse(value);
          },
          matching: () => new MatchingRepository(db, owner, clock),
        };
      }

      it.each(boundaries)(
        "resets both limits after %s, not 24 UTC hours",
        async (_, before, after, hours) => {
          const fixture = await budgets(before);
          await expect(fixture.gate()).rejects.toMatchObject({ code: "RATE_LIMITED" });
          await expect(
            fixture.matching().reserve("synthetic/model:free", "synthetic-provider", 1),
          ).rejects.toMatchObject({ code: "MODEL_QUOTA_EXHAUSTED" });
          expect(
            (localDayStart(new Date(after)).getTime() - localDayStart(new Date(before)).getTime()) /
              3600000,
          ).toBe(hours);
          fixture.advance(after);
          await expect(fixture.gate()).resolves.toMatchObject({ dailyLimit: 1 });
          expect((await fixture.matching().snapshot(1)).budget).toMatchObject({
            used: 0,
            reserved: 0,
          });
          await expect(
            fixture.matching().reserve("synthetic/model:free", "synthetic-provider", 1),
          ).resolves.toMatchObject({ day: localDay(new Date(after)), state: "reserved" });
          expect(await fixture.timestamps()).toEqual(fixture.baseline);
        },
      );

      it.each(transitions)("does not reset either limit at the %s", async (_, before, after) => {
        const fixture = await budgets(before);
        fixture.advance(after);
        expect(localDay(new Date(before))).toBe(localDay(new Date(after)));
        await expect(fixture.gate()).rejects.toMatchObject({ code: "RATE_LIMITED" });
        expect((await fixture.matching().snapshot(1)).budget).toMatchObject({
          used: 1,
          reserved: 0,
        });
        await expect(
          fixture.matching().reserve("synthetic/model:free", "synthetic-provider", 1),
        ).rejects.toMatchObject({ code: "MODEL_QUOTA_EXHAUSTED" });
        expect(await fixture.timestamps()).toEqual(fixture.baseline);
      });

      it("derives quota from UTC evidence even when a legacy day label is wrong", async () => {
        const fixture = await budgets("2026-10-25T12:00:00.000Z");
        await fixture.rewriteLegacyDay();
        expect((await fixture.matching().snapshot(1)).budget).toMatchObject({
          day: "2026-10-25",
          used: 1,
          reserved: 0,
        });
        await expect(
          fixture.matching().reserve("synthetic/model:free", "synthetic-provider", 1),
        ).rejects.toMatchObject({ code: "MODEL_QUOTA_EXHAUSTED" });
        expect(await fixture.timestamps()).toEqual(fixture.baseline);
      });

      it.each(boundaries)(
        "uses the Amsterdam day for answer validity at %s",
        async (_, before, after) => {
          const fixture = await budgets(before);
          const owner = fixture.owner;
          let now = new Date(before);
          const candidate = new CandidateRepository(db, owner, () => now);
          const fact = (await candidate.snapshot()).facts.find(
            (item) => item.value.kind === "identity",
          );
          if (!fact) throw new Error("Missing synthetic identity.");
          const day = localDay(new Date(after));
          const answer = await candidate.saveAnswer({
            semanticKey: "terms",
            meaning: "Reviewed terms",
            answer: true,
            validFrom: day,
            validUntil: day,
            employerIds: ["synthetic-employer"],
            countries: ["NL"],
            evidenceFactIds: [fact.id],
          });
          const match = () =>
            candidate.matchingAnswer(db, "terms", "Reviewed terms", "synthetic-employer", "NL");
          expect(await match()).toBeNull();
          now = new Date(after);
          expect(now.toISOString().slice(0, 10)).not.toBe(day);
          expect(await match()).toMatchObject({ id: answer.id });
          now = new Date(new Date(after).getTime() + 26 * 3600000);
          expect(await match()).toBeNull();
          expect(await fixture.timestamps()).toEqual(fixture.baseline);
        },
      );

      it.each(boundaries)(
        "expires reviewed facts on the Amsterdam day at %s",
        async (_, before, after) => {
          const fixture = await budgets(before, localDay(new Date(before)));
          fixture.advance(after);
          await expect(fixture.gate()).rejects.toMatchObject({ code: "PROFILE_STALE" });
          const candidate = new CandidateRepository(db, fixture.owner, () => new Date(after));
          const snapshot = await candidate.snapshot();
          await expect(candidate.publishProfile(snapshot.revision)).rejects.toMatchObject({
            code: "CLAIM_UNSUPPORTED",
          });
          const fact = snapshot.facts.find((item) => item.value.kind === "identity");
          if (!fact) throw new Error("Missing synthetic identity.");
          await expect(
            candidate.saveAnswer({
              semanticKey: "terms",
              meaning: "Reviewed terms",
              answer: true,
              validFrom: localDay(new Date(after)),
              validUntil: localDay(new Date(after)),
              employerIds: [],
              countries: [],
              evidenceFactIds: [fact.id],
            }),
          ).rejects.toMatchObject({ code: "CLAIM_UNSUPPORTED" });
          expect(await fixture.timestamps()).toEqual(fixture.baseline);
        },
      );
    },
  );
}
