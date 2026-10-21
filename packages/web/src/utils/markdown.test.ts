import { describe, expect, it } from 'vitest';
import { markdownTitleOf, markdownToPlainText, renderMarkdown } from './markdown';

describe('renderMarkdown 块级语法', () => {
  it('渲染标题与段落', () => {
    expect(renderMarkdown('# 一级')).toBe('<h1>一级</h1>');
    expect(renderMarkdown('### 三级标题')).toBe('<h3>三级标题</h3>');
    expect(renderMarkdown('第一段\n\n第二段')).toBe('<p>第一段</p>\n<p>第二段</p>');
  });

  it('段内换行渲染成 <br />', () => {
    expect(renderMarkdown('第一行\n第二行')).toBe('<p>第一行<br />第二行</p>');
  });

  it('渲染围栏代码块并保留语言标记', () => {
    const html = renderMarkdown('```ts\nconst a = 1 < 2;\n```');
    expect(html).toBe('<pre data-lang="ts"><code>const a = 1 &lt; 2;</code></pre>');
  });

  it('渲染分割线与引用', () => {
    expect(renderMarkdown('---')).toBe('<hr />');
    expect(renderMarkdown('> 引用里可以加粗 **重点**')).toBe(
      '<blockquote><p>引用里可以加粗 <strong>重点</strong></p></blockquote>',
    );
    expect(renderMarkdown('> 外层\n> > 内层')).toBe(
      '<blockquote><p>外层</p>\n<blockquote><p>内层</p></blockquote></blockquote>',
    );
  });

  it('渲染无序列表、有序列表与嵌套', () => {
    expect(renderMarkdown('- 甲\n- 乙')).toBe('<ul><li>甲</li><li>乙</li></ul>');
    expect(renderMarkdown('1. 甲\n2. 乙')).toBe('<ol><li>甲</li><li>乙</li></ol>');
    expect(renderMarkdown('3. 甲')).toBe('<ol start="3"><li>甲</li></ol>');
    expect(renderMarkdown('- 父\n  - 子')).toBe('<ul><li>父\n<ul><li>子</li></ul></li></ul>');
  });

  it('渲染任务列表', () => {
    const html = renderMarkdown('- [ ] 未完成\n- [x] 已完成');
    expect(html).toContain('<li class="md-task"><input type="checkbox" disabled />未完成</li>');
    expect(html).toContain('<li class="md-task"><input type="checkbox" disabled checked />已完成</li>');
  });

  it('渲染 GFM 表格与对齐', () => {
    const html = renderMarkdown('| 名称 | 数量 |\n| :--- | ---: |\n| 苹果 | 3 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th class="md-align-left">名称</th>');
    expect(html).toContain('<th class="md-align-right">数量</th>');
    expect(html).toContain('<td class="md-align-left">苹果</td>');
    expect(html).toContain('<td class="md-align-right">3</td>');
  });
});

describe('renderMarkdown 行内语法', () => {
  it('渲染加粗、斜体、删除线与行内代码', () => {
    expect(renderMarkdown('**粗**')).toBe('<p><strong>粗</strong></p>');
    expect(renderMarkdown('*斜*')).toBe('<p><em>斜</em></p>');
    expect(renderMarkdown('~~删~~')).toBe('<p><del>删</del></p>');
    expect(renderMarkdown('`code`')).toBe('<p><code>code</code></p>');
  });

  it('不把 snake_case 当成斜体', () => {
    expect(renderMarkdown('foo_bar_baz')).toBe('<p>foo_bar_baz</p>');
  });

  it('渲染链接并强制新窗口打开', () => {
    expect(renderMarkdown('[示例](https://example.com)')).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">示例</a></p>',
    );
    expect(renderMarkdown('<https://example.com>')).toBe(
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a></p>',
    );
    expect(renderMarkdown('[邮件](mailto:hi@example.com)')).toBe(
      '<p><a href="mailto:hi@example.com">邮件</a></p>',
    );
  });

  it('链接 title 会被渲染并转义', () => {
    const html = renderMarkdown('[a](https://a.com "示例 <标题>")');
    expect(html).toContain('href="https://a.com"');
    expect(html).toContain('title="示例 &lt;标题&gt;"');
  });

  it('图片只允许 https', () => {
    expect(renderMarkdown('![图](https://img.example.com/a.png)')).toBe(
      '<p><img src="https://img.example.com/a.png" alt="图" loading="lazy" referrerpolicy="no-referrer" /></p>',
    );
    expect(renderMarkdown('![图](http://img.example.com/a.png)')).toBe(
      '<p>![图](http://img.example.com/a.png)</p>',
    );
  });

  it('支持反斜杠转义', () => {
    expect(renderMarkdown('\\*不是斜体\\*')).toBe('<p>*不是斜体*</p>');
  });
});

describe('renderMarkdown 安全性', () => {
  it('转义原始 HTML 标签', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    );
  });

  it('丢弃 javascript: / data: 等危险协议，只保留文字', () => {
    expect(renderMarkdown('[点我](javascript:alert(1))')).toBe('<p>点我</p>');
    expect(renderMarkdown('[点我](data:text/html;base64,PHN2Zz4=)')).toBe('<p>点我</p>');
    expect(renderMarkdown('[点我](/relative/path)')).toBe('<p>点我</p>');
    expect(renderMarkdown('![图](data:image/svg+xml;base64,AAA)')).toBe(
      '<p>![图](data:image/svg+xml;base64,AAA)</p>',
    );
  });

  it('转义代码块里的尖括号', () => {
    expect(renderMarkdown('```html\n<script>alert(1)</script>\n```')).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });
});

describe('renderMarkdown 健壮性', () => {
  it('未闭合的代码围栏也能正常结束', () => {
    expect(renderMarkdown('```js\nconst a = 1;')).toBe('<pre data-lang="js"><code>const a = 1;</code></pre>');
  });

  it('列表项里的续行与引用', () => {
    const html = renderMarkdown('- 第一行\n  第二行\n- 下一条');
    expect(html).toBe('<ul><li>第一行<br />第二行</li><li>下一条</li></ul>');
  });

  it('表格里支持行内代码与转义竖线', () => {
    const html = renderMarkdown('| 语法 | 说明 |\n| --- | --- |\n| `a\\|b` | 竖线 |');
    expect(html).toContain('<code>a|b</code>');
  });

  it('空白输入返回空字符串', () => {
    expect(renderMarkdown('   \n\n  ')).toBe('');
  });

  it('不平衡标记不会吞掉正文', () => {
    expect(renderMarkdown('**未闭合的加粗')).toBe('<p>**未闭合的加粗</p>');
  });

  it('中文与 emoji 原样保留', () => {
    expect(renderMarkdown('今天**不错** 🎉')).toBe('<p>今天<strong>不错</strong> 🎉</p>');
  });
});

describe('纯文本工具', () => {
  it('markdownToPlainText 去掉标记并压缩空白', () => {
    const source = '# 标题\n\n- **重点** 内容\n\n```js\nconst a = 1;\n```\n\n[链接](https://example.com)';
    expect(markdownToPlainText(source)).toBe('标题 重点 内容 链接');
  });

  it('markdownToPlainText 支持截断', () => {
    expect(markdownToPlainText('一二三四五六七八九十', 4)).toBe('一二三四…');
  });

  it('markdownTitleOf 跳过空行、代码围栏与分割线', () => {
    expect(markdownTitleOf('---\n\n```js\ncode\n```\n## 真正的标题')).toBe('真正的标题');
    expect(markdownTitleOf('')).toBe('');
  });
});
