<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console 规则库视图 (阶段 C.2.3 起为弃用态) -->
<!--
  依据: 实施文档_界面升级_v1.0.md §C.3.2 + §D (阶段 D 落点)
  阶段 C 状态:
    - rules tab 已重定向到 /workspace 路由 (+page.svelte $effect)
    - 本组件保留编译,但不再渲染(防止 svelte-check 报错)
    - 阶段 D 将由 /workspace/+page.svelte 完整重写
  本文件作用:兼容 lib/index.ts 的 RuleLibraryView 导出,避免破坏大众版 npm 包 API
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";

  // 直接跳转到新路由 — 即使被手动访问也走 /workspace
  onMount(() => {
    goto("/workspace", { replaceState: true });
  });
</script>

<div class="rule-library-deprecated">
  <div class="deprecated-card">
    <h1>规则库已迁移</h1>
    <p>本视图已升级为独立工作空间路由。</p>
    <p class="hint">正在跳转到 <code>/workspace</code>…</p>
    <a href="/workspace" class="goto-link">手动进入工作空间 →</a>
  </div>
</div>

<style>
  .rule-library-deprecated {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    padding: var(--spacing-xl);
  }

  .deprecated-card {
    max-width: 480px;
    padding: var(--spacing-xl);
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    text-align: center;
  }

  .deprecated-card h1 {
    margin: 0 0 var(--spacing-md) 0;
    font-size: var(--text-xl);
    color: var(--text-primary);
  }

  .deprecated-card p {
    margin: 0 0 var(--spacing-sm) 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .hint {
    color: var(--text-tertiary);
    font-size: var(--text-xs);
  }

  code {
    font-family: var(--font-mono);
    background: var(--bg-hover);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
  }

  .goto-link {
    display: inline-block;
    margin-top: var(--spacing-md);
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--brand);
    color: var(--bg-card);
    border: 1px solid var(--brand);
    border-radius: var(--radius-md);
    text-decoration: none;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  .goto-link:hover {
    background: var(--brand-strong);
    border-color: var(--brand-strong);
  }
</style>
