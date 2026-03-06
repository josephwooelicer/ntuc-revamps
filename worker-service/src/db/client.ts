import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolveRepoPath } from "../lib/paths.js";

export function getDbPath() {
  return resolveRepoPath(process.env.SQLITE_DB_PATH || "./data/ntuc-ews.db");
}

export function openDb() {
  const dbPath = getDbPath();
  fs.mkdirSync(resolveRepoPath("./data"), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}
