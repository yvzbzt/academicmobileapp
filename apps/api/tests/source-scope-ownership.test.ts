import { describe, expect, it } from "vitest";
import { sourceAuthorityPolicy } from "../src/domain/source-authority-policy.js";
import {
  buildSourceScopeOwnershipIndex,
  resolveSourceScopeOwnership
} from "../src/domain/source-scope-ownership.js";

describe("source scope ownership", () => {
  const catalog = {
    universities: [{
      slug: "owner-university",
      faculties: [{
        slug: "engineering-faculty",
        departments: [{ slug: "computer-engineering" }]
      }]
    }, {
      slug: "claiming-university",
      faculties: []
    }]
  };

  it("resolves faculty and department owners independently from claimed source rows", () => {
    const index = buildSourceScopeOwnershipIndex(catalog);

    expect(resolveSourceScopeOwnership(index, {
      scopeType: "faculty",
      scopeId: "owner-university__engineering-faculty"
    })).toEqual({
      resolvedOwnerAcademicEntityId: "owner-university__engineering-faculty",
      resolvedOwnerUniversityId: "owner-university"
    });
    expect(resolveSourceScopeOwnership(index, {
      scopeType: "department",
      scopeId: "owner-university__engineering-faculty__computer-engineering"
    })).toEqual({
      resolvedOwnerAcademicEntityId: "owner-university__engineering-faculty__computer-engineering",
      resolvedOwnerUniversityId: "owner-university"
    });
  });

  it("makes a cross-owner claim and an unknown scope fail closed in the central policy", () => {
    const index = buildSourceScopeOwnershipIndex(catalog);
    const scopeId = "owner-university__engineering-faculty";
    const resolved = resolveSourceScopeOwnership(index, { scopeType: "faculty", scopeId });

    expect(sourceAuthorityPolicy.evaluate({
      boundary: "registration",
      resource: "announcement",
      ownerAcademicEntityId: scopeId,
      ownerUniversityId: "claiming-university",
      ...resolved,
      scopeType: "faculty",
      scopeId,
      authorityDomains: ["claiming.edu.tr"],
      url: "https://claiming.edu.tr/announcements"
    })).toMatchObject({ allowed: false, reasonCode: "owner_university_mismatch" });

    const unknown = resolveSourceScopeOwnership(index, {
      scopeType: "department",
      scopeId: "claiming-university__unknown-faculty__unknown-department"
    });
    expect(unknown).toEqual({
      resolvedOwnerAcademicEntityId: null,
      resolvedOwnerUniversityId: null
    });
  });
});
