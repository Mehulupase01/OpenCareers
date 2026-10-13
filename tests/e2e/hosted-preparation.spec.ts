import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { packetEvidenceGuard } from "../../packages/browser/src/answer-guard.js";
import { prepareHostedPacket } from "../../packages/browser/src/hosted-prepare.js";
import type { BrowserPreparation } from "../../packages/contracts/src/browser.js";
import type { PacketSnapshot } from "../../packages/contracts/src/documents.js";
import type { HostedOriginPermission } from "../../packages/contracts/src/hosted-preparation.js";
import { ArtifactStore } from "../../packages/documents/src/artifact-store.js";
import { generatePacketContent } from "../../packages/documents/src/domain.js";
import { buildPacket } from "../../packages/documents/src/factory.js";
import { documentGenerationInput } from "../fixtures/document-packets.js";

let directory: string, packet: PacketSnapshot, preparation: BrowserPreparation;
const origin = "https://careers.synthetic.test";
test.beforeAll(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "opencareers-hosted-ui-")));
  const store = new ArtifactStore(directory);
  await store.initialize();
  const input = documentGenerationInput();
  input.requestedAnswers = [];
  input.job.url = `${origin}/jobs/123`;
  packet = {
    ...(await buildPacket(store, input, {
      letter: generatePacketContent(input).letter,
      modelId: "synthetic/model:free",
      provider: "synthetic-provider",
      responseHash: "b".repeat(64),
    })),
    valid: true,
    invalidReason: null,
  };
  const permission: HostedOriginPermission = {
    origin,
    revision: 1,
    state: "active",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    permissionSha256: "a".repeat(64),
    updatedAt: new Date().toISOString(),
  };
  const result = await prepareHostedPacket(
    packet,
    permission,
    packetEvidenceGuard(packet),
    async () => ({
      body: Buffer.from(
        '<form method="post"><label>Full name<input required></label><label>Email address<input type="email" required></label><button>Apply</button></form>',
      ),
      contentType: "text/html",
    }),
  );
  preparation = {
    id: "synthetic-hosted-preparation",
    status: result.status,
    result,
    createdAt: result.preparedAt,
    expiresAt: null,
    resolvedAt: null,
  };
});
test.afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("owner origin approval, native evidence and revocation fit desktop and mobile", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let permission: HostedOriginPermission | undefined;
  let history: BrowserPreparation[] = [];
  const commands: string[] = [];
  // UI-only private-profile fixture; the backing server stays synthetic demo.
  await page.route("**/v1/operations/summary", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...(await response.json()), profile: "local" } });
  });
  await page.route("**/v1/documents", (route) => route.fulfill({ json: [packet] }));
  await page.route("**/v1/browser", (route) => route.fulfill({ json: history }));
  await page.route("**/v1/browser/origins", (route) =>
    route.fulfill({ json: permission ? [permission] : [] }),
  );
  await page.route("**/v1/browser/origins/approve", async (route) => {
    const input = route.request().postDataJSON();
    expect(input).toMatchObject({
      origin,
      expectedRevision: 0,
      publicReadAndLowRiskFillReviewed: true,
    });
    permission = {
      origin,
      revision: 1,
      state: "active",
      expiresAt: input.expiresAt,
      permissionSha256: "a".repeat(64),
      updatedAt: new Date().toISOString(),
    };
    commands.push("approve");
    await route.fulfill({ json: permission });
  });
  await page.route("**/v1/browser/hosted/prepare", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ packetId: packet.manifest.id });
    commands.push("prepare");
    history = [preparation];
    await route.fulfill({ json: preparation });
  });
  await page.route("**/v1/browser/origins/revoke", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ origin, expectedRevision: 1 });
    if (!permission) throw new Error("Missing permission");
    permission = { ...permission, state: "revoked", revision: 2 };
    commands.push("revoke");
    await route.fulfill({ json: permission });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  const panel = page.getByRole("region", { name: "Hosted preparation" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Prepare fields", exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Approve origin", exact: true })).toBeDisabled();
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "Approve origin", exact: true }).click();
  await expect(panel.getByText("Origin approved", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Prepare fields", exact: true }).click();
  await expect(panel.getByText("Matched", { exact: true })).toHaveCount(2);
  await expect(
    panel.getByText("Final submission requires a reviewed portal adapter."),
  ).toBeVisible();
  await expect(panel.getByRole("button", { name: /submit/i })).toHaveCount(0);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/P18-hosted-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.getByRole("button", { name: "Revoke origin approval", exact: true }).click();
  await expect(panel.getByText("Approval revoked", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Prepare fields", exact: true })).toBeDisabled();
  expect(commands).toEqual(["approve", "prepare", "revoke"]);
  expect(errors).toEqual([]);
});
