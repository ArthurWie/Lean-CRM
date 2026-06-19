// Registers tauri-plugin-sql and materializes the Phase 1 schema into the
// single on-disk SQLite file (clickwise.db) at startup. The Rust-side
// add_migrations IS the schema-push for this architecture — drizzle-kit only
// generates the SQL (it cannot reach the proxy DB). See RESEARCH.md Pattern 2.
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

// DB connection string. MUST be byte-identical to DB_URL in src/db/client.ts
// and to plugins.sql.preload in tauri.conf.json — a mismatch silently creates
// a second file (RESEARCH.md Pitfall 2).
const DB_URL: &str = "sqlite:clickwise.db";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "init_schema",
        sql: include_str!("../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            SqlBuilder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
