import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Two pages: the BHOOMI landing page at / and the farmer app at /app/. */
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, "index.html"),
        app: resolve(import.meta.dirname, "app/index.html"),
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: { "/api": { target: "http://localhost:8080", changeOrigin: false } },
  },
});
