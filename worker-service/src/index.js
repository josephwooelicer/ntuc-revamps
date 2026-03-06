import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT_WORKER || 4000);
const dbPath = process.env.SQLITE_DB_PATH || "./data/ntuc-ews.db";
const rawPath = process.env.DATA_LAKE_RAW_PATH || "./data-lake/raw";

function checkHealth() {
  const resolvedDbPath = path.resolve(process.cwd(), "..", dbPath);
  const resolvedRawPath = path.resolve(process.cwd(), "..", rawPath);

  return {
    status: "ok",
    service: "worker-service",
    db: fs.existsSync(resolvedDbPath),
    storage: fs.existsSync(resolvedRawPath),
    scheduler: "idle",
    timestamp: new Date().toISOString()
  };
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    const body = JSON.stringify(checkHealth());
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(port, host, () => {
  console.log(`worker-service listening on http://${host}:${port}`);
});
