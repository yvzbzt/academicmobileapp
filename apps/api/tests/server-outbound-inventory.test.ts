import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const approvedFetchBoundary = "common/network/safe-outbound-request.ts";

describe("server outbound transport inventory", () => {
  it("rejects executable fetch calls outside the approved safe network boundary", () => {
    const violations: string[] = [];
    for (const filePath of listTypeScriptFiles(sourceRoot)) {
      const relativePath = path.relative(sourceRoot, filePath).replaceAll("\\", "/");
      const sourceText = readFileSync(filePath, "utf8");
      const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      visit(sourceFile, (node) => {
        if (!ts.isCallExpression(node) || !isFetchExpression(node.expression)) return;
        if (relativePath === approvedFetchBoundary) return;
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push(`${relativePath}:${position.line + 1}:${position.character + 1}`);
      });
    }

    // This browser-side call is shipped as inert HTML text. TypeScript's AST
    // correctly does not classify it as executable server code.
    const publicPageSource = readFileSync(path.join(sourceRoot, "modules/public/public-pages.controller.ts"), "utf8");
    expect(publicPageSource).toContain("const response = await fetch(url");
    expect(violations).toEqual([]);
  });

  it("rejects every invalid-certificate switch or insecure TLS option in API source", () => {
    const forbiddenPatterns: Array<[string, RegExp]> = [
      ["invalid TLS option", new RegExp(["allow", "Invalid", "Tls"].join(""), "u")],
      ["invalid TLS environment switch", new RegExp(["ANNOUNCEMENT", "ALLOW", "INVALID", "TLS"].join("_"), "u")],
      ["process-wide TLS bypass", new RegExp(["NODE", "TLS", "REJECT", "UNAUTHORIZED"].join("_"), "u")],
      ["Node TLS verification override", new RegExp(["reject", "Unauthorized"].join(""), "u")],
      ["request-library TLS bypass", /strictSSL\s*:\s*false/u]
    ];
    const violations: string[] = [];
    for (const filePath of listTypeScriptFiles(sourceRoot)) {
      const relativePath = path.relative(sourceRoot, filePath).replaceAll("\\", "/");
      const sourceText = readFileSync(filePath, "utf8");
      for (const [label, pattern] of forbiddenPatterns) {
        if (pattern.test(sourceText)) violations.push(`${relativePath}: ${label}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

function visit(node: ts.Node, visitor: (candidate: ts.Node) => void): void {
  visitor(node);
  node.forEachChild((child) => visit(child, visitor));
}

function isFetchExpression(expression: ts.Expression): boolean {
  if (
    ts.isParenthesizedExpression(expression)
    || ts.isNonNullExpression(expression)
    || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isSatisfiesExpression(expression)
  ) {
    return isFetchExpression(expression.expression);
  }
  if (ts.isIdentifier(expression)) return expression.text === "fetch";
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text === "fetch";
  return ts.isElementAccessExpression(expression)
    && ts.isStringLiteral(expression.argumentExpression)
    && expression.argumentExpression.text === "fetch";
}
