import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { AuthRepository, RecentAuthenticationPurpose } from "../../modules/auth/auth.types.js";
import { TokenService, type RecentAuthenticationPayload } from "../../modules/auth/token.service.js";

export const RECENT_AUTHENTICATION_PURPOSE_KEY = "recent_authentication_purpose";

export const RecentAuthenticationFor = (purpose: RecentAuthenticationPurpose) => (
  SetMetadata(RECENT_AUTHENTICATION_PURPOSE_KEY, purpose)
);

type RecentAuthRequest = Request & {
  user?: {
    id: string;
    credentialGeneration: number;
  };
};

@Injectable()
export class RecentAuthGuard implements CanActivate {
  constructor(
    @Inject(TokenService) private readonly tokenService: TokenService,
    @Inject("AuthRepository") private readonly authRepository: AuthRepository,
    @Inject(Reflector) private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RecentAuthRequest>();
    const proofHeader = request.headers["x-recent-authentication"];
    const proof = typeof proofHeader === "string" ? proofHeader.trim() : "";
    if (!proof || !request.user) throw new UnauthorizedException("Recent authentication is required.");

    const purpose = this.reflector.getAllAndOverride<RecentAuthenticationPurpose>(
      RECENT_AUTHENTICATION_PURPOSE_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (purpose !== "delete_personal_data" && purpose !== "delete_account") {
      throw new UnauthorizedException("Recent authentication is not configured for this action.");
    }

    let payload: RecentAuthenticationPayload;
    try {
      payload = this.tokenService.verifyRecentAuthenticationProof(proof);
    } catch {
      throw new UnauthorizedException("Recent authentication is invalid or expired.");
    }

    if (
      payload.sub !== request.user.id
      || payload.credentialGeneration !== request.user.credentialGeneration
      || payload.purpose !== purpose
    ) {
      throw new UnauthorizedException("Recent authentication is invalid or expired.");
    }

    const consumed = await this.authRepository.consumeRecentAuthenticationProof({
      ownerId: request.user.id,
      credentialGeneration: request.user.credentialGeneration,
      purpose,
      jtiDigest: this.tokenService.hashRecentAuthenticationJti(payload.jti),
      consumedAt: new Date()
    });
    if (!consumed) throw new UnauthorizedException("Recent authentication is invalid or expired.");
    return true;
  }
}
