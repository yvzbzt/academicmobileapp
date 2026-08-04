import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { TokenService } from "../../modules/auth/token.service.js";

type RecentAuthRequest = Request & {
  user?: {
    id: string;
    credentialGeneration: number;
  };
};

@Injectable()
export class RecentAuthGuard implements CanActivate {
  constructor(@Inject(TokenService) private readonly tokenService: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RecentAuthRequest>();
    const proofHeader = request.headers["x-recent-authentication"];
    const proof = Array.isArray(proofHeader) ? proofHeader[0] : proofHeader;
    if (!proof || !request.user) throw new UnauthorizedException("Recent authentication is required.");

    try {
      const payload = this.tokenService.verifyRecentAuthenticationProof(proof);
      if (
        payload.sub !== request.user.id
        || payload.credentialGeneration !== request.user.credentialGeneration
      ) {
        throw new Error("RECENT_AUTHENTICATION_OWNER_MISMATCH");
      }
      return true;
    } catch {
      throw new UnauthorizedException("Recent authentication is invalid or expired.");
    }
  }
}
