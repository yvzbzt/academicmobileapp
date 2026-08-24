export type AccountAuthProvider =
  | "password"
  | "google"
  | "apple"
  | "password_google"
  | "password_apple"
  | "google_apple"
  | "password_google_apple";

export type RecentAuthenticationMethod = "password" | "google" | "apple";

export type DestructiveAccountAction = "data" | "account";

export type RecentAuthenticationPurpose = "delete_personal_data" | "delete_account";

export interface RecentAuthenticationResponse {
  proof: string;
  expiresInSeconds: number;
}

export function shouldRefreshSessionAfterRecentAuthenticationFailure(
  status: number,
  errorCode: string | undefined,
): boolean {
  return status === 401 && errorCode !== "AUTH_INVALID_CREDENTIALS";
}

export function recentAuthenticationFailureMessage(
  method: RecentAuthenticationMethod,
  errorCode: string | undefined,
): string | undefined {
  if (errorCode !== "AUTH_INVALID_CREDENTIALS") return undefined;
  if (method === "password") return "Hesap şifren yanlış. Kontrol edip tekrar dene.";
  return method === "google"
    ? "Google hesabın doğrulanamadı. Hesabı yeniden seçip tekrar dene."
    : "Apple hesabın doğrulanamadı. Tekrar deneyebilirsin.";
}

export function normalizeAccountAuthProvider(value: unknown): AccountAuthProvider | undefined {
  return value === "password"
    || value === "google"
    || value === "apple"
    || value === "password_google"
    || value === "password_apple"
    || value === "google_apple"
    || value === "password_google_apple"
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
  googleAvailable: boolean,
  appleAvailable: boolean
): RecentAuthenticationMethod[] {
  const available = new Set<RecentAuthenticationMethod>(["password"]);
  if (googleAvailable) available.add("google");
  if (appleAvailable) available.add("apple");
  if (provider) return provider.split("_").filter((method): method is RecentAuthenticationMethod => (
    available.has(method as RecentAuthenticationMethod)
  ));

  // Older persisted sessions do not carry the additive auth-provider field.
  // Offer every locally available method and let the owner-bound server proof
  // endpoint reject a method the account does not support.
  return [...available];
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
