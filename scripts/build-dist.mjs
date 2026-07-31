import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const publicDir = path.join(dist, "public");
const serverDir = path.join(dist, "server");

rmSync(dist, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });
mkdirSync(serverDir, { recursive: true });
mkdirSync(path.join(dist, ".openai"), { recursive: true });

copyFile("index.html", "index.html");
copyFile("styles.css", "styles.css");
copyFile("app.js", "app.js");

const sourceDataDir = existsSync(path.join(root, "public", "data"))
  ? path.join(root, "public", "data")
  : path.join(root, "data");
cpSync(sourceDataDir, path.join(publicDir, "data"), { recursive: true });
cpSync(path.join(root, ".openai", "hosting.json"), path.join(dist, ".openai", "hosting.json"));

writeFileSync(
  path.join(serverDir, "index.js"),
  `const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const publicDir = path.join(__dirname, "..", "public");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

function safePath(urlPath) {
  const normalized = path.normalize(decodeURIComponent(urlPath.split("?")[0])).replace(/^([.][.][\\/\\\\])+/, "");
  return normalized === "/" ? "/index.html" : normalized;
}

function sendFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const type = contentTypes[ext] || "application/octet-stream";
  const stream = fs.createReadStream(filePath);
  res.writeHead(200, { "Content-Type": type, "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600" });
  stream.pipe(res);
  stream.on("error", () => {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Server error");
  });
}

http.createServer((req, res) => {
  const resolved = safePath(req.url || "/");
  let filePath = path.join(publicDir, resolved);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(publicDir, "index.html");
  }

  sendFile(filePath, res);
}).listen(port, host, () => {
  console.log("Sapos catalog server listening on", host + ":" + port);
});
`
);

console.log("dist generated at", dist);

function copyFile(from, to) {
  const source = path.join(root, from);
  let content = readFileSync(source, "utf8");
  if (from === "index.html") {
    content = content
      .replace('src="./app.js" type="module"', 'src="./app.js" type="module"')
      .replace('<script src="./app.js" type="module"></script>', '<script src="./app.js" type="module"></script>');
  }
  writeFileSync(path.join(publicDir, to), content);
}
