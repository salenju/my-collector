#!/usr/bin/env node
/**
 * 浏览器冒烟测试：用 Chrome DevTools Protocol 逐页加载应用，
 * 输出每个路由的可见文本与 **console 错误**。
 *
 * 用途（见 docs/tec/07-工程化与交付计划.md §4.3 的验收清单）：
 *   「所有路由能正常渲染」与「控制台无 error」是发布前必须过的两条。
 * 类型检查与构建都发现不了运行时错误，这个脚本是那部分的补充。
 *
 * 依赖：本机已安装 Chrome（或用 CHROME 环境变量指定路径）。
 *
 * 用法：
 *   pnpm preview &                       # 先起一个静态服务
 *   node scripts/smoke.mjs http://localhost:4173/my-collector
 *   node scripts/smoke.mjs http://localhost:5173/my-collector "/" "/settings"
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const BASE = (process.argv[2] ?? 'http://localhost:4173/my-collector').replace(/\/$/, '');
const ROUTES = process.argv.slice(3);
const TARGETS = ROUTES.length > 0 ? ROUTES : ['/', '/new', '/tags', '/settings', '/about', '/item/unknown-id'];
const PORT = Number(process.env.CDP_PORT ?? 9333);

const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const chromePath = CANDIDATES.find((candidate) => existsSync(candidate));
if (!chromePath) {
  console.error('找不到 Chrome，请用 CHROME=/path/to/chrome 指定。');
  process.exit(2);
}

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=/tmp/my-collector-smoke-${PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findPageTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await response.json();
      const page = list.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* 还没起来，继续等 */
    }
    await sleep(250);
  }
  throw new Error('CDP 端点未就绪（Chrome 可能启动失败）');
}

const socket = new WebSocket(await findPageTarget());
let seq = 0;
const pending = new Map();
const problems = [];
let currentRoute = '';

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = (seq += 1);
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result);
    pending.delete(message.id);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails;
    problems.push(`JS 异常: ${details.exception?.description ?? details.text}`);
  }
  if (message.method === 'Log.entryAdded') {
    const entry = message.params.entry;
    if (entry.level === 'error') problems.push(`${entry.text} ${entry.url ?? ''}`);
  }
});

await new Promise((resolve) => socket.addEventListener('open', resolve));
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

let failed = false;

for (const route of TARGETS) {
  currentRoute = route;
  problems.length = 0;

  await send('Page.navigate', { url: `${BASE}${route}` });
  await sleep(2500);

  const dom = await send('Runtime.evaluate', {
    expression: 'document.body.innerText.replace(/\\n{2,}/g, " | ")',
    returnByValue: true,
  });
  const text = (dom?.result?.value ?? '').trim();

  console.log(`\n─── ${route} ───`);
  console.log(text.slice(0, 400) || '(无可见文本)');

  if (text.length === 0) {
    problems.push('页面没有任何可见文本（可能是白屏）');
  }
  if (problems.length > 0) {
    failed = true;
    console.log(`  ✗ ${problems.join(' ; ')}`);
  } else {
    console.log('  ✓ 无 console 错误');
  }
}

socket.close();
chrome.kill();
process.exit(failed ? 1 : 0);
