import { createHash } from "node:crypto";
import { convert } from "html-to-text";
import type { SourceInput } from "../../contracts/src/discovery.js";
import { DomainError } from "../../contracts/src/index.js";

export const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export function plainText(html: string): string {
  return convert(html, {
    wordwrap: false,
    limits: { maxInputLength: 200000, maxDepth: 30 },
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
    ],
  }).trim();
}
export function normalizedDate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
const nlCities = [
  "Amsterdam",
  "Rotterdam",
  "Utrecht",
  "Eindhoven",
  "Delft",
  "The Hague",
  "Den Haag",
  "Leiden",
  "Groningen",
  "Enschede",
  "Amersfoort",
  "Hilversum",
  "Nijmegen",
  "Tilburg",
  "Breda",
  "Haarlem",
];
export const roleAliases = {
  software: [
    "software engineer",
    "software developer",
    "backend",
    "front end",
    "frontend",
    "full stack",
    "full-stack",
    "softwareontwikkelaar",
  ],
  data: ["data engineer", "data scientist", "analytics engineer", "machine learning"],
  platform: ["platform engineer", "devops", "site reliability", "cloud engineer"],
} as const;
export function roleFamily(title: string): string | null {
  return (
    Object.entries(roleAliases).find(([, terms]) =>
      terms.some((term) => title.toLowerCase().includes(term)),
    )?.[0] ?? null
  );
}
export function locationFields(original: string, country?: string | null, workplace?: string) {
  const city = nlCities.find((c) => new RegExp(`\\b${c}\\b`, "i").test(original)) ?? null;
  const explicit = country?.toUpperCase();
  const countryCode =
    explicit && /^[A-Z]{2}$/.test(explicit)
      ? explicit
      : /\b(Netherlands|Nederland)\b/i.test(original) ||
          (city && original.trim().toLowerCase() === city.toLowerCase())
        ? "NL"
        : undefined;
  const remote =
    workplace === "remote" || /\bremote\b/i.test(original)
      ? "remote"
      : workplace === "hybrid" || /\bhybrid\b/i.test(original)
        ? "hybrid"
        : workplace === "on-site"
          ? "on_site"
          : "unknown";
  return { countryCode, city: countryCode === "NL" ? city : null, remote } as const;
}
export function sourceKey(source: Pick<SourceInput, "connector" | "board" | "region">) {
  return `${source.connector}:${source.region}:${source.board}`;
}
export function hostedUrl(
  source: Pick<SourceInput, "connector" | "board" | "region">,
  posting: string,
): string {
  if (source.connector === "greenhouse")
    return `https://job-boards.greenhouse.io/${source.board}/jobs/${encodeURIComponent(posting)}`;
  return `https://jobs.${source.region === "eu" ? "eu." : ""}lever.co/${source.board}/${encodeURIComponent(posting)}`;
}
export function recognizeUrl(input: string): {
  connector: "greenhouse" | "lever";
  board: string;
  region: "global" | "eu";
  postingId: string;
  canonicalUrl: string;
} {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new DomainError(
      "ORIGIN_DENIED",
      "Only supported public HTTPS vacancy URLs are accepted.",
    );
  const parts = url.pathname.split("/").filter(Boolean);
  let connector: "greenhouse" | "lever";
  let region: "global" | "eu" = "global";
  let postingId: string;
  if (
    ["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(url.hostname) &&
    parts.length === 3 &&
    parts[1] === "jobs" &&
    /^\d+$/.test(parts[2] ?? "")
  ) {
    connector = "greenhouse";
    postingId = parts[2] as string;
  } else if (
    ["jobs.lever.co", "jobs.eu.lever.co"].includes(url.hostname) &&
    (parts.length === 2 || (parts.length === 3 && parts[2] === "apply")) &&
    /^[a-zA-Z0-9-]+$/.test(parts[1] ?? "")
  ) {
    connector = "lever";
    region = url.hostname === "jobs.eu.lever.co" ? "eu" : "global";
    postingId = parts[1] as string;
  } else
    throw new DomainError(
      "ADAPTER_UNSUPPORTED",
      "This URL is not a supported public ATS vacancy. Redirectors are not followed.",
    );
  const board = parts[0] ?? "";
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(board))
    throw new DomainError("CONFIG_INVALID", "Invalid board token.");
  const result = { connector, board, region, postingId };
  return { ...result, canonicalUrl: hostedUrl(result, postingId) };
}
