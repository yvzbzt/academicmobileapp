import { readFile } from "node:fs/promises";
import type { SourceAuthorityContext } from "../domain/source-authority-enforcement.js";
import type { SourceAuthorityScopeType } from "../domain/source-authority-policy.js";
import {
  buildSourceScopeOwnershipIndex,
  resolveSourceScopeOwnership,
  type ResolvedSourceScopeOwnership,
  type SourceScopeOwnershipIndex
} from "../domain/source-scope-ownership.js";
import { findVerifiedSourceAuthority } from "./verified-source-registry.js";

const yokScopeIds = new Set(["yok-council-of-higher-education", "yok"]);
let scopeOwnershipCache: Promise<SourceScopeOwnershipIndex> | null = null;

export interface ResolveSourceAuthorityContextInput {
  universityId: string;
  ownerAcademicEntityId: string;
  scopeType: SourceAuthorityScopeType;
  scopeId: string;
}

export interface ResolvedSourceAuthorityContext {
  context: SourceAuthorityContext;
  authorityStatus: "verified" | "quarantined";
  reasonCodes: readonly string[];
}

export async function resolveSourceAuthorityContext(
  input: ResolveSourceAuthorityContextInput
): Promise<ResolvedSourceAuthorityContext> {
  if (input.scopeType === "university" && yokScopeIds.has(input.scopeId)) {
    return {
      context: buildContext(input, [], {
        resolvedOwnerAcademicEntityId: input.scopeId,
        resolvedOwnerUniversityId: input.scopeId
      }),
      authorityStatus: "verified",
      reasonCodes: []
    };
  }

  const [authority, scopeOwnership] = await Promise.all([
    findVerifiedSourceAuthority(input.universityId),
    loadSourceScopeOwnership()
  ]);
  const resolvedOwnership = resolveSourceScopeOwnership(scopeOwnership, {
    scopeType: input.scopeType,
    scopeId: input.scopeId
  });
  if (authority) {
    return {
      context: buildContext(
        input,
        authority.status === "verified" ? authority.authorityDomains : [],
        resolvedOwnership
      ),
      authorityStatus: authority.status,
      reasonCodes: [...authority.reasonCodes].sort()
    };
  }

  return {
    context: buildContext(input, [], resolvedOwnership),
    authorityStatus: "quarantined",
    reasonCodes: ["owner_evidence_missing"]
  };
}

function buildContext(
  input: ResolveSourceAuthorityContextInput,
  authorityDomains: readonly string[],
  resolvedOwnership: ResolvedSourceScopeOwnership
): SourceAuthorityContext {
  return {
    ownerAcademicEntityId: input.ownerAcademicEntityId,
    ownerUniversityId: input.universityId,
    resolvedOwnerAcademicEntityId: resolvedOwnership.resolvedOwnerAcademicEntityId,
    resolvedOwnerUniversityId: resolvedOwnership.resolvedOwnerUniversityId,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    authorityDomains
  };
}

async function loadSourceScopeOwnership(): Promise<SourceScopeOwnershipIndex> {
  scopeOwnershipCache ??= readFile(new URL("./turkiye-catalog-seed.json", import.meta.url), "utf8")
    .then((raw) => buildSourceScopeOwnershipIndex(JSON.parse(raw.replace(/^\uFEFF/u, "")) as unknown))
    .catch(() => buildSourceScopeOwnershipIndex(null));
  return scopeOwnershipCache;
}
