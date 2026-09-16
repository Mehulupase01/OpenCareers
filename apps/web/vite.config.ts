import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  build: { outDir: "../../dist/web", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 4318,
    strictPort: true,
    proxy: { "/v1": "http://127.0.0.1:4317", "/health": "http://127.0.0.1:4317" },
  },
});
