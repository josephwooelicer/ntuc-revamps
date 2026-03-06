import fs from "node:fs";
import path from "node:path";
import { openDb } from "./client.js";

function getMigrationFiles() {
  const dir = path.resolve(process.cwd(), "src/db/migrations");
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: fs.readFileSync(path.join(dir, file), "utf8") }));
}

export function runMigrations() {
  const db = openDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT current_timestamp
    );
  `);

  const appliedRows = db.prepare("SELECT version FROM schema_migration").all();
  const applied = new Set(appliedRows.map((row) => row.version));

  const files = getMigrationFiles();
  for (const migration of files) {
    if (applied.has(migration.file)) {
      continue;
    }

    try {
      db.exec("BEGIN;");
      db.exec(migration.sql);
      db
        .prepare("INSERT INTO schema_migration (version) VALUES (?)")
        .run(migration.file);
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      db.close();
      throw new Error(`Migration failed: ${migration.file}\n${error.message}`);
    }
  }

  db.close();
}

export function getMigrationStatus() {
  const db = openDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT current_timestamp
    );
  `);

  const applied = db
    .prepare("SELECT version, applied_at FROM schema_migration ORDER BY version")
    .all();

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);

  db.close();

  return { applied, tables };
}
