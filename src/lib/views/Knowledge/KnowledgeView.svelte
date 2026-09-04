<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  KnowledgeView — 执行侧知识数据面浏览(UV-084 W5,UV-063 实化)
  数据面:执行域 :18080 /api/knowledge 端点族(只读,来自治理侧已发布
  knowledge bundle 的落盘数据;payload 零转译原样透传)。

  三段式:
    1. 数据集卡片(仅已承载数据集;entry_count/bundle/schema_refs 概览)
    2. 选中数据集 → 条目检索(q/domain/tags,server 侧过滤,与治理侧同语法)
    3. 条目详情(payload JSON 原样 + 溯源元信息,单条直取端点验证)

  错误纪律(对齐 server fail-fast 口径):
    - 知识库加载失败 500 → 显式错误条,禁止降级为静默空列表;
    - 数据集未承载 404 → 显式"未承载"提示(server 刻意区分"不存在"与"为空");
    - 单条目 404 → 详情区显式报错。
-->

<script lang="ts">
  import { onMount } from "svelte";
  import {
    useBackend,
    type KnowledgeDatasetSummary,
    type KnowledgeEntryRecord,
  } from "$lib/kernel";

  const backend = useBackend();

  // === 数据集清单态 ===
  let datasets = $state<KnowledgeDatasetSummary[]>([]);
  let loading = $state(false);
  let listError = $state<string | null>(null);

  // === 选中数据集 + 条目检索态 ===
  let selectedDataset = $state<KnowledgeDatasetSummary | null>(null);
  let entries = $state<KnowledgeEntryRecord[]>([]);
  let entriesLoading = $state(false);
  let entriesError = $state<string | null>(null);
  let filterQ = $state("");
  let filterDomain = $state("");
  let filterTags = $state("");
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  // === 条目详情态 ===
  let detailEntry = $state<KnowledgeEntryRecord | null>(null);
  let detailLoading = $state(false);
  let detailError = $state<string | null>(null);
  let detailDatasetId = $state("");

  // === 数据集清单加载(库 500 → 显式错误,不静默空) ===
  async function reload(): Promise<void> {
    loading = true;
    listError = null;
    try {
      const r = await backend.listKnowledgeDatasets();
      datasets = r.datasets;
    } catch (e) {
      datasets = [];
      listError = `知识数据面读取失败: ${(e as Error).message}`;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void reload();
  });

  // === 条目检索(server 侧过滤;404=数据集未承载,显式呈现) ===
  async function loadEntries(dataset: KnowledgeDatasetSummary): Promise<void> {
    selectedDataset = dataset;
    detailEntry = null;
    detailError = null;
    entriesLoading = true;
    entriesError = null;
    try {
      entries = await backend.listKnowledgeEntries(dataset.dataset_id, {
        q: filterQ || undefined,
        domain: filterDomain || undefined,
        tags: filterTags || undefined,
      });
    } catch (e) {
      entries = [];
      entriesError = `条目检索失败: ${(e as Error).message}`;
    } finally {
      entriesLoading = false;
    }
  }

  function closeDataset(): void {
    selectedDataset = null;
    entries = [];
    entriesError = null;
    detailEntry = null;
    filterQ = "";
    filterDomain = "";
    filterTags = "";
  }

  // q 输入防抖后重查(300ms;domain/tags 由按钮触发)
  function onQInput(): void {
    if (!selectedDataset) return;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      void loadEntries(selectedDataset!);
    }, 300);
  }

  // === 条目详情(单条直取,验证第三端点) ===
  async function openDetail(entry: KnowledgeEntryRecord): Promise<void> {
    if (!selectedDataset) return;
    detailDatasetId = selectedDataset.dataset_id;
    detailEntry = null;
    detailError = null;
    detailLoading = true;
    try {
      detailEntry = await backend.getKnowledgeEntry(
        selectedDataset.dataset_id,
        entry.entry_id,
      );
    } catch (e) {
      detailError = `条目详情读取失败: ${(e as Error).message}`;
    } finally {
      detailLoading = false;
    }
  }

  function closeDetail(): void {
    detailEntry = null;
    detailError = null;
  }

  const prettyPayload = $derived(
    detailEntry ? JSON.stringify(detailEntry.payload, null, 2) : "",
  );
</script>

<div class="kv">
  <header class="kv-head">
    <div>
      <h1>知识库</h1>
      <p class="kv-sub">
        执行侧数据资产面(只读) — 来自治理侧已发布的 knowledge bundle 落盘数据
      </p>
    </div>
    <button class="btn ghost" onclick={() => void reload()} disabled={loading}>
      {loading ? "加载中…" : "刷新"}
    </button>
  </header>

  {#if loading}
    <p class="kv-status">正在加载数据集清单…</p>
  {:else if listError}
    <!-- 知识库加载失败(500):数据面异常必须可见,拒绝静默空列表 -->
    <p class="kv-error" role="alert">⚠ {listError}</p>
  {:else if datasets.length === 0}
    <p class="kv-empty">
      当前实例尚未承载任何知识数据资产。数据经由治理中心发布 knowledge
      bundle 后落盘至此执行实例 —— 发布链路见治理中心「发布队列」。
    </p>
  {:else if !selectedDataset}
    <!-- 段 1:数据集卡片 -->
    <div class="ds-grid">
      {#each datasets as ds (ds.dataset_id)}
        <button
          class="ds-card"
          onclick={() => void loadEntries(ds)}
          aria-label={`打开数据集 ${ds.dataset_id}`}
        >
          <span class="ds-id">{ds.dataset_id}</span>
          <span class="ds-count">{ds.entry_count} 条数据资产</span>
          <span class="ds-meta">bundle: {ds.bundle_ids.join(", ") || "—"}</span>
          {#if ds.schema_refs.length > 0}
            <span class="ds-meta">schema: {ds.schema_refs.length} 个引用</span>
          {/if}
        </button>
      {/each}
    </div>
  {:else}
    <!-- 段 2:条目检索 -->
    <div class="ds-toolbar">
      <button class="btn ghost" onclick={closeDataset}>← 返回数据集</button>
      <span class="ds-title">{selectedDataset.dataset_id}</span>
      <span class="ds-count-inline">{selectedDataset.entry_count} 条</span>
    </div>

    <div class="filter-bar">
      <input
        class="fi q"
        type="search"
        placeholder="检索条目(payload 子串)…"
        bind:value={filterQ}
        oninput={onQInput}
      />
      <input
        class="fi"
        type="text"
        placeholder="domain(精确)"
        bind:value={filterDomain}
      />
      <input
        class="fi"
        type="text"
        placeholder="tags(逗号分隔,任一命中)"
        bind:value={filterTags}
      />
      <button
        class="btn"
        onclick={() => void loadEntries(selectedDataset!)}
        disabled={entriesLoading}
      >
        检索
      </button>
    </div>

    {#if entriesLoading}
      <p class="kv-status">检索中…</p>
    {:else if entriesError}
      <!-- 404(未承载/不存在)与 500 均显式呈现 -->
      <p class="kv-error" role="alert">⚠ {entriesError}</p>
    {:else if entries.length === 0}
      <p class="kv-empty">无匹配条目(过滤条件过严或该数据集暂无资产)。</p>
    {:else}
      <table class="entry-table">
        <thead>
          <tr>
            <th>entry_id</th>
            <th>domain</th>
            <th>tags</th>
            <th>bundle</th>
            <th>源版本</th>
            <th>schema</th>
          </tr>
        </thead>
        <tbody>
          {#each entries as en (en.dataset_id + ":" + en.entry_id)}
            <tr
              class="entry-row"
              onclick={() => void openDetail(en)}
              role="button"
              tabindex="0"
              onkeydown={(e) => {
                if (e.key === "Enter") void openDetail(en);
              }}
            >
              <td class="mono">{en.entry_id}</td>
              <td>{en.domain || "—"}</td>
              <td>
                {#if en.tags.length > 0}
                  {#each en.tags as t (t)}<span class="tag">{t}</span>{/each}
                {:else}—{/if}
              </td>
              <td class="mono">{en.bundle_id}</td>
              <td class="mono">{en.source_version}</td>
              <td>{en.schema_ref ? "已挂" : "—"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}

  <!-- 段 3:条目详情(payload 原样 + 溯源) -->
  {#if detailLoading}
    <p class="kv-status">读取条目详情…</p>
  {:else if detailError}
    <p class="kv-error" role="alert">⚠ {detailError}</p>
  {:else if detailEntry}
    <div
      class="detail"
      role="dialog"
      aria-label={`条目详情 ${detailEntry.entry_id}`}
      tabindex="-1"
    >
      <div class="detail-head">
        <span class="detail-title mono">{detailEntry.entry_id}</span>
        <button class="btn ghost" onclick={closeDetail}>关闭</button>
      </div>
      <dl class="detail-meta">
        <div><dt>数据集</dt><dd class="mono">{detailEntry.dataset_id}</dd></div>
        <div><dt>来源 bundle</dt><dd class="mono">{detailEntry.bundle_id}</dd></div>
        <div><dt>治理侧源版本</dt><dd class="mono">{detailEntry.source_version}</dd></div>
        <div><dt>domain</dt><dd>{detailEntry.domain || "—"}</dd></div>
        <div>
          <dt>tags</dt>
          <dd>
            {#if detailEntry.tags.length > 0}
              {#each detailEntry.tags as t (t)}<span class="tag">{t}</span>{/each}
            {:else}—{/if}
          </dd>
        </div>
        <div>
          <dt>schema</dt>
          <dd class="mono">{detailEntry.schema_ref ?? "未挂载"}</dd>
        </div>
      </dl>
      <h3 class="payload-title">payload(零转译原样)</h3>
      <pre class="payload">{prettyPayload}</pre>
    </div>
  {/if}
</div>

<style>
  .kv {
    max-width: 1100px;
    margin: 0 auto;
    padding: 24px 20px 48px;
  }
  .kv-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
  }
  .kv-head h1 {
    margin: 0 0 4px;
    font-size: 20px;
  }
  .kv-sub {
    margin: 0;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .kv-status,
  .kv-empty {
    font-size: 13px;
    color: var(--text-secondary);
    padding: 12px 0;
  }
  .kv-error {
    margin: 8px 0;
    padding: 10px 12px;
    font-size: 13px;
    border: 1px solid var(--danger, #dc2626);
    border-radius: 6px;
    background: var(--danger-bg, #fef2f2);
    color: var(--danger, #b91c1c);
    word-break: break-all;
  }
  /* 段 1:数据集卡片 */
  .ds-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
  }
  .ds-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px 16px;
    text-align: left;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    background: var(--bg-card, #fff);
    cursor: pointer;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .ds-card:hover {
    border-color: var(--accent, #2563eb);
    box-shadow: 0 1px 6px rgb(0 0 0 / 0.08);
  }
  .ds-id {
    font-family: ui-monospace, monospace;
    font-size: 14px;
    font-weight: 600;
  }
  .ds-count {
    font-size: 13px;
    color: var(--accent, #2563eb);
  }
  .ds-meta {
    font-size: 12px;
    color: var(--text-secondary);
    word-break: break-all;
  }
  /* 段 2:工具栏 + 过滤 + 表 */
  .ds-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }
  .ds-title {
    font-family: ui-monospace, monospace;
    font-size: 15px;
    font-weight: 600;
  }
  .ds-count-inline {
    font-size: 12px;
    color: var(--text-secondary);
  }
  .filter-bar {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .fi {
    padding: 6px 10px;
    font-size: 13px;
    border: 1px solid var(--border, #d1d5db);
    border-radius: 6px;
  }
  .fi.q {
    flex: 1 1 240px;
  }
  .fi:not(.q) {
    width: 180px;
  }
  .btn {
    padding: 6px 14px;
    font-size: 13px;
    border: 1px solid var(--border, #d1d5db);
    border-radius: 6px;
    background: var(--bg-card, #fff);
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    border-color: var(--accent, #2563eb);
  }
  .btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .btn.ghost {
    border-color: transparent;
    background: transparent;
    color: var(--accent, #2563eb);
  }
  .entry-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .entry-table th {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 2px solid var(--border, #e5e7eb);
    color: var(--text-secondary);
    font-weight: 500;
    white-space: nowrap;
  }
  .entry-table td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border, #f3f4f6);
  }
  .entry-row {
    cursor: pointer;
  }
  .entry-row:hover {
    background: var(--bg-hover, #f9fafb);
  }
  .mono {
    font-family: ui-monospace, monospace;
    font-size: 12px;
    word-break: break-all;
  }
  .tag {
    display: inline-block;
    margin-right: 4px;
    padding: 1px 8px;
    font-size: 11px;
    border-radius: 999px;
    background: var(--tag-bg, #eff6ff);
    color: var(--accent, #2563eb);
  }
  /* 段 3:详情 */
  .detail {
    margin-top: 16px;
    padding: 16px;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    background: var(--bg-card, #fff);
  }
  .detail-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .detail-title {
    font-size: 14px;
    font-weight: 600;
  }
  .detail-meta {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px 16px;
    margin: 0 0 12px;
  }
  .detail-meta div {
    display: flex;
    gap: 6px;
  }
  .detail-meta dt {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .detail-meta dd {
    margin: 0;
    font-size: 12px;
    word-break: break-all;
  }
  .payload-title {
    margin: 0 0 6px;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .payload {
    margin: 0;
    padding: 12px;
    max-height: 420px;
    overflow: auto;
    font-family: ui-monospace, monospace;
    font-size: 12px;
    line-height: 1.5;
    border: 1px solid var(--border, #f3f4f6);
    border-radius: 6px;
    background: var(--bg-code, #f8fafc);
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
