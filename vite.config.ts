import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src",
  publicDir: resolve(__dirname, "public"),
  build: {
    outDir: resolve(__dirname, "dist/client"),
    emptyOutDir: true,
  },
  server: {
    // Bind the exact host scripts/dev-ports.ts probed (HOST, pinned into the env
    // alongside VITE_PORT). Without this Vite defaults to `localhost`, which on a
    // dual-stack box resolves to IPv6 `::1` — a different address family than the
    // probe's `127.0.0.1`. Binding the probed host keeps verdict and bind coherent.
    host: process.env.HOST || "127.0.0.1",
    // Offset from binp-file-explorer's 5173 so both services can run side by
    // side. Ports are resolved before startup by scripts/dev-ports.ts, which
    // pins the result into VITE_PORT / VITE_API_TARGET (ADR-0037 §2); absent
    // that, the canonical port applies.
    port: Number(process.env.VITE_PORT) || 5183,
    // ADR-0018 / ADR-0037 §3: never migrate to another port at bind time. Any
    // reassignment is decided up front by the pre-dev setup, not silently here.
    strictPort: true,
    proxy: {
      // Dev: Vite serves the client, Elysia serves the API on :3010.
      "^/api/.*": {
        // Literal IPv4, not `localhost`: on a dual-stack box `localhost`
        // resolves `::1` first, but the Elysia server binds 127.0.0.1 — so a
        // name-based target would try the wrong family first. dev.ts overrides
        // this with VITE_API_TARGET; this fallback only fires for a bare
        // `dev:client`.
        target: process.env.VITE_API_TARGET || "http://127.0.0.1:3010",
        changeOrigin: true,
      },
    },
  },
});
