import ts from "typescript";

/** Inspect the actual named function; missing/moved boundaries must fail, not slice an empty string. */
export function functionSource(source: string, name: string): string {
  const file = ts.createSourceFile("inspected.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches: ts.FunctionDeclaration[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (matches.length !== 1) throw new Error(`Expected one function named ${name}; found ${matches.length}`);
  return matches[0].getText(file);
}

/** For adjacent derived values/effects, verify both source boundaries before inspecting their ordering. */
export function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start) throw new Error(`Missing or reversed source boundaries: ${startMarker} -> ${endMarker}`);
  return source.slice(start, end);
}
