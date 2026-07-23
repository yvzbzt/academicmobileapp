import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import nodemailer from "nodemailer";

export interface SendVerificationEmailInput {
  email: string;
  fullName: string;
  code: string;
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
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException("Email delivery is not configured.");
      }
      this.logger.warn("SMTP is not configured. Verification code is logged for development use.");
      this.logger.log(`VERIFY_EMAIL_CODE ${input.email} ${input.code}`);
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
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
