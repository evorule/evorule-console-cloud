<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  JsonViewer — 只读 JSON 查看器（Q12 段2 P5/C3）
  预格式化 + 缩进 + 基本着色（正则分词，不引入外部依赖）。
  用于 governance 页数据资产条目的 payload 查看。
-->
<script lang="ts">
  let { value, maxHeight = '420px' }: { value: unknown; maxHeight?: string } = $props();

  /** JSON → 带着色类名的 HTML 片段（转义后拼接，基本分词着色） */
  const html = $derived.by(() => {
    let text: string;
    try {
      text = JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      text = String(value);
    }
    const esc = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // 依次匹配:字符串(键或值) / 数字 / 布尔 / null,其余原样
    return esc.replace(
      /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false)\b|\bnull\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (m, str: string | undefined, colon: string | undefined, bool: string | undefined, num: string | undefined) => {
        if (str) {
          const cls = colon ? 'j-key' : 'j-str';
          return `<span class="${cls}">${str}</span>${colon ?? ''}`;
        }
        if (bool) return `<span class="j-bool">${bool}</span>`;
        if (num) return `<span class="j-num">${num}</span>`;
        return m;
      }
    );
  });
</script>

<pre class="json-view" style="max-height: {maxHeight}">{@html html}</pre>

<style>
  .json-view {
    margin: 0;
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-family: monospace;
    line-height: 1.5;
    overflow: auto;
    white-space: pre;
  }
  /* 着色类经 @html 注入,Svelte 静态分析不可见,需 :global(限定在 .json-view 内) */
  .json-view :global(.j-key) {
    color: var(--info);
  }
  .json-view :global(.j-str) {
    color: var(--success);
  }
  .json-view :global(.j-num) {
    color: var(--warning);
  }
  .json-view :global(.j-bool) {
    color: var(--brand);
  }
  .json-view :global(.j-null) {
    color: var(--text-secondary);
  }
</style>
