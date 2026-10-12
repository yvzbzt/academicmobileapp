import { describe, expect, it, vi } from "vitest";
import { readAllAdminSources } from "../../apps/admin/src/academic-source-workbench";

type Api = Parameters<typeof readAllAdminSources>[0];
const items = Array.from({ length: 205 }, (_, index) => ({ id: `source-${index}` }));
const offset = (path: string) => Number(new URL(path, "https://test.invalid").searchParams.get("offset"));

describe("complete admin source pagination", () => {
  it("retains every record with array lookahead pages", async () => {
    const request = vi.fn(async (path: string) => items.slice(offset(path), offset(path) + 101));
    expect(await readAllAdminSources(request as Api)).toEqual(items);
    expect(request.mock.calls.map(([path]) => offset(path))).toEqual([0, 100, 200]);
  });

  it("retains all explicit pages, including a final 101-record page", async () => {
    const request = vi.fn(async (path: string) => ({ items: items.slice(offset(path), offset(path) + 101), hasMore: offset(path) + 101 < items.length }));
    expect(await readAllAdminSources(request as Api)).toEqual(items);
    expect(request.mock.calls.map(([path]) => offset(path))).toEqual([0, 101, 202]);
    expect(await readAllAdminSources(vi.fn(async () => ({ items: items.slice(0, 101), hasMore: false })) as Api)).toHaveLength(101);
  });

  it("reports a server that ignores offsets instead of looping forever", async () => {
    const request = vi.fn(async () => items.slice(0, 101));
    await expect(readAllAdminSources(request as Api)).rejects.toThrow("sayfalaması ilerlemiyor");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
