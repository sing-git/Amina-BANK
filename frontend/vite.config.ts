import { defineConfig, createLogger } from "vite";
import react from "@vitejs/plugin-react";

// Filter the dev-only "http proxy error" spam that appears when the backend (:8787)
// isn't running. The UI falls back to bundled data in that case, so these ECONNREFUSED
// stack traces are noise, not real errors — every other log passes through untouched.
const logger = createLogger();
const baseError = logger.error.bind(logger);
logger.error = (msg, opts) => {
  if (typeof msg === "string" && msg.includes("http proxy error")) return;
  baseError(msg, opts);
};

// Dev proxy: the frontend calls /api/* and Vite forwards to the backend on :8787.
// This avoids CORS entirely in development and keeps the backend URL out of the UI.
export default defineConfig({
  plugins: [react()],
  customLogger: logger,
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_BASE || "http://localhost:8787",
        changeOrigin: true,
        // Backend down → respond with a clean 503 so the request resolves immediately
        // and the fetchers fall back to bundled data (instead of hanging / erroring).
        configure: (proxy) => {
          proxy.on("error", (_err, _req, res) => {
            if (res && "writeHead" in res && !res.headersSent) {
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end('{"error":"backend offline (dev) — using bundled data"}');
            }
          });
        },
      },
    },
  },
});
