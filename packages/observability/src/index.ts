import pino from "pino";

export function createLogger() {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers.set-cookie",
        "password",
        "token",
        "apiKey",
        "email",
        "phone",
        "body",
        "*.password",
        "*.token",
        "*.email",
        "*.phone",
        "databaseUrl",
        "ownerToken",
      ],
      censor: "[REDACTED]",
    },
    serializers: {
      err: (error: unknown) => ({
        name: error instanceof Error ? error.name : "Error",
        code:
          typeof error === "object" && error !== null && "code" in error ? error.code : "INTERNAL",
      }),
    },
  });
}
