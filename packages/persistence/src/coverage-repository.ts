import type {
  CoverageLevel,
  PortalCoverageReport,
  PortalCoverageRow,
} from "../../contracts/src/coverage.js";
import { sourceInputSchema } from "../../contracts/src/discovery.js";
import { assessmentSchema, type MatchAssessment } from "../../contracts/src/matching.js";
import { Repository } from "./repository.js";

type Family = PortalCoverageRow["family"];
type Outcome = MatchAssessment["outcome"] | "unassessed";

const support: Record<
  Family,
  Pick<
    PortalCoverageRow,
    "accountNeed" | "challengeNeed" | "support" | "adapterVersion" | "limitations"
  >
> = {
  recruitee: {
    accountNeed: "not_required",
    challengeNeed: "not_present",
    support: {
      discovery: "public_read",
      inspection: "dry_run_tested",
      commit: "fixture_tested",
      receipt: "fixture_tested",
      reconciliation: "planned",
    },
    adapterVersion: "recruitee-careers-v1",
    limitations: [
      "Single-location offers and supported single-value questions only.",
      "Private live submission evidence is still pending.",
    ],
  },
  greenhouse: {
    accountNeed: "unknown",
    challengeNeed: "unknown",
    support: {
      discovery: "public_read",
      inspection: "planned",
      commit: "planned",
      receipt: "planned",
      reconciliation: "planned",
    },
    adapterVersion: null,
    limitations: ["Application form variants have not yet been classified."],
  },
  lever: {
    accountNeed: "unknown",
    challengeNeed: "unknown",
    support: {
      discovery: "fixture_tested",
      inspection: "planned",
      commit: "planned",
      receipt: "planned",
      reconciliation: "planned",
    },
    adapterVersion: null,
    limitations: ["Application form variants have not yet been classified."],
  },
};

const outcomes = (): Record<Outcome, number> => ({
  auto_eligible: 0,
  ineligible: 0,
  review: 0,
  inference_paused: 0,
  unassessed: 0,
});

const levelWeight: Record<CoverageLevel, number> = {
  planned: 0,
  fixture_tested: 1,
  public_read: 2,
  dry_run_tested: 3,
  live_verified: 4,
};

export class CoverageRepository extends Repository {
  async report(): Promise<PortalCoverageReport> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      const candidate = (
        await tx.query("SELECT active_profile_id FROM candidates WHERE owner_id=$1", [this.ownerId])
      )[0];
      const activeProfileId = (candidate?.active_profile_id as string | null) ?? null;
      const listings = await tx.query(
        "SELECT l.job_id,s.connector,s.policy FROM discovery_listings l JOIN sources s ON s.owner_id=l.owner_id AND s.id=l.source_id WHERE l.owner_id=$1 AND l.state='open' ORDER BY s.connector,l.source_id,l.job_id",
        [this.ownerId],
      );
      const latest = activeProfileId
        ? await tx.query(
            "SELECT a.job_id,a.data FROM match_assessments a WHERE a.owner_id=$1 AND a.profile_id=$2 AND a.revision=(SELECT MAX(b.revision) FROM match_assessments b WHERE b.owner_id=a.owner_id AND b.job_id=a.job_id AND b.profile_id=a.profile_id)",
            [this.ownerId, activeProfileId],
          )
        : [];
      const assessmentByJob = new Map(
        latest.map((row) => {
          const assessment = assessmentSchema.parse(JSON.parse(String(row.data)));
          return [String(row.job_id), assessment.outcome] as const;
        }),
      );
      const grouped = new Map<
        Family,
        { variants: Map<string, Map<string, Outcome>>; jobs: Map<string, Outcome> }
      >();
      for (const row of listings) {
        const family = sourceInputSchema.shape.connector.parse(row.connector);
        const source = sourceInputSchema.parse(JSON.parse(String(row.policy)));
        const group = grouped.get(family) ?? { variants: new Map(), jobs: new Map() };
        const variantKey = `${source.region}:${source.board}`;
        const variantJobs = group.variants.get(variantKey) ?? new Map<string, Outcome>();
        const jobId = String(row.job_id);
        const outcome = assessmentByJob.get(jobId) ?? "unassessed";
        group.jobs.set(jobId, outcome);
        variantJobs.set(jobId, outcome);
        group.variants.set(variantKey, variantJobs);
        grouped.set(family, group);
      }
      const rows = [...grouped.entries()].map(([family, group]): PortalCoverageRow => {
        const eligibility = outcomes();
        for (const outcome of group.jobs.values()) eligibility[outcome] += 1;
        return {
          family,
          variants: [...group.variants.entries()]
            .map(([key, jobs]) => {
              const eligibility = outcomes();
              for (const outcome of jobs.values()) eligibility[outcome] += 1;
              return { key, openJobs: jobs.size, eligibility };
            })
            .sort(
              (a, b) =>
                b.eligibility.auto_eligible - a.eligibility.auto_eligible ||
                a.key.localeCompare(b.key),
            ),
          openJobs: group.jobs.size,
          eligibility,
          ...support[family],
        };
      });
      rows.sort(
        (a, b) =>
          b.eligibility.auto_eligible - a.eligibility.auto_eligible ||
          b.openJobs - a.openJobs ||
          levelWeight[b.support.discovery] - levelWeight[a.support.discovery] ||
          a.family.localeCompare(b.family),
      );
      const recommendedNextFamily =
        rows.find((row) => row.adapterVersion === null && row.openJobs > 0)?.family ?? null;
      return {
        generatedAt: this.now(),
        activeProfileId,
        totals: {
          openJobs: rows.reduce((sum, row) => sum + row.openJobs, 0),
          autoEligible: rows.reduce((sum, row) => sum + row.eligibility.auto_eligible, 0),
          unassessed: rows.reduce((sum, row) => sum + row.eligibility.unassessed, 0),
        },
        recommendedNextFamily,
        rows,
      };
    });
  }
}
