import type { JobInput } from "../../contracts/src/index.js";
import type { Repository } from "./repository.js";

const jobs: JobInput[] = [
  {
    id: "demo-job-1",
    employerId: "northstar-demo",
    requisitionId: "NS-101",
    title: "Applied AI Engineer",
    company: "Northstar Labs (fictional)",
    location: "Amsterdam, NL",
    url: "https://northstar.example/jobs/NS-101",
    description: "Build retrieval systems and evaluate reliable AI applications.",
    source: "Synthetic fixture",
    synthetic: true,
  },
  {
    id: "demo-job-2",
    employerId: "fieldwork-demo",
    requisitionId: "FW-204",
    title: "Software Engineer, AI Products",
    company: "Fieldwork (fictional)",
    location: "Utrecht, NL",
    url: "https://fieldwork.example/jobs/FW-204",
    description: "Build TypeScript services and user-facing AI tools.",
    source: "Synthetic fixture",
    synthetic: true,
  },
  {
    id: "demo-job-3",
    employerId: "meridian-demo",
    requisitionId: "MR-309",
    title: "Machine Learning Engineer",
    company: "Meridian Research (fictional)",
    location: "Rotterdam, NL",
    url: "https://meridian.example/jobs/MR-309",
    description: "Evaluate and deploy machine learning pipelines.",
    source: "Synthetic fixture",
    synthetic: true,
  },
];

export async function seedDemo(repository: Repository): Promise<void> {
  for (const job of jobs) {
    const id = await repository.putJob(job);
    await repository.createApplication(id, "synthetic-candidate");
  }
  await repository.enqueue({ type: "demo_probe", domain: "internal", dedupeKey: "demo-probe:v1" });
}
