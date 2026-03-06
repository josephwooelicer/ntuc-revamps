import fs from "node:fs";
import path from "node:path";

export async function GET() {
  const dbPath = process.env.SQLITE_DB_PATH || "./data/ntuc-ews.db";
  const rawPath = process.env.DATA_LAKE_RAW_PATH || "./data-lake/raw";
  const resolvedDbPath = path.resolve(process.cwd(), "..", dbPath);
  const resolvedRawPath = path.resolve(process.cwd(), "..", rawPath);

  const health = {
    status: "ok",
    service: "web-platform",
    db: fs.existsSync(resolvedDbPath),
    storage: fs.existsSync(resolvedRawPath),
    timestamp: new Date().toISOString()
  };

  return Response.json(health);
}
