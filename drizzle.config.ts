import { defineConfig } from "drizzle-kit";

// Generate-only: drizzle-kit produces SQL from the schema; the Tauri SQL plugin
// applies it Rust-side via add_migrations. Do NOT run push/migrate/studio —
// they cannot reach the proxy DB and would create a stray dev file.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./src-tauri/migrations",
});
