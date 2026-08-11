export type AccountAuthProvider = "password" | "google" | "password_google";

export type RecentAuthenticationMethod = "password" | "google";

export type DestructiveAccountAction = "data" | "account";

export type RecentAuthenticationPurpose = "delete_personal_data" | "delete_account";

export interface RecentAuthenticationResponse {
  proof: string;
  expiresInSeconds: number;
}

export function normalizeAccountAuthProvider(value: unknown): AccountAuthProvider | undefined {
  return value === "password" || value === "google" || value === "password_google"
    ? value
    : undefined;
}

export function recentAuthenticationPurpose(
  action: DestructiveAccountAction
): RecentAuthenticationPurpose {
  return action === "data" ? "delete_personal_data" : "delete_account";
}

export function recentAuthenticationMethods(
  provider: AccountAuthProvider | undefined,
  googleAvailable: boolean
): RecentAuthenticationMethod[] {
  if (provider === "password") return ["password"];
  if (provider === "google") return googleAvailable ? ["google"] : [];
  if (provider === "password_google") {
    return googleAvailable ? ["password", "google"] : ["password"];
  }

  // Older persisted sessions do not carry the additive auth-provider field.
  // Offer every locally available method and let the owner-bound server proof
  // endpoint reject a method the account does not support.
  return googleAvailable ? ["password", "google"] : ["password"];
}

export function readRecentAuthenticationResponse(value: unknown): RecentAuthenticationResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RECENT_AUTHENTICATION_RESPONSE_INVALID");
  }
  const candidate = value as Partial<RecentAuthenticationResponse>;
  const proof = typeof candidate.proof === "string" ? candidate.proof.trim() : "";
  if (
    !proof
    || typeof candidate.expiresInSeconds !== "number"
    || !Number.isFinite(candidate.expiresInSeconds)
    || candidate.expiresInSeconds <= 0
  ) {
    throw new Error("RECENT_AUTHENTICATION_RESPONSE_INVALID");
  }
  return { proof, expiresInSeconds: candidate.expiresInSeconds };
}

export function recentAuthenticationHeader(proof: string): Record<string, string> {
  const normalizedProof = proof.trim();
  if (!normalizedProof) throw new Error("RECENT_AUTHENTICATION_PROOF_REQUIRED");
  return { "x-recent-authentication": normalizedProof };
}
