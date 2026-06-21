// Drizzle sqlite-proxy ↔ @tauri-apps/plugin-sql wiring (RESEARCH.md Pattern 1).
// This is the ONE hard boundary in the project: Drizzle builds SQL+params in the
// WebView; the proxy callback forwards them to the plugin (sqlx in the Rust core).
import { drizzle } from "drizzle-orm/sqlite-proxy";
import Database from "@tauri-apps/plugin-sql";
import * as schema from "./schema";

// MUST be byte-identical to DB_URL in src-tauri/src/lib.rs and the
// plugins.sql.preload string in tauri.conf.json (RESEARCH.md Pitfall 2).
export const DB_URL = "sqlite:leancrm.db";

let conn: Database | null = null;
async function getConn(): Promise<Database> {
  // One cached connection — do NOT open/close per query (slow + race-prone).
  if (!conn) conn = await Database.load(DB_URL);
  return conn;
}

const isSelect = (sql: string) => /^\s*SELECT\b/i.test(sql);

export const db = drizzle<typeof schema>(
  async (sql, params, method) => {
    const c = await getConn();
    if (isSelect(sql)) {
      const rows = await c.select<Record<string, unknown>[]>(sql, params);
      // LANDMINE (RESEARCH.md Pitfall 1): plugin-sql.select() returns row
      // OBJECTS, but Drizzle's proxy contract expects each row as a positional
      // array of VALUES. Skipping this map yields silently wrong/empty results.
      const valueRows = rows.map((r) => Object.values(r));
      return { rows: method === "all" ? valueRows : valueRows[0] };
    }
    await c.execute(sql, params); // INSERT/UPDATE/DELETE/CREATE
    return { rows: [] };
  },
  { schema, logger: import.meta.env.DEV }
);
