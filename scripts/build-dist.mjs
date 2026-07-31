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

const indexHtml = readFileSync(path.join(publicDir, "index.html"), "utf8");
const stylesCss = readFileSync(path.join(publicDir, "styles.css"), "utf8");
const appJs = readFileSync(path.join(publicDir, "app.js"), "utf8");
const catalogJson = readFileSync(path.join(publicDir, "data", "catalog.json"), "utf8");

writeFileSync(
  path.join(serverDir, "index.js"),
  `const assets = {
  "/": { type: "text/html; charset=utf-8", body: ${JSON.stringify(indexHtml)} },
  "/index.html": { type: "text/html; charset=utf-8", body: ${JSON.stringify(indexHtml)} },
  "/styles.css": { type: "text/css; charset=utf-8", body: ${JSON.stringify(stylesCss)} },
  "/app.js": { type: "application/javascript; charset=utf-8", body: ${JSON.stringify(appJs)} },
  "/data/catalog.json": { type: "application/json; charset=utf-8", body: ${JSON.stringify(catalogJson)} }
};

function matchAsset(pathname) {
  if (assets[pathname]) {
    return assets[pathname];
  }
  if (pathname.startsWith("/data/")) {
    return null;
  }
  return assets["/index.html"];
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const asset = matchAsset(url.pathname);
    if (!asset) {
      return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }

    return new Response(asset.body, {
      status: 200,
      headers: {
        "Content-Type": asset.type,
        "Cache-Control": asset.type.startsWith("text/html") ? "no-cache" : "public, max-age=3600"
      }
    });
  }
};
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
