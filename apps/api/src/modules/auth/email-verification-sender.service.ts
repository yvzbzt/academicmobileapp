import { Injectable, Logger } from "@nestjs/common";
import nodemailer from "nodemailer";

export interface SendVerificationEmailInput {
  email: string;
  fullName: string;
  verifyUrl: string;
  expiresAt: Date;
}

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
      this.logger.warn("SMTP is not configured. Verification link is logged for development use.");
      this.logger.log(`VERIFY_EMAIL_LINK ${input.email} ${input.verifyUrl}`);
      return;
    }

    const transport = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
    const expiresText = input.expiresAt.toISOString();

    await transport.sendMail({
      from,
      to: input.email,
      subject: "Ogrenci e-posta dogrulama",
      text: `Merhaba ${input.fullName},\n\nHesabinizi aktif etmek icin su baglantiya tiklayin:\n${input.verifyUrl}\n\nBu baglanti ${expiresText} tarihinde sona erer.\n`,
      html: `<p>Merhaba ${escapeHtml(input.fullName)},</p><p>Hesabinizi aktif etmek icin <a href="${escapeHtml(input.verifyUrl)}">buraya tiklayin</a>.</p><p>Bu baglanti ${escapeHtml(expiresText)} tarihinde sona erer.</p>`
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
