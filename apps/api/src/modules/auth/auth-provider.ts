export type AuthProvider =
  | "password"
  | "google"
  | "apple"
  | "password_google"
  | "password_apple"
  | "google_apple"
  | "password_google_apple";

export type AuthFactor = "password" | "google" | "apple";

const AUTH_FACTOR_ORDER = ["password", "google", "apple"] as const;

export function authProviderSupports(provider: AuthProvider | undefined, factor: AuthFactor): boolean {
  if (!provider) return factor === "password";
  return provider.split("_").includes(factor);
}

export function linkedAuthProvider(provider: AuthProvider | undefined, factor: AuthFactor): AuthProvider {
  const factors = new Set<AuthFactor>(provider ? provider.split("_") as AuthFactor[] : ["password"]);
  factors.add(factor);
  return AUTH_FACTOR_ORDER.filter((candidate) => factors.has(candidate)).join("_") as AuthProvider;
}
