import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The dashboard calls "/api/..."; in development Vite forwards those to the backend.
const apiTarget = process.env["API_TARGET"] ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget },
    },
  },
  // "npm run preview" serves the built app on the same address as development, so the same backend rules apply.
  preview: { host: "127.0.0.1", port: 5173, strictPort: true, proxy: { "/api": { target: apiTarget } } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
