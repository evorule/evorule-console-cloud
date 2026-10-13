<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:本地装配导入浮层（06 号桥接方案 B2）
    列 console 本地数据集(规则装配单元) → 预检(入条数/跳过) → 桥接注册为
    治理域 rule_set 数据集(Draft) → 生命周期由人在本页既有闸推进。
  红线:桥接止步于注册+入条,不代推任何生命周期跃迁。
-->

<script lang="ts">
  import { get } from "svelte/store";
  import {
    governanceStore,
    selectDataset,
    refreshDatasets,
  } from "$lib/governance/governance-store";
  import {
    bridgeDatasetToGovernance,
    type BridgeResult,
  } from "$lib/governance/bridge";
  import { datasetStore } from "$lib/stores/dataset";
  import { assembleRuleset } from "$lib/dataset/assemble-ruleset";
  import {
    toastSuccess,
    toastError,
    toastWarning,
  } from "$lib/stores/toast";

  interface Props {
    /** 桥接成功(已刷新清单并选中新数据集) */
    onImported: (governanceDatasetId: string) => void;
    onClose: () => void;
  }

  let { onImported, onClose }: Props = $props();

  const localDatasets = $derived($datasetStore);
  const connected = $derived(
    get(governanceStore).connected && get(governanceStore).backend !== null,
  );

  let importingId = $state<string | null>(null);
  let lastResult = $state<{ id: string; result: BridgeResult } | null>(null);

  function preview(datasetId: string): {
    planned: number;
    skipped: number;
  } {
    const ds = $datasetStore.find((d) => d.id === datasetId);
    if (!ds) return { planned: 0, skipped: 0 };
    const a = assembleRuleset(ds);
    return { planned: a.ruleset.length, skipped: a.skippedRuleIds.length };
  }

  async function handleImport(localId: string): Promise<void> {
    const g = get(governanceStore);
    if (!g.connected || !g.backend) {
      toastWarning("请先连接规则资产库(:18081)");
      return;
    }
    const ds = $datasetStore.find((d) => d.id === localId);
    if (!ds) return;
    const pv = preview(localId);
    if (
      !window.confirm(
        `把本地数据集「${ds.name}」注册为治理域 rule_set 数据集?\n` +
          `将入条 ${pv.planned} 条规则` +
          (pv.skipped > 0 ? `(另有 ${pv.skipped} 条缺失将跳过)` : "") +
          `\n注册后为 Draft 态,生命周期由你在本页推进。`,
      )
    ) {
      return;
    }
    importingId = localId;
    try {
      const result = await bridgeDatasetToGovernance(ds, g.backend);
      if (result.aborted || !result.governanceDatasetId) {
        toastError(`桥接中止: ${result.error ?? "未知原因"}`);
        lastResult = { id: localId, result };
      } else {
        toastSuccess(
          `已注册治理域数据集 ${result.governanceDatasetId}(入条 ${result.entriesAdded} 条,Draft 态)`,
        );
        lastResult = { id: localId, result };
        await refreshDatasets().catch(() => undefined);
        selectDataset(result.governanceDatasetId);
        onImported(result.governanceDatasetId);
      }
    } catch (e) {
      toastError(`桥接失败: ${(e as Error).message}`);
    } finally {
      importingId = null;
    }
  }
</script>

<div
  class="li-overlay"
  role="presentation"
  onclick={(e) => {
    if (e.currentTarget === e.target) onClose();
  }}
>
  <div class="li-panel" role="dialog" aria-modal="true" aria-label="本地装配导入">
    <header class="li-header">
      <h3>📥 本地装配导入</h3>
      <button type="button" class="li-btn" onclick={onClose}>✕</button>
    </header>
    <p class="li-hint">
      本地数据集(规则装配单元)注册为治理域 rule_set 数据集(Draft 态);
      生命周期此后在本页推进,分发走既有 bundle 链。
    </p>

    {#if localDatasets.length === 0}
      <p class="li-empty">本地无数据集——先在导入/导出页创建装配。</p>
    {:else}
      <ul class="li-list">
        {#each localDatasets as ds (ds.id)}
          {@const pv = preview(ds.id)}
          <li class="li-row">
            <span class="li-name" title={ds.id}>{ds.name}</span>
            <span class="li-meta">
              {pv.planned} 条可入
              {#if pv.skipped > 0}(跳过 {pv.skipped}){/if}
              · {ds.ruleIds.length} 条引用
            </span>
            <button
              type="button"
              class="li-btn primary"
              disabled={importingId !== null}
              onclick={() => handleImport(ds.id)}
            >
              {importingId === ds.id ? "导入中…" : "注册"}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if lastResult}
      <div class="li-result" class:bad={lastResult.result.aborted}>
        {lastResult.result.aborted
          ? `上次中止: ${lastResult.result.error}`
          : `上次成功: ${lastResult.result.governanceDatasetId}(${lastResult.result.entriesAdded} 条)`}
      </div>
    {/if}

    <footer class="li-footer">
      <span class="li-hint">角色不足时 server 返回 403,原样提示。</span>
      <button type="button" class="li-btn" onclick={onClose}>关闭</button>
    </footer>
  </div>
</div>

<style>
  .li-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
  }
  .li-panel {
    background: var(--bg-card, #fff);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 10px;
    width: min(560px, 92vw);
    max-height: 76vh;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    overflow-y: auto;
  }
  .li-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .li-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
  }
  .li-hint {
    margin: 0;
    font-size: 11px;
    color: var(--text-secondary, #6b7280);
  }
  .li-empty {
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
    padding: 10px 0;
  }
  .li-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .li-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 6px;
  }
  .li-name {
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .li-meta {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-secondary, #6b7280);
    white-space: nowrap;
  }
  .li-btn {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 5px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card, #fff);
    color: var(--text-secondary, #4b5563);
    cursor: pointer;
    white-space: nowrap;
  }
  .li-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .li-btn.primary {
    border-color: var(--brand, #2563eb);
    color: var(--brand, #2563eb);
  }
  .li-btn.primary:hover:not(:disabled) {
    background: var(--info-bg, #eff6ff);
  }
  .li-result {
    font-size: 11px;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--success-bg, #ecfdf5);
    color: var(--success, #059669);
  }
  .li-result.bad {
    background: var(--danger-bg, #fee2e2);
    color: var(--danger, #dc2626);
  }
  .li-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
</style>
