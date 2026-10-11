import type { PortalCoverageReport } from "../../contracts/src/coverage.js";

// Targets are not readers, permissions, availability promises or measured rankings.
const boardTargets = [
  ["linkedin", "LinkedIn"],
  ["indeed", "Indeed"],
  ["glassdoor", "Glassdoor"],
  ["monster", "Monster"],
  ["stepstone", "StepStone"],
  ["nationale-vacaturebank", "Nationale Vacaturebank"],
  ["jobbird", "Jobbird"],
  ["intermediair", "Intermediair"],
  ["ictergezocht", "ICTerGezocht"],
  ["magnet", "Magnet.me"],
  ["wellfound", "Wellfound"],
  ["welcome-to-the-jungle", "Welcome to the Jungle"],
  ["we-work-remotely", "We Work Remotely"],
  ["remote-ok", "Remote OK"],
  ["remotive", "Remotive"],
  ["eures", "EURES"],
  ["euraxess", "EURAXESS"],
  ["academic-positions", "Academic Positions"],
  ["werk", "Werk.nl"],
  ["werken-bij-de-overheid", "Werken bij de Overheid"],
] as const;

export function jobBoardCatalog(): PortalCoverageReport["sourceCoverage"]["boards"] {
  return boardTargets.map(([id, name], index) => ({
    id,
    name,
    priority: index + 1,
    implementation: "planned",
    access: "unreviewed",
    operational: false,
  }));
}
