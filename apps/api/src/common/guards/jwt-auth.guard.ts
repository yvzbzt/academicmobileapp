import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { TokenService } from "../../modules/auth/token.service.js";

type RequestWithUser = Request & {
  user?: {
    id: string;
    email: string;
    role: "student" | "content_editor" | "university_admin" | "super_admin";
  };
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(TokenService) private readonly tokenService: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) throw new UnauthorizedException("Missing bearer token.");

    const token = authorization.slice("Bearer ".length).trim();
    try {
      const payload = this.tokenService.verifyAccessToken(token);
      request.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role
      };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid bearer token.");
    }
  }
}
