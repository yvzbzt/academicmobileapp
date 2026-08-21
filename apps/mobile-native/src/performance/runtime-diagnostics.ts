type RuntimeDiagnosticValue = string | number | boolean | null | undefined;

const RUNTIME_DIAGNOSTICS_ENABLED =
  process.env.EXPO_PUBLIC_RUNTIME_DIAGNOSTICS === "1";

let diagnosticSequence = 0;

export function nextRuntimeDiagnosticId(): number {
  diagnosticSequence += 1;
  return diagnosticSequence;
}

export function runtimeDiagnostic(
  event: string,
  details: Readonly<Record<string, RuntimeDiagnosticValue>> = {},
): void {
  if (!RUNTIME_DIAGNOSTICS_ENABLED) return;

  // Deliberately exclude request bodies, credentials, and owner identifiers.
  console.info(`[runtime] ${event} ${JSON.stringify(details)}`);
}
