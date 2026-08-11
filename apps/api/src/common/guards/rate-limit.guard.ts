import { HttpException, HttpStatus, Inject, Injectable, Optional, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { endpointCatalog, type EndpointContract } from "../../contracts/endpoint-catalog.js";
import { AUTH_ERROR_CODES } from "../../modules/auth/auth.constants.js";
import { InMemoryRateLimitStore, type RateLimitStore } from "./rate-limit-store.js";
import { resolveClientIp } from "../network/client-ip.js";

const RATE_LIMITS: Record<EndpointContract["rateLimit"], { points: number; windowMs: number }> = {
  none: { points: Number.MAX_SAFE_INTEGER, windowMs: 60000 },
  standard: { points: 120, windowMs: 60000 },
  strict: { points: 10, windowMs: 60000 },
  upload: { points: 20, windowMs: 60000 }
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly fallbackStore = new InMemoryRateLimitStore();

  constructor(@Optional() @Inject("RateLimitStore") private readonly rateLimitStore?: RateLimitStore) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ method?: string; route?: { path?: string }; path?: string; originalUrl?: string; headers?: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }>();
    const policy = findEndpointPolicy(request.method ?? "GET", request.route?.path ?? request.path ?? request.originalUrl ?? "/");
    const limit = RATE_LIMITS[policy?.rateLimit ?? "standard"];
    const key = `${resolveClientIp(request)}:${request.method}:${policy?.path ?? request.route?.path ?? request.path ?? request.originalUrl}`;
    const accepted = await (this.rateLimitStore ?? this.fallbackStore).consume(key, limit);
    if (!accepted) {
      if (policy?.path.startsWith("/auth/")) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: "Too Many Requests",
            errorCode: AUTH_ERROR_CODES.RATE_LIMITED,
            message: "Rate limit exceeded."
          },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
      throw new HttpException("Rate limit exceeded.", HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}

function findEndpointPolicy(method: string, path: string): EndpointContract | undefined {
  return endpointCatalog.find((endpoint) => endpoint.method === method.toUpperCase() && matchesPath(endpoint.path, path));
}

function matchesPath(pattern: string, path: string): boolean {
  const normalizedPath = path.split("?")[0] ?? path;
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = normalizedPath.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, index) => part.startsWith(":") || part === pathParts[index]);
}
