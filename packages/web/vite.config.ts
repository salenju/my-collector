import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa';

/** GitHub Pages 部署在子路径下（见 docs/tec/01-架构总览.md §6） */
const BASE = '/my-collector/';

const distDir = fileURLToPath(new URL('./dist', import.meta.url));

/**
 * GitHub Pages 没有服务端 rewrite，深链（/tags、/item/xxx）会 404。
 * 构建后把 index.html 复制为 404.html 作为 SPA 兜底。
 *
 * 注：Service Worker 注册后在 scope 内会优先拦截导航，因此 404.html 是「首次访问、
 * SW 还没接管」时的兜底，二者缺一不可。
 */
function copyIndexTo404(): Plugin {
  return {
    name: 'my-collector:copy-index-to-404',
    apply: 'build',
    async closeBundle() {
      const html = await readFile(`${distDir}/index.html`, 'utf8');
      await writeFile(`${distDir}/404.html`, html, 'utf8');
    },
  };
}

/**
 * 严格 CSP 只在生产构建注入：开发时 Vite 的 HMR 需要内联脚本与 ws 连接。
 *
 * 注意：通过 <meta> 下发时 frame-ancestors / report-uri / sandbox 会被浏览器忽略
 * （GitHub Pages 无法自定义响应头），因此这里不写 frame-ancestors，避免每条页面都报控制台警告。
 * connect-src 允许任意 https 是为了让「自建元信息抓取代理」（06 文档 §4.5）可用；
 * 真正的 XSS 边界是 script-src 'self'。
 */
function injectCsp(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // blob: 是必需的 —— 附件图片经索引缓存后以 URL.createObjectURL 渲染，
    // 不放开这条会被 CSP 拦掉，表现为"图片全部不显示"（见 10 文档 §5.3）
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.github.com https:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  return {
    name: 'my-collector:inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!--CSP-->',
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

/**
 * PWA manifest —— 见 docs/tec/06-多端入口设计.md §3。
 * 相对路径（`./`、`icons/...`）由浏览器按 manifest 自身地址解析，从而自动带上子路径前缀。
 */
const manifest: Partial<ManifestOptions> = {
  name: '满天星',
  short_name: '满天星',
  description: '碎片信息与链接收藏工具。数据存在你自己的 GitHub 私有仓库里。',
  lang: 'zh-CN',
  dir: 'ltr',
  start_url: BASE,
  scope: BASE,
  display: 'standalone',
  orientation: 'any',
  theme_color: '#3b82f6',
  background_color: '#ffffff',
  categories: ['productivity', 'utilities'],
  icons: [
    { src: 'icons/192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  shortcuts: [
    { name: '新建笔记', short_name: '笔记', url: `${BASE}new?type=note` },
    { name: '新建链接', short_name: '链接', url: `${BASE}new` },
    { name: '搜索', short_name: '搜索', url: `${BASE}?focus=search` },
  ],
  // Android 的「分享到满天星」；iOS Safari 不支持，见 06 文档 §3.3 的替代方案
  share_target: {
    action: `${BASE}share`,
    method: 'GET',
    params: { title: 'title', text: 'text', url: 'url' },
  },
};

export default defineConfig({
  base: BASE,
  plugins: [
    vue(),
    injectCsp(),
    copyIndexTo404(),
    VitePWA({
      // prompt：不静默刷新，避免用户正在填的表单被页面重载冲掉（09 文档 §5 的取舍）
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: `${BASE}index.html`,
        // 只预缓存应用外壳：数据一律走 IndexedDB。
        // 刻意不缓存 GitHub API 响应——否则离线时同步引擎会读到「陈旧但看起来成功」的远端，
        // 让冲突合并基于过期数据做判断（见 09-实现记录.md）。
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia'],
        },
      },
    },
  },
});
