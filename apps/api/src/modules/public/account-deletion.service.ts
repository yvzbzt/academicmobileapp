import { Injectable, Inject, UnauthorizedException } from "@nestjs/common";
import { randomInt } from "node:crypto";
import type { AuthRepository, AuthUserRecord } from "../auth/auth.types.js";
import { EmailVerificationSenderService } from "../auth/email-verification-sender.service.js";
import { PasswordHasher } from "../auth/password-hasher.js";
import { TokenService } from "../auth/token.service.js";
import { UsersService } from "../users/users.service.js";

export interface AccountDeletionRequestResult {
  status: "verification_sent";
  email: string;
  verificationExpiresAt: string;
}

export interface AccountDeletionConfirmResult {
  status: "completed";
  deletionType: "data" | "account";
}

const TOKEN_PURPOSE = "account-deletion";
const CODE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class AccountDeletionService {
  constructor(
    @Inject("AuthRepository") private readonly authRepository: AuthRepository,
    @Inject(PasswordHasher) private readonly passwordHasher: PasswordHasher,
    @Inject(TokenService) private readonly tokenService: TokenService,
    @Inject(EmailVerificationSenderService) private readonly emailVerificationSender: EmailVerificationSenderService,
    @Inject(UsersService) private readonly usersService: UsersService
  ) {}

  async requestCode(input: { email: string; password: string }): Promise<AccountDeletionRequestResult> {
    const user = await this.verifyPasswordCredentials(input.email, input.password);
    const code = issueSixDigitCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);

    await this.authRepository.createEmailVerificationToken({
      userId: user.id,
      tokenHash: this.hashDeletionCode(user.id, code),
      expiresAt,
      resendAvailableAt: new Date(Date.now() + 60 * 1000)
    });

    await this.emailVerificationSender.sendAccountDeletionVerificationEmail({
      email: user.email,
      fullName: user.fullName,
      code,
      expiresAt
    });

    return {
      status: "verification_sent",
      email: user.email,
      verificationExpiresAt: expiresAt.toISOString()
    };
  }

  async confirm(input: { email: string; password: string; code: string; deletionType: "data" | "account" }): Promise<AccountDeletionConfirmResult> {
    const user = await this.verifyPasswordCredentials(input.email, input.password);
    const record = await this.authRepository.findEmailVerificationTokenByHash(this.hashDeletionCode(user.id, input.code.trim()));

    if (!record || record.userId !== user.id || record.consumedAt) throw new UnauthorizedException("Dogrulama kodu gecersiz.");
    if (record.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException("Dogrulama kodunun suresi dolmus.");

    await this.authRepository.consumeEmailVerificationToken(record.id, new Date());

    if (input.deletionType === "account") {
      await this.usersService.deleteMe(user.id, { deleteData: true });
    } else {
      await this.usersService.deleteMyData(user.id);
    }

    return {
      status: "completed",
      deletionType: input.deletionType
    };
  }

  private async verifyPasswordCredentials(email: string, password: string): Promise<AuthUserRecord> {
    const user = await this.authRepository.findUserByEmail(email.trim().toLocaleLowerCase("tr-TR"));
    if (!user || user.status === "locked") throw new UnauthorizedException("E-posta veya sifre dogru degil.");

    const passwordMatches = await this.passwordHasher.verify(password, user.passwordHash);
    if (!passwordMatches) throw new UnauthorizedException("E-posta veya sifre dogru degil.");
    return user;
  }

  private hashDeletionCode(userId: string, code: string): string {
    return this.tokenService.hashPurposeBoundCode(TOKEN_PURPOSE, userId, code);
  }
}

function issueSixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
