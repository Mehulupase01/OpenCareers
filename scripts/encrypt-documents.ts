import "../packages/config/src/env.js";
import { loadConfig } from "../packages/config/src/index.js";
import { DomainError } from "../packages/contracts/src/index.js";
import { DocumentEncryptionMigration } from "../packages/documents/src/encrypt-existing.js";
import { connect } from "../packages/persistence/src/index.js";

try {
  const args = process.argv.slice(2);
  if (
    args.length !== 2 ||
    !args.includes("--confirm-offline") ||
    !args.includes("--confirm-backup")
  )
    throw new DomainError(
      "CONFIG_INVALID",
      "Use --confirm-offline --confirm-backup only after shutting down services and securing a recoverable offline backup.",
    );
  const config = loadConfig();
  if (config.profile === "demo" || !config.vaultKey)
    throw new DomainError("CONFIG_INVALID", "Private profile and vault key are required.");
  const repo = await connect(config);
  try {
    const result = await new DocumentEncryptionMigration(repo.db, repo.ownerId).encrypt(config, {
      offline: true,
      backup: true,
    });
    console.log(JSON.stringify(result));
  } finally {
    await repo.db.close();
  }
} catch (error) {
  console.error(
    error instanceof DomainError
      ? error.message
      : "Document encryption migration failed; processing remains stopped. Review the offline inventory before retrying.",
  );
  process.exitCode = 1;
}
