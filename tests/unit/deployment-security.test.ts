import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin deployment security headers", () => {
  it("keeps browser hardening headers in the production Caddy configuration", () => {
    const caddyfile = readFileSync(
      new URL("../../deploy/hetzner/admin/Caddyfile", import.meta.url),
      "utf8"
    );

    expect(caddyfile).toContain('Strict-Transport-Security "max-age=31536000; includeSubDomains"');
    expect(caddyfile).toContain('Content-Security-Policy "default-src \'self\'');
    expect(caddyfile).toContain('X-Content-Type-Options "nosniff"');
    expect(caddyfile).toContain('X-Frame-Options "DENY"');
    expect(caddyfile).toContain('Permissions-Policy "camera=(), geolocation=(), microphone=()"');
  });

  it.each([
    "../../deploy/hetzner/Caddyfile.proposed",
    "../../deploy/hetzner/admin/academic-api.anssoft.com.tr.caddy",
    "../../deploy/hetzner/web/academic-api.anssoft.com.tr.caddy"
  ])("keeps HSTS at the public academic API edge in %s", (relativePath) => {
    const route = readFileSync(new URL(relativePath, import.meta.url), "utf8");

    expect(route).toContain('header Strict-Transport-Security "max-age=31536000; includeSubDomains"');
  });

  it("keeps audit remediation deployment scoped to the academic project", () => {
    const script = readFileSync(
      new URL("../../deploy/hetzner/deploy-audit-remediation.sh", import.meta.url),
      "utf8"
    );

    expect(script).toContain('project_root="/opt/anssoft-academicmobilapp-backend"');
    expect(script).toContain('api_container="anssoft-backend"');
    expect(script).toContain('mongo_container="anssoft-mongodb"');
    expect(script).toContain('caddy_route="/home/ans/docker/caddy/custom-domains/academic-api.anssoft.com.tr.caddy"');
    expect(script).toContain("sha256sum --check --strict source.archive.sha256");
    expect(script).toContain('[[ -z "$(find "${source_root}" -type l -print -quit)" ]]');
    expect(script).toContain('up -d --no-deps --force-recreate api');
    expect(script).not.toMatch(/docker\s+(?:compose\s+)?(?:down|system\s+prune|volume\s+rm|network\s+rm)\b/u);
  });

  it("does not track GitHub Actions workflows", () => {
    const workflowDirectory = new URL("../../.github/workflows/", import.meta.url);
    const workflows = existsSync(workflowDirectory) ? readdirSync(workflowDirectory) : [];

    expect(workflows).toEqual([]);
  });
});
