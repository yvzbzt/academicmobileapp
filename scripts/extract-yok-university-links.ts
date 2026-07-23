import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const defaultInputPath = resolve(process.cwd(), "Y\u00d6K \u00dcniversiteler.txt");
const inputPath = resolve(process.cwd(), process.env.YOK_UNIVERSITY_LINK_INPUT ?? process.argv[2] ?? defaultInputPath);
const outputPath = resolve(process.cwd(), process.env.YOK_UNIVERSITY_LINK_OUTPUT ?? process.argv[3] ?? "data/yok-university-links.json");

const sourceText = await readFile(inputPath, "utf8");
const links = extractUniversityLinks(sourceText);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(links, null, 2)}\n`, "utf8");

console.log(`Extracted ${links.length} university links from ${inputPath}`);
console.log(`Wrote ${outputPath}`);

export function extractUniversityLinks(source: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const linkPattern = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/giu;

  for (const match of source.matchAll(linkPattern)) {
    const normalized = normalizeUniversityLink(match[0]);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    links.push(normalized);
  }

  return links;
}

function normalizeUniversityLink(value: string): string | null {
  let candidate = value.trim().replace(/[),.;:!?]+$/u, "");

  if (candidate.startsWith("www.")) {
    candidate = `https://${candidate}`;
  }

  try {
    const url = new URL(candidate);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    if (!isUniversityHost(url.hostname)) {
      return null;
    }

    url.hash = "";
    url.username = "";
    url.password = "";
    url.hostname = url.hostname.toLowerCase();

    return url.toString();
  } catch {
    return null;
  }
}

function isUniversityHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized.endsWith(".edu.tr") || normalized.endsWith(".edu");
}
