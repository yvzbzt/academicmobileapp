#!/usr/bin/env bash
set -Eeuo pipefail

container="${1:-anssoft-backend}"

docker exec -i "${container}" node --input-type=module <<'NODE'
import nodemailer from "nodemailer";

const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`smtp_verify=missing_env:${missing.join(",")}`);
  process.exit(1);
}

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

try {
  await transport.verify();
  console.log("smtp_verify=passed");
} catch (error) {
  console.error(`smtp_verify=failed:${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
NODE
