/**
 * 扩展页面（popup / options / sidepanel）的深色模式。
 *
 * 与网页版不同：扩展没有自己的主题设置，一律跟随系统；
 * `darkMode: 'class'` + tokens.css 的 `.dark` 变量见 tailwind.config.js 与 styles.css。
 */
export function applyExtensionTheme(): void {
  const prefersDark =
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', prefersDark);
}
