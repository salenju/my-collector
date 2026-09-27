import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

/**
 * Chrome MV3 扩展构建 —— 见 docs/tec/06-多端入口设计.md §5。
 *
 * 手写多入口（不用 @crxjs/vite-plugin）：popup / options 两个 HTML 页面 + 一个
 * Service Worker 入口，输出到 dist 根目录，`public/` 里的 manifest.json 与图标原样拷贝。
 * 不使用 crxjs 是因为它对 MV3 的 HMR 支持仍在 beta，手写多入口更可控。
 */
export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: fileURLToPath(new URL('./popup.html', import.meta.url)),
        options: fileURLToPath(new URL('./options.html', import.meta.url)),
        background: fileURLToPath(new URL('./src/background/index.ts', import.meta.url)),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
