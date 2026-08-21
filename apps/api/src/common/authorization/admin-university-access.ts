import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "../../modules/auth/auth.types.js";

export type AdminUniversityAccess =
  | { kind: "global" }
  | { kind: "university"; universityId: string };

export function adminUniversityAccessFor(user: AuthenticatedUser): AdminUniversityAccess {
  if (user.role === "super_admin") return { kind: "global" };
  if ((user.role === "university_admin" || user.role === "content_editor") && user.universityId?.trim()) {
    return { kind: "university", universityId: user.universityId };
  }
  throw new ForbiddenException("Admin account is not assigned to a university.");
}

export function assertUniversityTarget(access: AdminUniversityAccess, universityId: string): void {
  if (access.kind === "university" && access.universityId !== universityId) {
    throw new ForbiddenException("University is outside the authenticated admin scope.");
  }
}

export function assertUniversityOwnedRecord(
  access: AdminUniversityAccess,
  universityId: string,
  resourceName: string
): void {
  if (access.kind === "university" && access.universityId !== universityId) {
    throw new NotFoundException(`${resourceName} not found.`);
  }
}
