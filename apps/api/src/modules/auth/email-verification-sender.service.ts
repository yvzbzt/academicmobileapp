import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import nodemailer from "nodemailer";

export interface SendVerificationEmailInput {
  email: string;
  fullName: string;
  code: string;
  expiresAt: Date;
}

export type SendPasswordRecoveryEmailInput = SendVerificationEmailInput;

@Injectable()
export class EmailVerificationSenderService {
  private readonly logger = new Logger(EmailVerificationSenderService.name);

  async sendVerificationEmail(input: SendVerificationEmailInput): Promise<void> {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT ?? 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const secure = process.env.SMTP_SECURE === "true";
    const from = process.env.MAIL_FROM ?? "noreply@akademik-takvim.local";

    if (!host || !user || !pass) {
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException("Dogrulama e-postasi su anda gonderilemedi.");
      }
      this.logger.warn("SMTP is not configured. Verification email was not sent in this non-production environment.");
      return;
    }

    const transport = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
    const expiresText = input.expiresAt.toISOString();

    await transport.sendMail({
      from,
      to: input.email,
      subject: "Ogrenci e-posta dogrulama kodu",
      text: `Merhaba ${input.fullName},\n\nDogrulama kodunuz: ${input.code}\n\nBu kod ${expiresText} tarihinde sona erer.\n`,
      html: `<p>Merhaba ${escapeHtml(input.fullName)},</p><p>Dogrulama kodunuz:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${escapeHtml(input.code)}</p><p>Bu kod ${escapeHtml(expiresText)} tarihinde sona erer.</p>`
    });
  }

  async sendAccountDeletionVerificationEmail(input: SendVerificationEmailInput): Promise<void> {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT ?? 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const secure = process.env.SMTP_SECURE === "true";
    const from = process.env.MAIL_FROM ?? "noreply@akademik-takvim.local";

    if (!host || !user || !pass) {
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException("Dogrulama e-postasi su anda gonderilemedi.");
      }
      this.logger.warn("SMTP is not configured. Account deletion email was not sent in this non-production environment.");
      return;
    }

    const transport = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
    const expiresText = input.expiresAt.toISOString();

    await transport.sendMail({
      from,
      to: input.email,
      subject: "Akademik Takvim hesap ve veri silme dogrulama kodu",
      text: `Merhaba ${input.fullName},\n\nAkademik Takvim hesap ve veri silme dogrulama kodunuz: ${input.code}\n\nBu kod ${expiresText} tarihinde sona erer. Bu islemi sen baslatmadiysan bu e-postayi yok sayabilirsin.\n`,
      html: `<p>Merhaba ${escapeHtml(input.fullName)},</p><p>Akademik Takvim hesap ve veri silme dogrulama kodunuz:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${escapeHtml(input.code)}</p><p>Bu kod ${escapeHtml(expiresText)} tarihinde sona erer.</p><p>Bu islemi sen baslatmadiysan bu e-postayi yok sayabilirsin.</p>`
    });
  }

  async sendPasswordRecoveryEmail(input: SendPasswordRecoveryEmailInput): Promise<void> {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT ?? 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const secure = process.env.SMTP_SECURE === "true";
    const from = process.env.MAIL_FROM ?? "noreply@akademik-takvim.local";

    if (!host || !user || !pass) {
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException("Sifre yenileme e-postasi su anda gonderilemedi.");
      }
      this.logger.warn("SMTP is not configured. Password recovery email was not sent in this non-production environment.");
      return;
    }

    const transport = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
    const expiresText = input.expiresAt.toISOString();

    await transport.sendMail({
      from,
      to: input.email,
      subject: "Akademik Takvim sifre yenileme kodu",
      text: `Merhaba ${input.fullName},\n\nSifre yenileme kodunuz: ${input.code}\n\nBu kod ${expiresText} tarihinde sona erer. Bu islemi sen baslatmadiysan bu e-postayi yok sayabilirsin.\n`,
      html: `<p>Merhaba ${escapeHtml(input.fullName)},</p><p>Sifre yenileme kodunuz:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${escapeHtml(input.code)}</p><p>Bu kod ${escapeHtml(expiresText)} tarihinde sona erer.</p><p>Bu islemi sen baslatmadiysan bu e-postayi yok sayabilirsin.</p>`
    });
  }
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
