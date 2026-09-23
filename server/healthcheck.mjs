// 容器健康检查探针：查询本机 /healthz，非 2xx 即以非零码退出。
const port = process.env.PORT || 8080;
try {
  const res = await fetch(`http://127.0.0.1:${port}/healthz`);
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}
