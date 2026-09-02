import {
  sourceAuthorityPolicy,
  type SourceAuthorityBoundary,
  type SourceAuthorityDecision,
  type SourceAuthorityResource,
  type SourceAuthorityScopeType
} from "./source-authority-policy.js";

export interface SourceAuthorityContext {
  ownerAcademicEntityId: string | null;
  ownerUniversityId: string | null;
  resolvedOwnerAcademicEntityId: string | null;
  resolvedOwnerUniversityId: string | null;
  scopeType: SourceAuthorityScopeType | null;
  scopeId: string | null;
  authorityDomains: readonly string[] | null;
}

export interface SourceAuthorityCheck {
  boundary: SourceAuthorityBoundary;
  resource: SourceAuthorityResource;
  url: string;
  finalRedirectUrl?: string | null;
}

export class SourceAuthorityError extends Error {
  readonly decision: SourceAuthorityDecision;

  constructor(decision: SourceAuthorityDecision) {
    super(`SOURCE_AUTHORITY_${decision.reasonCode.toLocaleUpperCase("en-US")}`);
    this.name = "SourceAuthorityError";
    this.decision = decision;
  }
}

export function evaluateSourceAuthority(
  context: SourceAuthorityContext,
  check: SourceAuthorityCheck
): SourceAuthorityDecision {
  return sourceAuthorityPolicy.evaluate({
    ...context,
    ...check
  });
}

export function requireSourceAuthority(
  context: SourceAuthorityContext,
  check: SourceAuthorityCheck
): SourceAuthorityDecision {
  const decision = evaluateSourceAuthority(context, check);
  if (!decision.allowed) throw new SourceAuthorityError(decision);
  return decision;
}
