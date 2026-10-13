import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createAdapterRegistry } from "../../packages/browser/src/adapter-sdk.js";
import { packetEvidenceGuard } from "../../packages/browser/src/answer-guard.js";
import { prepareHostedPacket } from "../../packages/browser/src/hosted-prepare.js";
import { browserResources } from "../../packages/browser/src/resources.js";
import type { PacketSnapshot } from "../../packages/contracts/src/documents.js";
import type { HostedOriginPermission } from "../../packages/contracts/src/hosted-preparation.js";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";

let directory: string, packet: PacketSnapshot;
const origin = "https://careers.synthetic.test";
const html =
  '<form method="post" action="/applications"><label>Full name<input required></label><label>Email address<input type="email" required></label><label>Phone number<input type="tel"></label><button>Apply</button></form><script>fetch("/applications",{method:"POST"})</script>';
const permission = (): HostedOriginPermission => ({
  origin,
  revision: 1,
  state: "active",
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  permissionSha256: "a".repeat(64),
  updatedAt: new Date().toISOString(),
});
beforeAll(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "opencareers-hosted-prepare-")));
  const store = new ArtifactStore(directory);
  await store.initialize();
  const input = documentGenerationInput();
  input.requestedAnswers = [];
  input.job.url = `${origin}/jobs/123`;
  const built = await buildPacket(store, input);
  packet = { ...built, valid: true, invalidReason: null };
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
it("fills and rereads approved native controls with scripts disabled and no generic final authority", async () => {
  const requests: string[] = [];
  const result = await prepareHostedPacket(
    packet,
    permission(),
    packetEvidenceGuard(packet),
    async (url) => {
      requests.push(url);
      return { body: Buffer.from(html), contentType: "text/html" };
    },
  );
  expect(result).toMatchObject({
    status: "unsupported",
    adapter: { id: "hosted-readonly" },
    serverApplicationCount: 0,
  });
  expect(result.reports[0]?.status).toBe("ready");
  expect(result.reports[0]?.readBack.every((row) => row.matches)).toBe(true);
  expect(requests).toEqual([packet.content.job.url]);
  expect(() => createAdapterRegistry(directory).get("hosted-readonly")).toThrow();
  expect(browserResources.snapshot()).toMatchObject({ browsers: 0, contexts: 0 });
});
it.each([
  '<input aria-label="Need sponsorship?">',
  '<input aria-label="constructor">',
  '<input aria-label="__proto__">',
  '<input aria-label="Email" type="file">',
  '<div data-sitekey="synthetic"></div>',
])("stops without filling when controls are unsupported or challenged", async (extra) => {
  const result = await prepareHostedPacket(
    packet,
    permission(),
    packetEvidenceGuard(packet),
    async () => ({
      body: Buffer.from(html.replace("</form>", `${extra}</form>`)),
      contentType: "text/html",
    }),
  );
  expect(result.reports[0]?.readBack).toEqual([]);
  expect(result.status).not.toBe("ready");
});
it("does not fill after a required public resource fails or leaves the approved origin", async () => {
  let calls = 0;
  const result = await prepareHostedPacket(
    packet,
    permission(),
    packetEvidenceGuard(packet),
    async () => {
      calls++;
      return {
        body: Buffer.from(
          `${html}<link rel="stylesheet" href="https://unreviewed.synthetic.test/style.css">`,
        ),
        contentType: "text/html",
      };
    },
  );
  expect(calls).toBe(1);
  expect(result.reports[0]?.readBack).toEqual([]);
  expect(result.issues.join(" ")).toContain("read-only load policy");
});
it("rejects revoked authorization during filling and releases its owned browser", async () => {
  let checks = 0;
  await expect(
    prepareHostedPacket(
      packet,
      permission(),
      async (_snapshot, plan) => {
        if (++checks > 1) throw new Error("Revoked");
        return plan;
      },
      async () => ({ body: Buffer.from(html), contentType: "text/html" }),
    ),
  ).rejects.toThrow("approval");
  expect(checks).toBeGreaterThan(1);
  expect(browserResources.snapshot()).toMatchObject({ browsers: 0, contexts: 0 });
});
it("rejects revoked, expired or wrong-origin permission before any browser or resource request", async () => {
  const launches = browserResources.snapshot().launches;
  for (const override of [
    { state: "revoked" as const },
    { expiresAt: "2020-01-01T00:00:00.000Z" },
    { origin: "https://other.synthetic.test" },
  ])
    await expect(
      prepareHostedPacket(packet, { ...permission(), ...override }, packetEvidenceGuard(packet)),
    ).rejects.toMatchObject({ code: "POLICY_REVOKED" });
  expect(browserResources.snapshot().launches).toBe(launches);
});
it("rejects account-action targets before creating a browser or invoking its reader", async () => {
  const launches = browserResources.snapshot().launches;
  let reads = 0;
  const unsafe = structuredClone(packet);
  unsafe.content.job.url = `${origin}/verify?token=synthetic-private`;
  await expect(
    prepareHostedPacket(unsafe, permission(), packetEvidenceGuard(unsafe), async () => {
      reads++;
      return { body: Buffer.from(html), contentType: "text/html" };
    }),
  ).rejects.toMatchObject({ code: "ORIGIN_DENIED" });
  expect(reads).toBe(0);
  expect(browserResources.snapshot().launches).toBe(launches);
});
it("does not fetch signed asset URLs even through the injected reader and stops filling", async () => {
  let reads = 0;
  const result = await prepareHostedPacket(
    packet,
    permission(),
    packetEvidenceGuard(packet),
    async () => {
      reads++;
      return {
        body: Buffer.from(`${html}<link rel="stylesheet" href="/verify?token=synthetic-private">`),
        contentType: "text/html",
      };
    },
  );
  expect(reads).toBe(1);
  expect(result.reports[0]?.readBack).toEqual([]);
  expect(result.status).toBe("unsupported");
});
