#!/usr/bin/env node
// HTTP 冒烟：待页面可访问后，核查健康检查与首页内容。
// 通过 depends_on: service_healthy 触发；自身也带重试以容忍启动抖动。
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080';
const DEADLINE_MS = Number(process.env.SMOKE_TIMEOUT_MS || 60000);

async function fetchChecked(pathname, expect) {
  const url = BASE_URL.replace(/\/$/, '') + pathname;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${pathname} -> HTTP ${res.status}`);
  const body = await res.text();
  for (const needle of expect) {
    if (!body.includes(needle)) {
      throw new Error(`GET ${pathname} 响应中缺少 "${needle}"`);
    }
  }
  return body;
}

const start = Date.now();
let lastError;
for (;;) {
  try {
    await fetchChecked('/healthz', ['"ok"']);
    await fetchChecked('/', ['<div id="root">', '带符号排列']);
    // 静态资源路径存在性：抓首页后验证引用的 JS 资源可访问。
    const index = await fetchChecked('/', []);
    const asset = index.match(/src="(\/assets\/[^"]+\.js)"/);
    if (!asset) throw new Error('首页未引用构建后的 JS 资源');
    await fetchChecked(asset[1], []);
    console.log(`SMOKE PASS: ${BASE_URL} (healthz / / / asset ${asset[1]})`);
    process.exit(0);
  } catch (err) {
    lastError = err;
    if (Date.now() - start > DEADLINE_MS) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
console.error(`SMOKE FAIL: ${lastError && lastError.message}`);
process.exit(1);
