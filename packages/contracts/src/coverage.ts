import type { SourceInput } from "./discovery.js";
import type { MatchAssessment } from "./matching.js";

export type CoverageLevel =
  | "planned"
  | "fixture_tested"
  | "public_read"
  | "dry_run_tested"
  | "live_verified";

export interface PortalCoverageRow {
  family: SourceInput["connector"];
  variants: string[];
  openJobs: number;
  eligibility: Record<MatchAssessment["outcome"] | "unassessed", number>;
  accountNeed: "not_required" | "required" | "unknown";
  challengeNeed: "not_present" | "required" | "unknown";
  support: {
    discovery: CoverageLevel;
    inspection: CoverageLevel;
    commit: CoverageLevel;
    receipt: CoverageLevel;
    reconciliation: CoverageLevel;
  };
  adapterVersion: string | null;
  limitations: string[];
}

export interface PortalCoverageReport {
  generatedAt: string;
  activeProfileId: string | null;
  totals: {
    openJobs: number;
    autoEligible: number;
    unassessed: number;
  };
  recommendedNextFamily: SourceInput["connector"] | null;
  rows: PortalCoverageRow[];
}
