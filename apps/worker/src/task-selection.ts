import type { Config } from "../../../packages/config/src/index.js";
import type { Task, TaskType } from "../../../packages/contracts/src/index.js";

export async function selectWorkerTask(options: {
  profile: Config["profile"];
  externalSubmissionEnabled: boolean;
  hasLetterRunner: boolean;
  claim(types: TaskType[]): Promise<Task | null>;
  assess(limit: number): Promise<unknown>;
  routeReady(): Promise<boolean>;
}): Promise<Task | null> {
  // Recover expired leases and reconcile uncertainty before spending model time.
  // A network-disabled private runtime retains its existing no-adapter boundary.
  if (options.profile === "demo" || options.externalSubmissionEnabled) {
    const recovery = await options.claim(["reconcile"]);
    if (recovery) return recovery;
  }
  await options.assess(1);
  const canPrepare =
    options.profile === "demo" || (options.hasLetterRunner && (await options.routeReady()));
  const types: TaskType[] =
    options.profile === "demo"
      ? ["demo_probe", "prepare", "inspect", "submit", "reconcile"]
      : options.externalSubmissionEnabled
        ? canPrepare
          ? ["prepare", "inspect", "submit", "reconcile"]
          : ["inspect", "submit", "reconcile"]
        : canPrepare
          ? ["prepare"]
          : [];
  return options.claim(types);
}
