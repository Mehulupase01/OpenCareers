import type {
  CoverageLevel,
  PortalCoverageReport,
  PortalCoverageRow,
  PortalSupportVariant,
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
  breezy: {
    accountNeed: "unknown",
    challengeNeed: "unknown",
    adapterVersion: null,
    support: {
      discovery: "public_read",
      inspection: "planned",
      commit: "planned",
      receipt: "planned",
      reconciliation: "planned",
    },
    limitations: [
      "Public tenant JSON list and structured vacancy pages only; no application adapter.",
      "198 jobs/200 requests/60 seconds per complete scan; larger, drifting or unsupported boards fail without closing jobs.",
      "Primary location only; the public route has no published snapshot token or stability guarantee.",
    ],
  },
  teamtailor: {
    accountNeed: "unknown",
    challengeNeed: "unknown",
    adapterVersion: null,
    support: {
      discovery: "public_read",
      inspection: "planned",
      commit: "planned",
      receipt: "planned",
      reconciliation: "planned",
    },
    limitations: [
      "Public tenant RSS only; custom-domain feeds and application operations unsupported.",
      "Primary location only; complete scan requires a short terminal page.",
    ],
  },
  workable: {
    accountNeed: "unknown",
    challengeNeed: "unknown",
    adapterVersion: null,
    support: {
      discovery: "public_read",
      inspection: "planned",
      commit: "planned",
      receipt: "planned",
      reconciliation: "planned",
    },
    limitations: [
      "Published account feed with descriptions only; no Workable application adapter.",
      "Primary visible location only; boardless short links cannot identify an account for source setup.",
    ],
  },
  smartrecruiters: {
    accountNeed: "unknown",
    challengeNeed: "unknown",
    adapterVersion: null,
    support: {
      discovery: "public_read",
      inspection: "planned",
      commit: "planned",
      receipt: "planned",
      reconciliation: "planned",
    },
    limitations: [
      "Public postings and descriptions only; no SmartRecruiters application adapter.",
      "200 requests/60 seconds per complete scan; larger or shifting boards fail without closing jobs.",
    ],
  },
  personio: {
    accountNeed: "unknown",
    challengeNeed: "unknown",
    adapterVersion: null,
    support: {
      discovery: "public_read",
      inspection: "planned",
      commit: "planned",
      receipt: "planned",
      reconciliation: "planned",
    },
    limitations: [
      "Enabled public XML feed only; no Personio application adapter or private receipt.",
      "Office text only; no inferred publication date or secondary-office coverage.",
    ],
  },
  ashby: {
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
    limitations: [
      "Public posting discovery only; no Ashby application adapter or private receipt.",
    ],
  },
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
      inspection: "public_read",
      commit: "planned",
      receipt: "planned",
      reconciliation: "planned",
    },
    adapterVersion: null,
    limitations: ["Adyen hosted form is challenged; other application variants are unclassified."],
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

const supportMatrix: PortalSupportVariant[] = [
  {
    id: "breezy-public-jsonld-v1",
    family: "breezy",
    variant: "Public tenant list and structured vacancy pages",
    adapterVersion: null,
    accountNeed: "unknown",
    challengeNeed: "unknown",
    support: support.breezy.support,
    observedAt: "2026-10-10",
    evidence:
      "Codebase public read: 7 descriptions and 9 retained responses; synthetic discovery contract",
    limitations: support.breezy.limitations,
  },
  {
    id: "teamtailor-public-rss-v1",
    family: "teamtailor",
    variant: "Paginated public tenant RSS",
    adapterVersion: null,
    accountNeed: "unknown",
    challengeNeed: "unknown",
    support: support.teamtailor.support,
    observedAt: "2026-10-10",
    evidence:
      "Teamtailor career RSS read: 13 postings; retained hashed response plus synthetic paginated discovery",
    limitations: support.teamtailor.limitations,
  },
  {
    id: "workable-public-account-v1",
    family: "workable",
    variant: "Published account feed with descriptions",
    adapterVersion: null,
    accountNeed: "unknown",
    challengeNeed: "unknown",
    support: support.workable.support,
    observedAt: "2026-10-10",
    evidence:
      "Workable careers public read: 2 postings with descriptions; retained redirect/feed evidence plus synthetic discovery",
    limitations: support.workable.limitations,
  },
  {
    id: "smartrecruiters-public-posting-v1",
    family: "smartrecruiters",
    variant: "Public paginated postings plus descriptions",
    adapterVersion: null,
    accountNeed: "unknown",
    challengeNeed: "unknown",
    support: support.smartrecruiters.support,
    observedAt: "2026-10-10",
    evidence:
      "Sana Commerce public read: 6 postings plus descriptions; retained hashed responses, plus bounded synthetic discovery",
    limitations: support.smartrecruiters.limitations,
  },
  {
    id: "personio-public-xml-v1",
    family: "personio",
    variant: "Enabled public XML job feed",
    adapterVersion: null,
    accountNeed: "unknown",
    challengeNeed: "unknown",
    support: support.personio.support,
    observedAt: "2026-10-10",
    evidence:
      "Personio public XML read: 1 posting; retained hashed response, plus synthetic XML discovery lifecycle",
    limitations: support.personio.limitations,
  },
  {
    id: "ashby-public-posting-v1",
    family: "ashby",
    variant: "Published listed job-board snapshot",
    adapterVersion: null,
    accountNeed: "unknown",
    challengeNeed: "unknown",
    support: support.ashby.support,
    observedAt: "2026-10-10",
    evidence:
      "Ashby public board read: 68 postings; retained hashed response, plus synthetic discovery lifecycle",
    limitations: support.ashby.limitations,
  },
  {
    id: "mock-ats-standard",
    family: "mock_ats",
    variant: "Owned standard form",
    adapterVersion: "mock-ats-v1",
    accountNeed: "not_required",
    challengeNeed: "not_present",
    support: {
      discovery: "fixture_tested",
      inspection: "dry_run_tested",
      commit: "fixture_tested",
      receipt: "fixture_tested",
      reconciliation: "fixture_tested",
    },
    observedAt: null,
    evidence: "Synthetic P07/P08 lifecycle and recovery fixtures",
    limitations: ["Owned test portal only; no employer submission."],
  },
  {
    id: "recruitee-careers-v1",
    family: "recruitee",
    variant: "Published, single-location Careers Site offer",
    adapterVersion: "recruitee-careers-v1",
    accountNeed: "not_required",
    challengeNeed: "not_present",
    support: support.recruitee.support,
    observedAt: "2026-09-27",
    evidence: "Public Freeday collection read; synthetic candidate-ID receipt fixtures",
    limitations: ["Private live POST and email reconciliation pending."],
  },
  {
    id: "greenhouse-adyen-hosted",
    family: "greenhouse",
    variant: "Adyen hosted external form",
    adapterVersion: null,
    accountNeed: "not_required",
    challengeNeed: "required",
    support: support.greenhouse.support,
    observedAt: "2026-09-27",
    evidence: "Hydrated public form and intercepted synthetic final-action trace",
    limitations: ["reCAPTCHA Enterprise; upload, commit and correlated receipt unsupported."],
  },
  {
    id: "lever-protolabs-hosted",
    family: "lever",
    variant: "Protolabs hosted form",
    adapterVersion: null,
    accountNeed: "unknown",
    challengeNeed: "required",
    support: { ...support.lever.support, inspection: "public_read" },
    observedAt: "2026-09-27",
    evidence: "Public hosted form read-only inspection",
    limitations: ["Challenge and substantive answers; no submission adapter."],
  },
];

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
        supportMatrix,
      };
    });
  }
}
