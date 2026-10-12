import { defineConfig } from "vite";

const api = { target: "https://academic-api.anssoft.com.tr", changeOrigin: true, secure: true };

export default defineConfig({
  root: "apps/admin",
  base: "/preview/",
  preview: {
    host: "127.0.0.1",
    port: 3314,
    strictPort: true,
    proxy: Object.fromEntries(["/auth", "/me", "/admin", "/universities", "/faculties", "/departments"].map((path) => [path, api]))
  }
});
