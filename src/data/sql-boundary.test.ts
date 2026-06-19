// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// DATA-02 boundary: only src/db/ and src/data/ may import drizzle or the schema.
// No component or App.tsx may touch SQL. This lint-style test enforces it.

const SRC = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const FORBIDDEN = /from\s+["'](drizzle-orm[^"']*|(\.\.?\/)+db\/(schema|client))["']/;

describe("DATA-02 SQL boundary", () => {
  it("App.tsx does not import drizzle or db/{schema,client}", () => {
    const appPath = join(SRC, "App.tsx");
    const code = readFileSync(appPath, "utf8");
    expect(FORBIDDEN.test(code)).toBe(false);
  });

  it("no file under src/components/ imports drizzle or db/{schema,client}", () => {
    const files = walk(join(SRC, "components"));
    const offenders = files.filter((f) =>
      FORBIDDEN.test(readFileSync(f, "utf8"))
    );
    expect(offenders).toEqual([]);
  });
});
