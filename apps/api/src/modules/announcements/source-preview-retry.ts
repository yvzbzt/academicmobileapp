// A single bounded retry for the observed intermittent Selcuk listing timeout.
// Other errors/domains never retry; the same authority-pinned operation is reused.
export async function withSourcePreviewRetry<T>(
  sourceUrl: string,
  timeoutMs: number,
  operation: (timeoutMs: number) => Promise<T>
): Promise<T> {
  try { return await operation(timeoutMs); }
  catch (error) {
    let url: URL;
    try { url = new URL(sourceUrl); } catch { throw error; }
    const eligible = timeoutMs <= 7000 && url.protocol === "https:" && !url.port && !url.username && !url.password
      && ["selcuk.edu.tr", "www.selcuk.edu.tr"].includes(url.hostname)
      && /^\/birim\/tumicerikler\/\d+\/[0-3]\/?$/.test(url.pathname);
    if (!eligible || !(error instanceof Error) || error.message !== "OUTBOUND_REQUEST_TIMEOUT") throw error;
    return operation(10000);
  }
}
