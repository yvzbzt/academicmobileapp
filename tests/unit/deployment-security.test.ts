import { readFileSync } from "node:fs";
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
});
