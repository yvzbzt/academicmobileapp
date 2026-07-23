#!/usr/bin/env bash
set -Eeuo pipefail

container="${1:-anssoft-backend}"

docker exec -i "${container}" node --input-type=module <<'NODE'
import dns from "node:dns/promises";
import net from "node:net";
import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT ?? 587);
const secure = process.env.SMTP_SECURE === "true";

console.log(`smtp_host=${host ? "present" : "missing"}`);
console.log(`smtp_port=${Number.isFinite(port) ? port : "invalid"}`);
console.log(`smtp_secure=${secure}`);
console.log(`smtp_user=${process.env.SMTP_USER ? "present" : "missing"}`);
console.log(`smtp_pass=${process.env.SMTP_PASS ? "present" : "missing"}`);

if (!host || !Number.isFinite(port)) {
  process.exit(1);
}

try {
  const addresses = await dns.lookup(host, { all: true });
  console.log(`dns_status=ok`);
  console.log(`dns_addresses=${addresses.map((entry) => `${entry.address}/${entry.family}`).join(",")}`);
} catch (error) {
  console.log(`dns_status=failed`);
  console.log(`dns_error=${error instanceof Error ? error.message : String(error)}`);
}

await new Promise((resolve) => {
  const socket = net.connect({ host, port });
  let settled = false;
  const finish = (status, detail) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    console.log(`tcp_status=${status}`);
    if (detail) console.log(`tcp_detail=${detail}`);
    resolve();
  };
  socket.setTimeout(15000);
  socket.once("connect", () => finish("connected"));
  socket.once("timeout", () => finish("timeout", "No TCP connection within 15 seconds."));
  socket.once("error", (error) => finish("failed", `${error.code ?? "ERROR"} ${error.message}`));
});

const transport = nodemailer.createTransport({
  host,
  port,
  secure,
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 20000,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

try {
  await transport.verify();
  console.log("nodemailer_verify=passed");
} catch (error) {
  console.log("nodemailer_verify=failed");
  if (error && typeof error === "object") {
    const smtpError = error;
    if ("code" in smtpError) console.log(`nodemailer_code=${smtpError.code}`);
    if ("command" in smtpError) console.log(`nodemailer_command=${smtpError.command}`);
    if ("responseCode" in smtpError) console.log(`nodemailer_response_code=${smtpError.responseCode}`);
  }
  console.log(`nodemailer_error=${error instanceof Error ? error.message : String(error)}`);
}
NODE
