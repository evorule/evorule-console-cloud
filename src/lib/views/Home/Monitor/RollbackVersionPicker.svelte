<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:回滚版本选择器(紧急回滚场景)
    - 列出可选的历史版本号(按版本号降序,含当前版本标记)
    - 选中后触发 onPickVersion(外部结合 ConfirmDialog 使用)
  关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §6.3 + §4.3(回滚按钮)
-->

<script lang="ts">
  interface VersionEntry {
    version: number;
    publishedAt: string;
    note?: string;
    rulesCount?: number;
  }

  interface Props {
    /** 当前生产版本(高亮"当前"标记) */
    currentVersion: number;
    /** 可选版本列表(若为空,则仅显示 v{n} 的最近 5 个版本推导) */
    versions?: VersionEntry[];
    onPickVersion: (v: number) => void;
    onCancel: () => void;
  }

  let {
    currentVersion,
    versions: rawVersions,
    onPickVersion,
    onCancel,
  }: Props = $props();

  // 若外部未提供版本列表,则从当前版本推导最近 5 个
  const derivedVersions: VersionEntry[] = $derived.by(() => {
    if (rawVersions && rawVersions.length > 0) return rawVersions;
    const arr: VersionEntry[] = [];
    const now = Date.now();
    for (let v = currentVersion; v >= Math.max(1, currentVersion - 4); v--) {
      arr.push({
        version: v,
        publishedAt: new Date(
          now - (currentVersion - v) * 3600_000,
        ).toISOString(),
      });
    }
    return arr;
  });

  const sorted = $derived(
    [...derivedVersions].sort((a, b) => b.version - a.version),
  );
</script>

<div class="rb-picker" role="dialog" aria-modal="true" tabindex="-1">
  <header class="rb-header">
    <h3 class="rb-title">⏪ 选择回滚版本</h3>
    <button type="button" class="btn-close" onclick={onCancel}>✕</button>
  </header>
  <p class="rb-hint">
    选择要回滚到的版本。回滚将创建新版本号并滚动切换 session。 当前版本 <strong
      >v{currentVersion}</strong
    >。
  </p>

  <div class="rb-list">
    {#each sorted as v (v.version)}
      {@const isCurrent = v.version === currentVersion}
      <button
        type="button"
        class="rb-item"
        class:current={isCurrent}
        disabled={isCurrent}
        onclick={() => {
          if (!isCurrent) onPickVersion(v.version);
        }}
      >
        <div class="rb-left">
          <span class="rb-version">v{v.version}</span>
          {#if isCurrent}
            <span class="rb-current-tag">当前</span>
          {/if}
          {#if v.rulesCount !== undefined}
            <span class="rb-rules">· {v.rulesCount} 条规则</span>
          {/if}
        </div>
        <div class="rb-right">
          <span class="rb-date">{new Date(v.publishedAt).toLocaleString()}</span
          >
          {#if v.note}
            <span class="rb-note">· {v.note}</span>
          {/if}
          {#if !isCurrent}
            <span class="rb-action">回滚 →</span>
          {/if}
        </div>
      </button>
    {/each}
  </div>

  <footer class="rb-footer">
    <button type="button" class="btn btn-cancel" onclick={onCancel}>取消</button
    >
  </footer>
</div>

<style>
  .rb-picker {
    background: var(--bg-card);
    border-radius: 10px;
    min-width: 420px;
    max-width: 560px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
    overflow: hidden;
  }
  .rb-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-gray-200, #e5e7eb);
  }
  .rb-title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--color-text-primary, #111827);
  }
  .btn-close {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 16px;
    color: var(--color-gray-500, #6b7280);
    padding: 0 4px;
  }
  .btn-close:hover {
    color: var(--color-text-primary, #111827);
  }
  .rb-hint {
    padding: 10px 16px;
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--color-text-secondary, #4b5563);
    background: var(--color-warning-bg, #fffbeb);
    border-bottom: 1px solid var(--color-warning, #fde68a);
  }
  .rb-hint strong {
    color: var(--color-warning, #b45309);
  }
  .rb-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 6px;
    max-height: 300px;
    overflow-y: auto;
  }
  .rb-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s ease;
    border: none;
    background: transparent;
    text-align: left;
    width: 100%;
    font-family: inherit;
  }
  .rb-item:hover:not(.current) {
    background: var(--color-info-bg, #eff6ff);
  }
  .rb-item.current {
    background: var(--color-gray-100, #f3f4f6);
    cursor: default;
    opacity: 0.75;
  }
  .rb-item:disabled {
    cursor: default;
  }
  .rb-left {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .rb-version {
    font-family: var(--font-mono, monospace);
    font-weight: 700;
    font-size: 14px;
    color: var(--color-text-primary, #111827);
  }
  .rb-current-tag {
    font-size: 10px;
    padding: 1px 6px;
    background: var(--color-primary, #2563eb);
    color: white;
    border-radius: 8px;
    font-weight: 600;
  }
  .rb-rules {
    font-size: 11px;
    color: var(--color-gray-500, #6b7280);
  }
  .rb-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 11px;
    color: var(--color-gray-500, #6b7280);
  }
  .rb-date {
    font-family: var(--font-mono, monospace);
  }
  .rb-note {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rb-action {
    margin-left: 6px;
    color: var(--color-error, #dc2626);
    font-weight: 600;
  }
  .rb-item:hover:not(.current) .rb-action {
    color: #b91c1c;
  }
  .rb-footer {
    padding: 10px 16px;
    border-top: 1px solid var(--color-gray-200, #e5e7eb);
    display: flex;
    justify-content: flex-end;
    background: var(--color-gray-50, #f9fafb);
  }
  .btn {
    font-size: 12px;
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-weight: 500;
  }
  .btn-cancel {
    background: var(--bg-card);
    border: 1px solid var(--color-gray-300, #d1d5db);
    color: var(--color-text-secondary, #4b5563);
  }
  .btn-cancel:hover {
    background: var(--color-gray-100, #f3f4f6);
  }
</style>
