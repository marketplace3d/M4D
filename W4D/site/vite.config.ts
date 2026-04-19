import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4400,
    proxy: {
      "/v1": "http://127.0.0.1:4040",
      "/health": "http://127.0.0.1:4040",
    },
  },
});
