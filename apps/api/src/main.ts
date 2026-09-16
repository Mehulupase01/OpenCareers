import "../../../packages/config/src/env.js";
import { loadConfig } from "../../../packages/config/src/index.js";
import { createLogger } from "../../../packages/observability/src/index.js";
import { seedDemo } from "../../../packages/persistence/src/demo.js";
import { connect } from "../../../packages/persistence/src/index.js";
import { buildServer } from "./server.js";

const logger = createLogger();
try {
  const config = loadConfig();
  const repository = await connect(config);
  if (config.profile === "demo") await seedDemo(repository);
  const app = await buildServer(config, repository);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    await repository.db.close();
  };
  process.on("SIGINT", () => {
    void stop();
  });
  process.on("SIGTERM", () => {
    void stop();
  });
  await app.listen({ host: config.host, port: config.port });
  logger.info(
    { profile: config.profile, version: "0.1.0", port: config.port },
    "OpenCareers API ready",
  );
} catch (error) {
  logger.error({ err: error }, "API startup failed");
  process.exitCode = 1;
}
