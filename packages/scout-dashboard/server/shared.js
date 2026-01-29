import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_SOCKET_PATH = ".scout/scout.sock";
const PORT = Number(process.env.SCOUT_DASHBOARD_PORT ?? 7331);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

export function startServer({ staticDir, rootDir }) {
  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await proxyRequest(req, res, url, rootDir);
      return;
    }

    await serveStatic(res, staticDir, url.pathname);
  });

  server.listen(PORT, () => {
    console.log(`scout-dashboard listening on http://localhost:${PORT}`);
  });
}

async function proxyRequest(req, res, url, rootDir) {
  const socketPath = await resolveSocketPath(rootDir);
  const upstreamPath = url.pathname.replace(/^\/api/, "") + url.search;

  const proxy = http.request(
    {
      socketPath,
      path: upstreamPath,
      method: req.method,
      headers: req.headers
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    }
  );

  proxy.on("error", (error) => {
    res.writeHead(502);
    res.end(`Proxy error: ${error.message}`);
  });

  req.pipe(proxy, { end: true });
}

function resolveWorkspaceRoot(rootDir) {
  const parent = path.resolve(rootDir, "..");
  if (path.basename(parent) === "packages") {
    return path.resolve(parent, "..");
  }
  return rootDir;
}

async function resolveSocketPath(rootDir) {
  const override = process.env.SCOUT_ENGINE_SOCKET;
  if (override) {
    return path.resolve(override);
  }

  const workspaceRoot = resolveWorkspaceRoot(rootDir);
  const candidates = [
    path.resolve(process.cwd(), DEFAULT_SOCKET_PATH),
    path.resolve(rootDir, DEFAULT_SOCKET_PATH),
    path.resolve(workspaceRoot, DEFAULT_SOCKET_PATH),
    path.resolve(workspaceRoot, "packages", "scout", DEFAULT_SOCKET_PATH)
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

async function pathExists(targetPath) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if ((error.code ?? "") === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function serveStatic(res, root, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(root, safePath);
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  let content;
  try {
    content = await fs.readFile(resolvedFile);
  } catch (error) {
    if ((error.code ?? "") === "ENOENT") {
      const indexPath = path.join(root, "index.html");
      content = await fs.readFile(indexPath);
      res.writeHead(200, { "Content-Type": mimeTypes[".html"] });
      res.end(content);
      return;
    }
    res.writeHead(500);
    res.end("Server error");
    return;
  }

  const ext = path.extname(resolvedFile);
  res.writeHead(200, { "Content-Type": mimeTypes[ext] ?? "application/octet-stream" });
  res.end(content);
}
