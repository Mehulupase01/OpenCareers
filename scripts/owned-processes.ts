import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { z } from "zod";

const execute = promisify(execFile);
const processRecordSchema = z
  .object({
    pid: z.number().int().positive().max(2147483647),
    ppid: z.number().int().nonnegative().max(2147483647),
    start: z.string().regex(/^\d{1,40}$/),
    rss: z
      .number()
      .int()
      .nonnegative()
      .max(8 * 1024 ** 4),
  })
  .strict();
export type ProcessMemoryRecord = z.infer<typeof processRecordSchema>;
const recordsSchema = z.array(processRecordSchema).max(20000);
function helperEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|HOME|USERPROFILE)$/i.test(key),
    ),
  );
}
let pageBytes: Promise<number> | undefined;

export async function readProcessMemory(): Promise<ProcessMemoryRecord[]> {
  if (process.platform === "win32") {
    const script =
      "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -gt 0 -and $null -ne $_.CreationDate } | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId; start=[string]$_.CreationDate.ToUniversalTime().Ticks; rss=[double]$_.WorkingSetSize } } | ConvertTo-Json -Depth 3 -Compress";
    const output = await execute(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, env: helperEnvironment(), timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
    );
    const raw: unknown = JSON.parse(output.stdout.trim());
    return recordsSchema.parse(Array.isArray(raw) ? raw : [raw]).filter((record) => record.pid > 0);
  }
  if (process.platform !== "linux")
    throw new Error("Owned-process memory measurement supports Windows and Linux only.");
  pageBytes ??= execute("getconf", ["PAGESIZE"], {
    env: helperEnvironment(),
    timeout: 5000,
    maxBuffer: 1024,
  }).then((result) =>
    z
      .number()
      .int()
      .positive()
      .max(1024 * 1024)
      .parse(Number(result.stdout.trim())),
  );
  const pageSize = await pageBytes;
  const entries = (await readdir("/proc")).filter((name) => /^\d+$/.test(name));
  if (entries.length > 20000) throw new Error("Process census exceeds its bound.");
  const records: ProcessMemoryRecord[] = [];
  for (const entry of entries) {
    try {
      const raw = await readFile(`/proc/${entry}/stat`, "utf8");
      if (raw.length > 65536) throw new Error("Process record exceeds its bound.");
      const close = raw.lastIndexOf(") ");
      if (close < 0) throw new Error("Process record is malformed.");
      const fields = raw
        .slice(close + 2)
        .trim()
        .split(/\s+/);
      records.push(
        processRecordSchema.parse({
          pid: Number(entry),
          ppid: Number(fields[1]),
          start: fields[19],
          rss: Number(fields[21]) * pageSize,
        }),
      );
    } catch (error) {
      // Processes may exit during the census; neither names nor command lines are retained.
      if (
        error instanceof Error &&
        "code" in error &&
        ["ENOENT", "ESRCH"].includes(String(error.code))
      )
        continue;
      throw error;
    }
  }
  return recordsSchema.parse(records);
}

export class OwnedProcessTracker {
  private readonly owned = new Map<number, string>();
  private rootStart: string | undefined;
  private peakRssBytes = 0;
  private peakProcesses = 0;
  constructor(private readonly rootPid = process.pid) {
    if (!Number.isInteger(rootPid) || rootPid < 1)
      throw new Error("A live owned root PID is required.");
  }
  owns(pid: number) {
    return this.owned.has(pid);
  }
  sample(raw: unknown) {
    const records = recordsSchema.parse(raw);
    const byPid = new Map(records.map((record) => [record.pid, record]));
    if (byPid.size !== records.length) throw new Error("Process census repeats a PID.");
    const root = byPid.get(this.rootPid);
    if (!root || (this.rootStart !== undefined && root.start !== this.rootStart))
      throw new Error("Owned root exited or its PID was reused.");
    if (!root.rss) throw new Error("Owned root memory is unavailable.");
    this.rootStart ??= root.start;
    // Keep observed orphans, but never transfer ownership to a reused PID.
    for (const [pid, start] of this.owned)
      if (byPid.get(pid)?.start !== start) this.owned.delete(pid);
    this.owned.set(root.pid, root.start);
    let changed = true;
    while (changed) {
      changed = false;
      for (const record of records) {
        if (
          !this.owned.has(record.pid) &&
          this.owned.get(record.ppid) === byPid.get(record.ppid)?.start &&
          byPid.has(record.ppid)
        ) {
          this.owned.set(record.pid, record.start);
          changed = true;
        }
      }
      if (this.owned.size > 1000) throw new Error("Owned process tree exceeds its bound.");
    }
    const rssBytes = [...this.owned.keys()].reduce(
      (sum, pid) => sum + (byPid.get(pid)?.rss ?? 0),
      0,
    );
    if (!Number.isSafeInteger(rssBytes))
      throw new Error("Process memory total exceeds its numeric bound.");
    this.peakRssBytes = Math.max(this.peakRssBytes, rssBytes);
    this.peakProcesses = Math.max(this.peakProcesses, this.owned.size);
    return {
      scope: "current_process_and_observed_owned_descendants" as const,
      processCount: this.owned.size,
      rssBytes,
      peakRssBytes: this.peakRssBytes,
      peakProcesses: this.peakProcesses,
    };
  }
}
