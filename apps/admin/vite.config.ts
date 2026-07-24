import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/admin/",
  root: "apps/admin",
  server: {
    port: 3001
  }
});
