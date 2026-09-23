// 纯静态文件服务器：仅负责发布 dist/ 并提供 HTTP 健康检查端点。
// 不含任何业务后端逻辑：无 API、无持久化、无对外网络调用。
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(data);
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/healthz') {
    // 同时确认静态产物确实存在，避免“进程活着但页面未就绪”。
    if (existsSync(join(DIST_DIR, 'index.html'))) {
      sendJson(res, 200, { status: 'ok' });
    } else {
      sendJson(res, 503, { status: 'unavailable', reason: 'dist missing' });
    }
    return;
  }

  // 防路径穿越：规范化后必须仍在 DIST_DIR 内。
  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '');
  let filePath = requested === '' ? join(DIST_DIR, 'index.html') : join(DIST_DIR, requested);
  if (!filePath.startsWith(DIST_DIR)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA 回退到入口（本应用为单页）。
    filePath = join(DIST_DIR, 'index.html');
    if (!existsSync(filePath)) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
  }

  res.writeHead(200, {
    'content-type': MIME[extname(filePath)] || 'application/octet-stream',
  });
  createReadStream(filePath).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`static audit page listening on http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`received ${signal}, shutting down`);
  server.close(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
