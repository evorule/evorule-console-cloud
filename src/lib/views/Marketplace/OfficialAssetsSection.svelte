<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:marketplace「官方资产」分区(47 号接线专项)
    - 从治理服务(evorule-rule :18081)发现官方数据集(公开 + 已上架)
    - 四态:未连接引导 / 加载中 / 空态(准入口径说明) / 资产卡片网格
    - 下载预览包(evidence=none,执行域必拒导入,语义如实标注)
    - 部署到执行域(导航治理页既有证据门禁面板,市场不绕闸)
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import {
    officialAssets,
    officialAssetsUi,
    refreshOfficialAssets,
    buildAssetPreviewBundle,
    deployOfficialAsset,
    reconnectWithSavedConfig,
  } from "$lib/stores/official-assets";
  import { governanceConfig } from "$lib/config/governance-config";
  import { governanceStore } from "$lib/governance/governance-store";
  import { toastError, toastSuccess } from "$lib/stores/toast";
  import { fmtDate } from "$lib/locale";

  const KIND_LABELS: Record<string, string> = {
    rule_set: "规则集",
    knowledge: "数据资产",
  };

  /** 连接但数据集列表为空时自动拉一次(已加载过则不重复打) */
  onMount(() => {
    if ($governanceStore.connected && $governanceStore.datasets.length === 0) {
      void refreshOfficialAssets().catch(() => {
        /* 错误已写入 officialAssetsUi 并上屏,此处无需重复提示 */
      });
    }
  });

  function handleRefresh(): void {
    refreshOfficialAssets().catch((e) =>
      toastError(e instanceof Error ? e.message : String(e), "官方资产"),
    );
  }

  /** 下载预览包:store 构建Blob → 浏览器保存(DOM 触发保持薄) */
  async function handleDownload(ds: (typeof $officialAssets)[number]) {
    try {
      const { filename, blob } = await buildAssetPreviewBundle(ds);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toastSuccess(`预览包已下载:${filename}(未附证据,执行域拒绝导入)`, "官方资产");
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e), "下载预览包");
    }
  }

  function handleDeploy(ds: (typeof $officialAssets)[number]) {
    try {
      deployOfficialAsset(ds);
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e), "部署官方资产");
    }
  }

  /** 一键重连:用已存凭据走治理页同一 connect() 通道;失败原文 toast,不静默 */
  async function handleReconnect(): Promise<void> {
    try {
      await reconnectWithSavedConfig();
      toastSuccess("治理服务已重连", "官方资产");
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e), "重连治理服务");
    }
  }

  function fmtAssetDate(v: string | null | undefined): string {
    if (!v) return "—";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "—" : fmtDate(d);
  }
</script>

<div class="oa-section">
  <!-- 未连接:引导去治理中心(不静默假装无资产) -->
  {#if !$governanceStore.connected}
    <div class="oa-empty">
      🔌 尚未连接治理服务
      <p class="oa-empty-hint">
        官方资产来自治理中心 evorule-rule(:18081)已上架的数据集。
        请先在治理中心完成连接(凭据与主系统独立)。
      </p>
      {#if $governanceConfig.username && $governanceConfig.password}
        <button class="oa-btn primary" onclick={handleReconnect} disabled={$officialAssetsUi.loading}>
          {$officialAssetsUi.loading ? "重连中…" : "⚡ 一键重连(使用已存凭据)"}
        </button>
        <p class="oa-empty-hint">已存凭据:{$governanceConfig.username}@{$governanceConfig.baseUrl}</p>
      {/if}
      <button class="oa-btn" onclick={() => goto("/governance")}>
        前往治理中心连接
      </button>
    </div>
  {:else}
    <div class="oa-toolbar">
      <span class="oa-count">共 {$officialAssets.length} 个官方资产</span>
      <button class="oa-btn" onclick={handleRefresh} disabled={$officialAssetsUi.loading}>
        {$officialAssetsUi.loading ? "刷新中…" : "↻ 刷新"}
      </button>
    </div>

    {#if $officialAssetsUi.error}
      <p class="oa-error" role="alert">⚠ {$officialAssetsUi.error}</p>
    {/if}

    {#if $officialAssets.length === 0}
      <div class="oa-empty">
        🏛️ 尚未上架
        <p class="oa-empty-hint">
          准入口径:数据集在治理中心标记为「公开」且生命周期为「已上架」(独立审批通过)。
          运营方在治理中心完成 authoring → 沙盒验收 → 上架后,资产会出现在此处。
        </p>
        <button class="oa-btn" onclick={handleRefresh} disabled={$officialAssetsUi.loading}>
          ↻ 重新检查
        </button>
      </div>
    {:else}
      <div class="oa-grid">
        {#each $officialAssets as ds (ds.dataset_id)}
          <article class="oa-card">
            <header class="oa-card-head">
              <h4 class="oa-name" title={ds.dataset_id}>{ds.name}</h4>
              <span class="oa-badge version">{ds.versioning.current}</span>
            </header>
            <p class="oa-desc">{ds.description ?? "(无描述)"}</p>
            <div class="oa-chips">
              {#if ds.dataset_kind}
                <span class="oa-chip kind">{KIND_LABELS[ds.dataset_kind] ?? ds.dataset_kind}</span>
              {/if}
              <span class="oa-chip lifecycle">已上架</span>
              {#each ds.domain as dom (dom)}
                <span class="oa-chip">{dom}</span>
              {/each}
              {#each ds.tags as tag (tag)}
                <span class="oa-chip tag">{tag}</span>
              {/each}
            </div>
            <p class="oa-meta">
              维护者:{ds.meta.created_by || "—"} · 更新:{fmtAssetDate(ds.meta.updated_at ?? ds.meta.created_at)}
            </p>
            <footer class="oa-actions">
              <button
                class="oa-btn"
                onclick={() => handleDownload(ds)}
                disabled={$officialAssetsUi.downloadingId === ds.dataset_id}
                title="导出无证据预览包(执行域拒绝导入),仅用于本地检视"
              >
                {$officialAssetsUi.downloadingId === ds.dataset_id ? "导出中…" : "⬇️ 下载预览包"}
              </button>
              <button
                class="oa-btn primary"
                onclick={() => handleDeploy(ds)}
                title="跳转治理中心,走既有证据门禁部署到执行域"
              >
                🚀 部署到执行域
              </button>
            </footer>
          </article>
        {/each}
      </div>
      <p class="oa-footnote">
        部署将跳转治理中心部署面板:需选择证据形态(沙盒机器背书 / 人工确认降级)并勾选部署确认;
        预览包未附证据,执行域闸门一将拒绝导入。
      </p>
    {/if}
  {/if}
</div>

<style>
  .oa-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .oa-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .oa-count {
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
  }
  .oa-error {
    margin: 0;
    padding: 8px 12px;
    font-size: 12px;
    border: 1px solid var(--warning, #f59e0b);
    border-radius: 6px;
    background: var(--warning-bg, #fef3c7);
    color: var(--warning-text, #92400e);
  }
  .oa-empty {
    padding: 40px;
    text-align: center;
    color: var(--text-secondary, #6b7280);
    font-size: 14px;
    background: #f9fafb;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .oa-empty-hint {
    margin: 0 auto;
    max-width: 480px;
    font-size: 13px;
    opacity: 0.85;
  }
  .oa-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }
  .oa-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    background: var(--bg-card, #ffffff);
  }
  .oa-card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .oa-name {
    margin: 0;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .oa-badge.version {
    flex-shrink: 0;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    background: var(--brand-bg, #eff6ff);
    color: var(--brand, #2563eb);
  }
  .oa-desc {
    margin: 0;
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .oa-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .oa-chip {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 10px;
    background: #f3f4f6;
    color: var(--text-secondary, #4b5563);
  }
  .oa-chip.kind {
    background: var(--brand-bg, #eff6ff);
    color: var(--brand, #2563eb);
  }
  .oa-chip.lifecycle {
    background: #dcfce7;
    color: #166534;
  }
  .oa-chip.tag {
    background: #fef9c3;
    color: #854d0e;
  }
  .oa-meta {
    margin: 0;
    font-size: 11px;
    color: var(--text-secondary, #9ca3af);
  }
  .oa-actions {
    display: flex;
    gap: 8px;
    margin-top: auto;
  }
  .oa-btn {
    padding: 6px 12px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card);
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary, #4b5563);
  }
  .oa-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .oa-btn.primary {
    background: var(--brand, #2563eb);
    border-color: var(--brand, #2563eb);
    color: white;
  }
  .oa-footnote {
    margin: 0;
    font-size: 11px;
    color: var(--text-secondary, #9ca3af);
  }
</style>
