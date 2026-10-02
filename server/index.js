import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { buildRepositories } from "./discover.js";
import { computeHistoryStats, readContextHistory } from "./context-history.js";
import { getWatchStatus, startContextWatchManager } from "./context-watch.js";
import { ROOT_DIR } from "./paths.js";

const PORT = Number(process.env.PORT || 3847);
let cache = null;
let cacheTime = 0;
const CACHE_MS = 30_000;

function getData() {
  const now = Date.now();
  if (!cache || now - cacheTime > CACHE_MS) {
    cache = buildRepositories();
    cacheTime = now;
  }
  return cache;
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(json);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (url.pathname === "/api/data") {
    return sendJson(res, 200, getData());
  }

  if (url.pathname === "/api/refresh") {
    cache = null;
    return sendJson(res, 200, getData());
  }

  if (url.pathname === "/api/watch/status") {
    return sendJson(res, 200, getWatchStatus());
  }

  const historyMatch = url.pathname.match(/^\/api\/history\/([0-9a-f-]{36})$/i);
  if (historyMatch) {
    const points = readContextHistory(historyMatch[1]);
    return sendJson(res, 200, {
      composerId: historyMatch[1],
      points,
      stats: computeHistoryStats(points),
    });
  }

  let filePath = path.join(ROOT_DIR, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    return res.end("Not found");
  }

  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
  };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  startContextWatchManager();
  console.log(`Context Ledger → http://localhost:${PORT}`);
  console.log("Context watch: discover every 10m, sample active chats every 15s (≤1h idle)");
});
