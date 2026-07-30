import {
  followedAcademicScopeKey,
  normalizeFollowedAcademicScope,
  type AcademicUnitSuggestionRecord,
  type AcademicUnitSuggestionStatus,
  type FollowedAcademicScopeRecord,
  type UserDataRepository
} from "../../src/modules/users/user-data.types.js";

const TEST_CLOCK_EPOCH = Date.parse("2026-01-01T00:00:00.000Z");

export class TestUserDataRepository implements UserDataRepository {
  private readonly suggestions = new Map<string, AcademicUnitSuggestionRecord>();
  private readonly followedScopes = new Map<string, FollowedAcademicScopeRecord>();
  private readonly followedScopeIdsByKey = new Map<string, string>();
  private sequence = 0;

  async createAcademicUnitSuggestion(
    input: Omit<AcademicUnitSuggestionRecord, "id" | "status" | "createdAt" | "reviewedAt">
  ): Promise<AcademicUnitSuggestionRecord> {
    const identity = this.nextIdentity("suggestion");
    const suggestion: AcademicUnitSuggestionRecord = {
      ...identity,
      ...input,
      status: "pending"
    };
    this.suggestions.set(suggestion.id, suggestion);
    return cloneSuggestion(suggestion);
  }

  async findAcademicUnitSuggestionById(id: string): Promise<AcademicUnitSuggestionRecord | null> {
    const suggestion = this.suggestions.get(id);
    return suggestion ? cloneSuggestion(suggestion) : null;
  }

  async listAcademicUnitSuggestions(status: AcademicUnitSuggestionStatus): Promise<AcademicUnitSuggestionRecord[]> {
    return [...this.suggestions.values()]
      .filter((suggestion) => suggestion.status === status)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))
      .map(cloneSuggestion);
  }

  async updateAcademicUnitSuggestionReview(
    id: string,
    input: { status: "approved" | "rejected"; reviewedAt: Date }
  ): Promise<AcademicUnitSuggestionRecord | null> {
    const suggestion = this.suggestions.get(id);
    if (!suggestion) return null;
    const reviewed: AcademicUnitSuggestionRecord = {
      ...suggestion,
      status: input.status,
      reviewedAt: new Date(input.reviewedAt)
    };
    this.suggestions.set(id, reviewed);
    return cloneSuggestion(reviewed);
  }

  async upsertFollowedAcademicScope(
    input: Omit<FollowedAcademicScopeRecord, "id" | "createdAt">
  ): Promise<FollowedAcademicScopeRecord> {
    const scope = normalizeFollowedAcademicScope(input);
    const normalizedInput = { userId: input.userId, ...scope };
    const key = `${input.userId}:${followedAcademicScopeKey(scope)}`;
    const existingId = this.followedScopeIdsByKey.get(key);
    if (existingId) {
      const existing = this.followedScopes.get(existingId);
      if (existing) return cloneFollowedScope(existing);
    }

    const identity = this.nextIdentity("followed-scope");
    const followedScope: FollowedAcademicScopeRecord = {
      ...identity,
      ...normalizedInput
    };
    this.followedScopes.set(followedScope.id, followedScope);
    this.followedScopeIdsByKey.set(key, followedScope.id);
    return cloneFollowedScope(followedScope);
  }

  async listFollowedAcademicScopesByUserId(userId: string): Promise<FollowedAcademicScopeRecord[]> {
    return [...this.followedScopes.values()]
      .filter((scope) => scope.userId === userId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
      .map(cloneFollowedScope);
  }

  async deleteUserData(userId: string): Promise<void> {
    for (const [id, suggestion] of this.suggestions) {
      if (suggestion.userId === userId) this.suggestions.delete(id);
    }
    for (const [id, scope] of this.followedScopes) {
      if (scope.userId !== userId) continue;
      this.followedScopes.delete(id);
      const key = `${scope.userId}:${followedAcademicScopeKey(scope)}`;
      this.followedScopeIdsByKey.delete(key);
    }
  }

  private nextIdentity(prefix: string): { id: string; createdAt: Date } {
    this.sequence += 1;
    return {
      id: `${prefix}-${String(this.sequence).padStart(6, "0")}`,
      createdAt: new Date(TEST_CLOCK_EPOCH + this.sequence)
    };
  }
}

function cloneSuggestion(suggestion: AcademicUnitSuggestionRecord): AcademicUnitSuggestionRecord {
  return {
    ...suggestion,
    createdAt: new Date(suggestion.createdAt),
    ...(suggestion.reviewedAt ? { reviewedAt: new Date(suggestion.reviewedAt) } : {})
  };
}

function cloneFollowedScope(scope: FollowedAcademicScopeRecord): FollowedAcademicScopeRecord {
  return { ...scope, createdAt: new Date(scope.createdAt) };
}
