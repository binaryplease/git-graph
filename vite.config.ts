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
    // Offset from binp-file-explorer's 5173/3000 so both services can run
    // side by side during development.
    port: 5183,
    proxy: {
      // Dev: Vite serves the client, Elysia serves the API on :3010.
      "^/api/.*": {
        target: "http://localhost:3010",
        changeOrigin: true,
      },
    },
  },
});
