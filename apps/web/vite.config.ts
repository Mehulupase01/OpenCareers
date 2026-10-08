import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = `http://127.0.0.1:${process.env.AUTOPILOT_PORT ?? "4317"}`;
const webPort = Number(process.env.AUTOPILOT_WEB_PORT ?? 4318);
if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535)
  throw new Error("AUTOPILOT_WEB_PORT must be an integer from 1024 to 65535.");

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  build: { outDir: "../../dist/web", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: webPort,
    strictPort: true,
    proxy: { "/v1": api, "/health": api },
  },
});
