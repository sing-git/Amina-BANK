import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy: the frontend calls /api/* and Vite forwards to the backend on :8787.
// This avoids CORS entirely in development and keeps the backend URL out of the UI.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_BASE || "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
