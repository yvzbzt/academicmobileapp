import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type { AuthRepository } from "../../modules/auth/auth.types.js";
import { TokenService } from "../../modules/auth/token.service.js";

type RequestWithUser = Request & {
  user?: {
    id: string;
    email: string;
    role: "student" | "content_editor" | "university_admin" | "super_admin";
    credentialGeneration: number;
    universityId?: string;
    facultyId?: string;
    departmentId?: string;
  };
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(TokenService) private readonly tokenService: TokenService,
    @Inject("AuthRepository") private readonly authRepository: AuthRepository
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) throw new UnauthorizedException("Missing bearer token.");

    const token = authorization.slice("Bearer ".length).trim();
    try {
      const payload = this.tokenService.verifyAccessToken(token);
      const currentUser = await this.authRepository.findUserById(payload.sub);
      if (
        !currentUser
        || currentUser.status !== "active"
        || currentUser.credentialGeneration !== payload.credentialGeneration
      ) {
        throw new Error("STALE_ACCESS_TOKEN");
      }
      request.user = {
        id: currentUser.id,
        email: currentUser.email,
        role: currentUser.role,
        credentialGeneration: currentUser.credentialGeneration,
        ...(currentUser.universityId ? { universityId: currentUser.universityId } : {}),
        ...(currentUser.facultyId ? { facultyId: currentUser.facultyId } : {}),
        ...(currentUser.departmentId ? { departmentId: currentUser.departmentId } : {})
      };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid bearer token.");
    }
  }
}
