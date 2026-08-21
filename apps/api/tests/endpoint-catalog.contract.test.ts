import { RequestMethod, type Type } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it } from "vitest";
import type { UserRole } from "../../../packages/shared/src/contracts.js";
import { AppModule } from "../src/app.module.js";
import { ROLES_KEY } from "../src/common/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../src/common/guards/jwt-auth.guard.js";
import { endpointCatalog, type EndpointContract } from "../src/contracts/endpoint-catalog.js";

const allAuthenticatedRoles: UserRole[] = ["student", "content_editor", "university_admin", "super_admin"];
const requestMethods: Partial<Record<RequestMethod, EndpointContract["method"]>> = {
  [RequestMethod.GET]: "GET",
  [RequestMethod.POST]: "POST",
  [RequestMethod.PUT]: "PUT",
  [RequestMethod.PATCH]: "PATCH",
  [RequestMethod.DELETE]: "DELETE"
};

type RouteSurface = Pick<EndpointContract, "method" | "path" | "authRequired" | "roles">;

describe("endpoint catalog contract", () => {
  it("matches every controller route registered by AppModule", () => {
    const controllerSurface = collectControllerSurface();
    const catalogSurface = endpointCatalog.map(({ method, path, authRequired, roles }) => ({
      method,
      path,
      authRequired,
      roles
    }));

    expect(sortSurface(catalogSurface)).toEqual(sortSurface(controllerSurface));
  });

  it("contains no duplicate or shadowed method/path contracts", () => {
    const exactKeys = endpointCatalog.map(routeKey);
    const structuralKeys = endpointCatalog.map((endpoint) => `${endpoint.method} ${canonicalPath(endpoint.path)}`);

    expect(findDuplicates(exactKeys)).toEqual([]);
    expect(findDuplicates(structuralKeys)).toEqual([]);

    const shadowed: string[] = [];
    endpointCatalog.forEach((candidate, candidateIndex) => {
      endpointCatalog.slice(0, candidateIndex).forEach((earlier) => {
        if (earlier.method === candidate.method && earlier.path !== candidate.path && routePatternMatches(earlier.path, candidate.path)) {
          shadowed.push(`${routeKey(earlier)} shadows ${routeKey(candidate)}`);
        }
      });
    });

    expect(shadowed).toEqual([]);
  });

  it("keeps authentication metadata internally consistent", () => {
    for (const endpoint of endpointCatalog) {
      expect(endpoint.path, routeKey(endpoint)).toMatch(/^\/(?!.*\/\/)(?:.*[^/])?$/);
      expect(endpoint.authRequired, routeKey(endpoint)).toBe(endpoint.roles !== "public");
      if (endpoint.roles !== "public") expect(endpoint.roles.length, routeKey(endpoint)).toBeGreaterThan(0);
    }
  });

  it("assigns operational probes and expensive jobs to explicit limits", () => {
    expect(policyFor("GET", "/health/live")).toBe("none");
    expect(policyFor("GET", "/health/ready")).toBe("none");
    expect(policyFor("POST", "/admin/pdf-sources")).toBe("upload");

    const expensiveJobs: Array<[EndpointContract["method"], string]> = [
      ["POST", "/admin/pdf-sources/:id/process"],
      ["POST", "/admin/announcements/sources/:id/ingest"],
      ["POST", "/admin/announcements/discover"],
      ["POST", "/admin/announcements/ingest"],
      ["POST", "/admin/calendars/ingest"],
      ["POST", "/admin/notification-jobs/process-due"]
    ];

    for (const [method, path] of expensiveJobs) expect(policyFor(method, path), `${method} ${path}`).toBe("strict");
  });
});

function collectControllerSurface(): RouteSurface[] {
  const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AppModule) as Type<unknown>[] | undefined;
  if (!controllers) throw new Error("AppModule controller metadata is unavailable.");

  return controllers.flatMap((controller) => {
    const controllerPaths = metadataPaths(Reflect.getMetadata(PATH_METADATA, controller));
    const controllerGuards = metadataGuards(controller);
    const controllerRoles = Reflect.getMetadata(ROLES_KEY, controller) as UserRole[] | undefined;

    return Object.getOwnPropertyNames(controller.prototype).flatMap((methodName): RouteSurface[] => {
      if (methodName === "constructor") return [];
      const handler = controller.prototype[methodName as keyof typeof controller.prototype];
      if (typeof handler !== "function") return [];

      const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (requestMethod === undefined) return [];
      const method = requestMethods[requestMethod];
      if (!method) throw new Error(`Unsupported request method on ${controller.name}.${methodName}.`);

      const methodPaths = metadataPaths(Reflect.getMetadata(PATH_METADATA, handler));
      const methodGuards = metadataGuards(handler);
      const authRequired = [...controllerGuards, ...methodGuards].includes(JwtAuthGuard);
      const methodRoles = Reflect.getMetadata(ROLES_KEY, handler) as UserRole[] | undefined;
      const roles = authRequired ? (methodRoles ?? controllerRoles ?? allAuthenticatedRoles) : "public";

      return controllerPaths.flatMap((controllerPath) => methodPaths.map((methodPath) => ({
        method,
        path: joinPaths(controllerPath, methodPath),
        authRequired,
        roles
      })));
    });
  });
}

function metadataPaths(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [typeof value === "string" ? value : ""];
}

function metadataGuards(target: object): unknown[] {
  const guards = Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined;
  return guards ?? [];
}

function joinPaths(controllerPath: string, methodPath: string): string {
  const segments = [controllerPath, methodPath].flatMap((part) => part.split("/").filter(Boolean));
  return `/${segments.join("/")}`;
}

function sortSurface(surface: RouteSurface[]): RouteSurface[] {
  return surface
    .map((endpoint) => ({
      ...endpoint,
      roles: endpoint.roles === "public" ? endpoint.roles : [...endpoint.roles].sort()
    }))
    .sort((left, right) => routeKey(left).localeCompare(routeKey(right)));
}

function routeKey(endpoint: Pick<EndpointContract, "method" | "path">): string {
  return `${endpoint.method} ${endpoint.path}`;
}

function canonicalPath(path: string): string {
  return path
    .split("/")
    .map((segment) => segment.startsWith(":") ? `:${segment.includes(".") ? segment.slice(segment.indexOf(".")) : "param"}` : segment)
    .join("/");
}

function findDuplicates(values: string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort();
}

function routePatternMatches(pattern: string, candidate: string): boolean {
  const patternParts = pattern.split("/").filter(Boolean);
  const candidateParts = candidate.split("/").filter(Boolean);
  if (patternParts.length !== candidateParts.length) return false;
  return patternParts.every((part, index) => part.startsWith(":") || part === candidateParts[index]);
}

function policyFor(method: EndpointContract["method"], path: string): EndpointContract["rateLimit"] | undefined {
  return endpointCatalog.find((endpoint) => endpoint.method === method && endpoint.path === path)?.rateLimit;
}
