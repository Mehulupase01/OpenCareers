import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
describe.skipIf(process.platform !== "win32")("isolated Windows startup host", () => {
  let directory: string;
  let config: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(await realpath(tmpdir()), "opencareers startup fixture "));
    await mkdir(join(directory, "dist/scripts"), { recursive: true });
    config = join(directory, "private fixture.env");
    await writeFile(config, "SYNTHETIC_CONFIGURATION_ONLY=1\n");
    await writeFile(
      join(directory, "dist/scripts/runtime.js"),
      `const fs = require("node:fs");
fs.writeFileSync("observed.json", JSON.stringify({
  args: process.argv.slice(2), keys: Object.keys(process.env),
  skip: process.env.AUTOPILOT_SKIP_ENV_FILE, cwd: process.cwd()
}));
console.log("SYNTHETIC_HOST_OUTPUT");
process.exit(process.argv[2] === "start" ? 17 : 0);\n`,
    );
  });
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  const run = (mode: string) =>
    execute(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        resolve("scripts/windows-startup-host.ps1"),
        "-InstallRoot",
        directory,
        "-ConfigFile",
        config,
        "-NodePath",
        process.execPath,
        "-Mode",
        mode,
      ],
      {
        timeout: 15000,
        env: {
          ...process.env,
          OPENROUTER_API_KEY: "synthetic-not-a-key",
          AUTOPILOT_OWNER_TOKEN: "synthetic-not-a-token",
          AUTOPILOT_VAULT_KEY: "synthetic-not-a-vault-key",
          NODE_OPTIONS: "--require=missing-synthetic-preload.cjs",
          AUTOPILOT_SKIP_ENV_FILE: "0",
        },
      },
    );
  it("uses explicit spaced paths, filters inherited secrets and propagates runtime exit codes", async () => {
    await expect(run("Run")).rejects.toMatchObject({ code: 17 });
    const observed = JSON.parse(await readFile(join(directory, "observed.json"), "utf8"));
    expect(observed).toMatchObject({
      args: ["start", "--config", config],
      skip: "1",
      cwd: directory,
    });
    expect(observed.keys).not.toEqual(
      expect.arrayContaining([
        "OPENROUTER_API_KEY",
        "AUTOPILOT_OWNER_TOKEN",
        "AUTOPILOT_VAULT_KEY",
        "NODE_OPTIONS",
      ]),
    );
    for (const key of [
      "OPENROUTER_API_KEY",
      "AUTOPILOT_OWNER_TOKEN",
      "AUTOPILOT_VAULT_KEY",
      "NODE_OPTIONS",
    ])
      expect(observed.keys).not.toContain(key);
  });
  it("returns successful validation and control output from the isolated child", async () => {
    for (const mode of ["Launch", "Validate", "Status", "Stop"]) {
      expect((await run(mode)).stdout.trim()).toBe("SYNTHETIC_HOST_OUTPUT");
      const observed = JSON.parse(await readFile(join(directory, "observed.json"), "utf8"));
      expect(observed.args).toEqual([mode.toLowerCase(), "--config", config]);
    }
    expect((await run("Version")).stdout.trim()).toBe(process.version);
  });
});
