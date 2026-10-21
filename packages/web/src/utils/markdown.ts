/**
 * 轻量 Markdown 渲染 —— 笔记正文专用，见 docs/tec/05-前端应用设计.md。
 *
 * 为什么不用 marked / markdown-it：
 * 1. 只渲染 GFM 的一个常用子集，自己解析就能保证「输出端」完全可控：
 *    所有文本都先 escapeHtml，标签由本文件拼装，源文本里的原始 HTML 一律当纯文本，
 *    因此不需要再挂一层 DOM sanitizer（08 文档 §3.1「富文本」条）。
 * 2. 链接/图片走 safeUrl() 白名单（http、https、mailto；图片仅 https，与 CSP 的 img-src 对齐），
 *    不合法时只保留文字，绝不输出可点击的 href。
 * 3. 零依赖 = 不新增供应链与体积负担，渲染成本可控。
 *
 * 支持的语法：标题 1-6、段落与换行、围栏/缩进代码块、行内代码、加粗、斜体、删除线、
 * 链接与自动链接、图片、有序/无序/嵌套列表、任务列表、引用、分割线、GFM 表格、反斜杠转义。
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** 统一的 HTML 转义出口：任何用户输入进 HTML 之前都必须过这里 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** 链接/图片地址白名单；返回 null 表示这个地址只能用作文本 */
function safeUrl(raw: string, kind: 'link' | 'image'): string | null {
  const value = raw.trim().replace(/^<(.*)>$/, '$1').trim();
  if (!value) return null;
  // 只接受显式协议：相对路径在 SPA 里会解析到应用自身，容易变成钓鱼入口
  if (kind === 'image') return /^https:\/\/[^\s]+$/i.test(value) ? value : null;
  if (/^https?:\/\/[^\s]+$/i.test(value)) return value;
  if (/^mailto:[^\s]+@[^\s]+$/i.test(value)) return value;
  return null;
}

function countRun(text: string, index: number, char: string): number {
  let length = 0;
  while (text[index + length] === char) length += 1;
  return length;
}

const WORD_CHAR = /[\w\u4e00-\u9fa5]/;

/** 强调标记，长的排前面，避免 ** 被单个 * 先吃掉 */
const EMPHASIS: ReadonlyArray<{ marker: string; tag: string }> = [
  { marker: '**', tag: 'strong' },
  { marker: '__', tag: 'strong' },
  { marker: '~~', tag: 'del' },
  { marker: '*', tag: 'em' },
  { marker: '_', tag: 'em' },
];

interface ParsedLink {
  label: string;
  href: string;
  title: string;
  end: number;
}

/** 从 text[start] === '[' 处解析 `[label](href "title")` */
function parseLink(text: string, start: number): ParsedLink | null {
  if (text[start] !== '[') return null;

  let depth = 0;
  let index = start;
  for (; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null;

  const label = text.slice(start + 1, index);
  if (text[index + 1] !== '(') return null;

  let cursor = index + 2;
  let parens = 1;
  for (; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (char === '\\') {
      cursor += 1;
      continue;
    }
    if (char === '(') parens += 1;
    else if (char === ')') {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  if (parens !== 0) return null;

  const target = text.slice(index + 2, cursor).trim();
  // `url "title"` / `url 'title'` / `url (title)`
  const withTitle = /^(.*?)\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\))$/.exec(target);
  return {
    label,
    href: (withTitle?.[1] ?? target).trim(),
    title: withTitle ? (withTitle[2] ?? withTitle[3] ?? withTitle[4] ?? '') : '',
    end: cursor + 1,
  };
}

/** 行内解析：返回值已经是可安全插入 HTML 的片段 */
function renderInline(source: string): string {
  let html = '';
  let index = 0;

  while (index < source.length) {
    const char = source[index] ?? '';

    // 反斜杠转义
    if (char === '\\' && index + 1 < source.length) {
      const next = source[index + 1] ?? '';
      if (/[\\`*_{}[\]()#+\-.!>~|]/.test(next)) {
        html += escapeHtml(next);
        index += 2;
        continue;
      }
    }

    // 行内代码
    if (char === '`') {
      const run = countRun(source, index, '`');
      const fence = '`'.repeat(run);
      const close = source.indexOf(fence, index + run);
      if (close > index + run) {
        let code = source.slice(index + run, close);
        if (code.length > 1 && code.startsWith(' ') && code.endsWith(' ')) code = code.slice(1, -1);
        html += `<code>${escapeHtml(code)}</code>`;
        index = close + run;
        continue;
      }
      const literal = source.slice(index, index + run);
      html += escapeHtml(literal);
      index += run;
      continue;
    }

    // 图片
    if (char === '!' && source[index + 1] === '[') {
      const parsed = parseLink(source, index + 1);
      if (parsed) {
        const href = safeUrl(parsed.href, 'image');
        if (href) {
          const alt = escapeHtml(markdownToPlainText(parsed.label));
          const title = parsed.title ? ` title="${escapeHtml(parsed.title)}"` : '';
          html += `<img src="${escapeHtml(href)}" alt="${alt}"${title} loading="lazy" referrerpolicy="no-referrer" />`;
        } else {
          html += escapeHtml(source.slice(index, parsed.end));
        }
        index = parsed.end;
        continue;
      }
    }

    // 链接
    if (char === '[') {
      const parsed = parseLink(source, index);
      if (parsed) {
        const label = renderInline(parsed.label);
        const href = safeUrl(parsed.href, 'link');
        if (href) {
          const title = parsed.title ? ` title="${escapeHtml(parsed.title)}"` : '';
          const external = /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
          html += `<a href="${escapeHtml(href)}"${title}${external}>${label}</a>`;
        } else {
          // 协议不合法：只留文字，去掉可点击的 href
          html += label;
        }
        index = parsed.end;
        continue;
      }
    }

    // 自动链接 <https://example.com>
    if (char === '<') {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(source.slice(index));
      const raw = auto?.[1];
      const href = raw ? safeUrl(raw, 'link') : null;
      if (auto && raw && href) {
        html += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(raw)}</a>`;
        index += auto[0].length;
        continue;
      }
    }

    // 加粗 / 斜体 / 删除线
    if (char === '*' || char === '_' || char === '~') {
      const emphasis = parseEmphasis(source, index);
      if (emphasis) {
        html += emphasis.html;
        index = emphasis.end;
        continue;
      }
    }

    // 换行（breaks 模式：单个换行即断行，符合中文笔记习惯）
    if (char === '\n') {
      html += '<br />';
      index += 1;
      continue;
    }

    html += escapeHtml(char);
    index += 1;
  }

  return html;
}

function parseEmphasis(source: string, start: number): { html: string; end: number } | null {
  for (const { marker, tag } of EMPHASIS) {
    if (!source.startsWith(marker, start)) continue;

    const contentStart = start + marker.length;
    const firstChar = source[contentStart];
    if (firstChar === undefined || /\s/.test(firstChar)) continue;
    // _ 不能出现在词中间，否则 snake_case 会被误判为斜体
    if (marker.startsWith('_') && start > 0 && WORD_CHAR.test(source[start - 1] ?? '')) continue;

    let searchFrom = contentStart;
    for (;;) {
      const close = source.indexOf(marker, searchFrom);
      if (close < 0) break;
      const inner = source.slice(contentStart, close);
      const beforeClose = source[close - 1] ?? '';
      const afterClose = source[close + marker.length] ?? '';
      const blocked =
        inner.trim().length === 0 ||
        /\s/.test(beforeClose) ||
        (marker.startsWith('_') && WORD_CHAR.test(afterClose));
      if (blocked) {
        searchFrom = close + 1;
        continue;
      }
      return { html: `<${tag}>${renderInline(inner)}</${tag}>`, end: close + marker.length };
    }
  }
  return null;
}

/* ---------------------------------- 块级 ---------------------------------- */

const LIST_ITEM_RE = /^( *)([-*+]|\d{1,9}[.)])( +)(.*)$/;
const TASK_RE = /^\[([ xX])\]\s+(.*)$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[ \t]*$/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
const RULE_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;

interface ListEntry {
  lines: string[];
  task: 'todo' | 'done' | null;
}

function listItemOf(line: string): { indent: number; ordered: boolean; content: string } | null {
  const match = LIST_ITEM_RE.exec(line);
  if (!match) return null;
  return {
    indent: (match[1] ?? '').length,
    ordered: /\d/.test(match[2] ?? ''),
    content: match[4] ?? '',
  };
}

function isFenceClose(line: string, fence: string): boolean {
  const trimmed = line.trim();
  const char = fence[0] ?? '`';
  if (trimmed.length < fence.length) return false;
  return [...trimmed].every((item) => item === char);
}

function splitRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\\' && value[index + 1] === '|') {
      current += '|';
      index += 1;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function isTableDelimiter(line: string): boolean {
  if (!line.includes('-') || !line.includes('|')) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()));
}

function codeBlock(code: string, lang: string): string {
  const attr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
  return `<pre${attr}><code>${escapeHtml(code)}</code></pre>`;
}

/** 紧凑列表项：去掉首段的 <p>，避免列表行间距过大（后续块级元素保持不变） */
function unwrapParagraph(html: string): string {
  if (!html.startsWith('<p>')) return html;
  const close = html.indexOf('</p>');
  if (close < 0) return html;
  const inner = html.slice(3, close);
  const rest = html.slice(close + 4);
  return rest.trim() ? `${inner}${rest}` : inner;
}

function isBlockStart(line: string, next: string | undefined): boolean {
  if (!line.trim()) return true;
  if (FENCE_RE.test(line)) return true;
  if (HEADING_RE.test(line)) return true;
  if (/^ {0,3}>/.test(line)) return true;
  if (RULE_RE.test(line)) return true;
  if (listItemOf(line)) return true;
  if (next !== undefined && line.includes('|') && isTableDelimiter(next)) return true;
  return false;
}

function parseTable(lines: string[], start: number): { html: string; next: number } {
  const header = splitRow(lines[start] ?? '');
  const alignments = splitRow(lines[start + 1] ?? '').map((cell) => {
    const value = cell.trim();
    const left = value.startsWith(':');
    const right = value.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });

  const rows: string[][] = [];
  let index = start + 2;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim() || !line.includes('|')) break;
    rows.push(splitRow(line));
    index += 1;
  }

  const cellOf = (value: string, column: number, tag: 'th' | 'td'): string => {
    const align = alignments[column] ?? 'left';
    return `<${tag} class="md-align-${align}">${renderInline(value)}</${tag}>`;
  };

  const head = header.map((value, column) => cellOf(value, column, 'th')).join('');
  const body = rows
    .map((row) => `<tr>${header.map((_, column) => cellOf(row[column] ?? '', column, 'td')).join('')}</tr>`)
    .join('');

  return {
    html: `<div class="md-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
    next: index,
  };
}

function parseList(lines: string[], start: number): { html: string; next: number } {
  const firstLine = lines[start] ?? '';
  const first = listItemOf(firstLine);
  if (!first) return { html: '', next: start + 1 };

  const { ordered, indent: baseIndent } = first;
  const entries: ListEntry[] = [];
  let loose = false;
  let index = start;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const item = listItemOf(line);

    // 同级新条目
    if (item && item.indent <= baseIndent + 1 && item.ordered === ordered) {
      const task = TASK_RE.exec(item.content);
      entries.push({
        lines: [task ? (task[2] ?? '') : item.content],
        task: task ? ((task[1] ?? '').trim().toLowerCase() === 'x' ? 'done' : 'todo') : null,
      });
      index += 1;
      continue;
    }

    const current = entries[entries.length - 1];
    if (!current) break;

    // 空行：后面还有属于本列表的内容就算松散列表，否则结束
    if (!line.trim()) {
      const next = lines[index + 1];
      if (next === undefined) {
        index += 1;
        break;
      }
      const nextItem = listItemOf(next);
      const nextIndent = (/^ */.exec(next)?.[0].length ?? 0);
      const belongsToSibling =
        nextItem !== null && nextItem.indent <= baseIndent + 1 && nextItem.ordered === ordered;
      if (belongsToSibling || nextIndent >= baseIndent + 2) {
        loose = true;
        current.lines.push('');
        index += 1;
        continue;
      }
      break;
    }

    // 缩进足够 → 续行或子列表
    const indent = (/^ */.exec(line)?.[0].length ?? 0);
    if (indent >= baseIndent + 2) {
      current.lines.push(line.slice(Math.min(indent, baseIndent + 2)));
      index += 1;
      continue;
    }

    break;
  }

  const tag = ordered ? 'ol' : 'ul';
  const startNumber = ordered ? Number.parseInt(LIST_ITEM_RE.exec(firstLine)?.[2] ?? '1', 10) : 1;
  const startAttr = ordered && startNumber > 1 ? ` start="${startNumber}"` : '';

  const body = entries
    .map((entry) => {
      const inner = parseBlocks(entry.lines);
      const content = entry.task
        ? `<input type="checkbox" disabled${entry.task === 'done' ? ' checked' : ''} />${unwrapParagraph(inner)}`
        : loose
          ? inner
          : unwrapParagraph(inner);
      return `<li${entry.task ? ' class="md-task"' : ''}>${content}</li>`;
    })
    .join('');

  return { html: `<${tag}${startAttr}>${body}</${tag}>`, next: index };
}

function parseBlocks(lines: string[]): string {
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (!line.trim()) {
      index += 1;
      continue;
    }

    // 围栏代码块
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1] ?? '```';
      const lang = (fence[2] ?? '').replace(/[^\w+#.-]/g, '');
      const collected: string[] = [];
      index += 1;
      while (index < lines.length && !isFenceClose(lines[index] ?? '', marker)) {
        collected.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push(codeBlock(collected.join('\n'), lang));
      continue;
    }

    // 分割线
    if (RULE_RE.test(line)) {
      blocks.push('<hr />');
      index += 1;
      continue;
    }

    // 标题
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = (heading[1] ?? '#').length;
      blocks.push(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`);
      index += 1;
      continue;
    }

    // 引用（可嵌套：内部递归解析）
    if (/^ {0,3}>/.test(line)) {
      const inner: string[] = [];
      while (index < lines.length && /^ {0,3}>/.test(lines[index] ?? '')) {
        inner.push((lines[index] ?? '').replace(/^ {0,3}>[ \t]?/, ''));
        index += 1;
      }
      blocks.push(`<blockquote>${parseBlocks(inner)}</blockquote>`);
      continue;
    }

    // 表格
    if (line.includes('|') && isTableDelimiter(lines[index + 1] ?? '')) {
      const table = parseTable(lines, index);
      blocks.push(table.html);
      index = table.next;
      continue;
    }

    // 列表
    if (listItemOf(line)) {
      const list = parseList(lines, index);
      blocks.push(list.html);
      index = list.next;
      continue;
    }

    // 缩进代码块
    if (/^ {4}/.test(line)) {
      const collected: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        if (!/^ {4}/.test(current) && current.trim()) break;
        collected.push(current.slice(4));
        index += 1;
      }
      while (collected.length > 0 && !(collected[collected.length - 1] ?? '').trim()) collected.pop();
      blocks.push(codeBlock(collected.join('\n'), ''));
      continue;
    }

    // 段落
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (!current.trim()) break;
      if (paragraph.length > 0 && isBlockStart(current, lines[index + 1])) break;
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push(`<p>${renderInline(paragraph.join('\n'))}</p>`);
  }

  return blocks.join('\n');
}

/**
 * 把 Markdown 源码渲染成安全的 HTML 字符串。
 * 输出只包含本文件拼装的标签，源文本里的 `<script>`、`onerror=` 等都会被转义成可见字符。
 */
export function renderMarkdown(source: string): string {
  if (!source.trim()) return '';
  const normalized = source.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  return parseBlocks(normalized.split('\n'));
}

/* ------------------------- 纯文本工具（列表摘要 / 无标题） ------------------------- */

/** 去掉 Markdown 标记，得到人类可读的纯文本；用于列表摘要与「无标题笔记」的兜底标题 */
export function markdownToPlainText(source: string, max = 0): string {
  let text = source.replace(/\r\n?/g, '\n');
  // 代码块整体丢弃：摘要里出现代码没有意义
  text = text.replace(/```[\s\S]*?```/g, ' ').replace(/~~~[\s\S]*?~~~/g, ' ');
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text
    .split('\n')
    .map((line) =>
      line
        .replace(/^ {0,3}#{1,6}\s+/, '')
        .replace(/^ {0,3}>\s?/, '')
        .replace(/^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+/, '')
        .replace(/^ {0,3}(?:[-*_]\s*){3,}$/, ' '),
    )
    .join('\n');

  text = text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\|/g, ' ')
    .replace(/\\/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return max > 0 && text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** 取第一条有内容（且不是代码围栏/分割线）的行作为标题文本 */
export function markdownTitleOf(source: string, max = 120): string {
  const line = source
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, ' ')
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item.length > 0 && !RULE_RE.test(item));
  if (!line) return '';
  return markdownToPlainText(line, max);
}
