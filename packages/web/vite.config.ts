import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';

/** GitHub Pages 部署在子路径下（见 docs/tec/01-架构总览.md §6） */
const BASE = '/my-collector/';

const distDir = fileURLToPath(new URL('./dist', import.meta.url));

/**
 * GitHub Pages 没有服务端 rewrite，深链（/tags、/item/xxx）会 404。
 * 构建后把 index.html 复制为 404.html 作为 SPA 兜底。
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
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.github.com https:",
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

export default defineConfig({
  base: BASE,
  plugins: [vue(), injectCsp(), copyIndexTo404()],
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
