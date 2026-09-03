<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:部署历史面板 — bundle 导入溯源(UV-062 优先项④)
    - 消费 GET /api/bundles/imports(workspace 元数据库 bundle_imports 表,导入时间倒序)
    - 展示每次快照包导入:时间 / bundle / 数据集 / 版本语义 / 防篡改指纹 / 导入者
    - 只读溯源:imported_at 为管理元数据(墙钟旁路),不参与 fact / 内容哈希 / 审计验证链
  说明:
    - 仅 CloudHttpBackend(联网模式)提供端点;其他 backend 显示不可用提示
    - fail-fast:加载失败 error 态 + toast 显式报错;空列表(未启用溯源)与失败严格区分
-->

<script lang="ts">
  import { onMount } from "svelte";
  import {
    CloudHttpBackend,
    type BundleImportRecord,
  } from "$lib/backend/cloud-http-backend";
  import { useBackend } from "$lib/kernel";
  import { toastError } from "$lib/stores/toast";

  const backend = useBackend();
  const cloud = backend instanceof CloudHttpBackend ? backend : null;

  // === 状态 ===
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let imports = $state<BundleImportRecord[]>([]);

  onMount(() => {
    if (cloud) void refresh();
  });

  async function refresh(): Promise<void> {
    if (!cloud) return;
    loading = true;
    loadError = null;
    try {
      const resp = await cloud.listBundleImports();
      imports = resp.imports;
    } catch (e) {
      const msg = (e as Error).message;
      loadError = msg;
      // fail-fast:失败必须显式可见(toast + 面板内错误态),禁止静默空列表
      toastError(`部署历史拉取失败:${msg}`, "bundle 导入溯源");
    } finally {
      loading = false;
    }
  }

  // === 展示辅助 ===

  function timeOf(r: BundleImportRecord): string {
    const d = new Date(r.imported_at);
    return Number.isNaN(d.getTime()) ? r.imported_at : d.toLocaleString();
  }

  /** 版本语义:pinned 显示已解析版本;auto 标注按生效日 */
  function versionLabel(r: BundleImportRecord): string {
    if (r.selection_mode === "pinned") {
      return r.resolved_version ? `固定 ${r.resolved_version}` : "固定";
    }
    return r.resolved_version
      ? `按生效日 ${r.resolved_version}`
      : "按生效日自动";
  }

  function hashOf(r: BundleImportRecord): string {
    return r.content_hash.length > 16
      ? `${r.content_hash.slice(0, 16)}…`
      : r.content_hash;
  }
</script>

<div class="bundle-imports-panel">
  <div class="panel-header">
    <h2>📦 部署历史(bundle 导入溯源)</h2>
    {#if cloud}
      <button
        class="refresh-btn"
        onclick={refresh}
        disabled={loading}
        title="重新拉取 bundle 导入溯源记录"
      >
        {loading ? "⏳ 拉取中…" : "↻ 刷新"}
      </button>
    {/if}
  </div>

  {#if !cloud}
    <div class="hint-box">
      部署历史仅在联网模式(连接 evorule-server)下可用;当前 backend 不提供该端点。
    </div>
  {:else if loadError}
    <div class="error-box" role="alert">部署历史拉取失败:{loadError}</div>
  {:else if imports.length === 0 && !loading}
    <div class="hint-box">
      暂无导入记录(尚未导入快照包,或 server 侧 workspace 元数据库未接线)。治理侧发布经部署通道导入后会出现在这里。
    </div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>导入时间</th>
            <th>Bundle</th>
            <th>数据集</th>
            <th>版本</th>
            <th>条目</th>
            <th>指纹(BLAKE3)</th>
            <th>导入者</th>
          </tr>
        </thead>
        <tbody>
          {#each imports as r (r.id)}
            <tr>
              <td class="time">{timeOf(r)}</td>
              <td class="mono" title={r.bundle_id}>{r.bundle_id}</td>
              <td>{r.dataset_id}</td>
              <td>
                <span class="ver">{r.source_version}</span>
                <span class="mode">{versionLabel(r)}</span>
              </td>
              <td class="num">{r.entry_count}</td>
              <td class="mono hash" title={r.content_hash}>{hashOf(r)}</td>
              <td>{r.imported_by}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="hint-box">共 {imports.length} 条导入记录(按时间倒序,最多 100 条)。</div>
  {/if}
</div>

<style>
  .bundle-imports-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--bg-card);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    padding: 12px;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .panel-header h2 {
    font-size: 15px;
    font-weight: 700;
    margin: 0;
    color: var(--text-primary, #1f2937);
  }
  .refresh-btn {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 5px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card);
    color: var(--text-secondary, #4b5563);
    cursor: pointer;
    font-family: inherit;
    font-weight: 600;
  }
  .refresh-btn:hover:not(:disabled) {
    background: var(--bg-page, #f9fafb);
  }
  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .hint-box {
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
    padding: 8px 10px;
    background: var(--bg-page, #f9fafb);
    border-radius: 6px;
  }
  .error-box {
    font-size: 12px;
    padding: 8px 10px;
    background: var(--danger-bg, #fef2f2);
    border: 1px solid var(--danger, #fca5a5);
    border-radius: 6px;
    color: var(--danger, #991b1b);
  }

  .table-wrap {
    overflow: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th {
    text-align: left;
    font-size: 11px;
    color: var(--text-secondary, #6b7280);
    font-weight: 700;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border, #e5e7eb);
    white-space: nowrap;
  }
  td {
    padding: 5px 8px;
    border-bottom: 1px solid var(--border, #f1f5f9);
    color: var(--text-primary, #1f2937);
  }
  .time {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--text-secondary, #4b5563);
  }
  .mono {
    font-family: monospace;
  }
  .hash {
    font-size: 11px;
    color: var(--text-secondary, #6b7280);
  }
  .ver {
    font-weight: 700;
    margin-right: 4px;
  }
  .mode {
    font-size: 11px;
    color: var(--text-secondary, #6b7280);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
</style>
