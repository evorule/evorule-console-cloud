<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:规则命中分析面板（G1 立项:hit-stats 查询面前端,server 侧聚合器既有）
    - 头部:规则集版本/总规则数/生成时间 + 筛选切换(all/hit/zero)
    - 命中表:来源/下标/指令类型/命中数/最近命中
    - 零命中清单:死规则候选
    - 行点击展开:单规则跨版本命中切片(GET /api/rules/hit-stats/{rule_key})
  数据语义:server 进程内存聚合(消费引擎 TransitionTrace 归因),重启归零;
  全量权威在审计链 WAL。规则键 = {index}@{source}(server 合并列表视角)。
-->

<script lang="ts">
  import { useBackend } from "$lib/kernel";
  import { CloudHttpBackend } from "$lib/backend/cloud-http-backend";
  import {
    toastError,
  } from "$lib/stores/toast";

  type Filter = "all" | "hit" | "zero";

  interface HitStatEntry {
    source: string;
    index: number;
    instr_type: string;
    hit_count: number;
    first_hit_seq: number;
    last_hit_seq: number;
    last_hit_at_ms: number;
  }
  interface ZeroHitEntry {
    source: string;
    index: number;
    instr_type: string;
  }
  interface HitStatsResponse {
    ruleset_version: string;
    total_rules: number;
    generated_at_ms: number;
    entries: HitStatEntry[];
    zero_hits: ZeroHitEntry[];
  }
  interface VersionStatEntry {
    version: string;
    hit_count: number;
    last_hit_at_ms: number;
  }
  interface RuleSeriesResponse {
    source: string;
    index: number;
    instr_type: string;
    hit_total: number;
    series: VersionStatEntry[];
  }

  const backend = useBackend() as CloudHttpBackend;

  let filter = $state<Filter>("all");
  let data = $state<HitStatsResponse | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let expanded = $state<string | null>(null);
  let series = $state<RuleSeriesResponse | null>(null);
  let seriesLoading = $state(false);

  const MAX_HIT_AT_CAP = 946684800000; // 2000-01-01:低于此值视为占位(无真实墙钟)

  async function refresh(f: Filter = filter): Promise<void> {
    loading = true;
    error = null;
    try {
      const qs = f === "all" ? "" : `?filter=${f}`;
      data = (await backend.getHitStats(qs)) as HitStatsResponse;
      expanded = null;
      series = null;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function toggleSeries(entry: HitStatEntry): Promise<void> {
    const key = `${entry.index}@${encodeURIComponent(entry.source)}`;
    if (expanded === key) {
      expanded = null;
      series = null;
      return;
    }
    expanded = key;
    seriesLoading = true;
    series = null;
    try {
      series = (await backend.getRuleHitSeries(key)) as RuleSeriesResponse;
    } catch (e) {
      toastError(`切片读取失败: ${(e as Error).message}`);
      expanded = null;
    } finally {
      seriesLoading = false;
    }
  }

  function fmtTime(ms: number): string {
    if (!ms || ms < MAX_HIT_AT_CAP) return "—";
    const d = new Date(ms);
    return d.toLocaleString("sv-SE").replace("T", " ");
  }

  const maxHit = $derived(
    data ? Math.max(1, ...data.entries.map((e) => e.hit_count)) : 1,
  );

  const zeroKeys = $derived(
    new Set((data?.zero_hits ?? []).map((z) => `${z.index}@${z.source}`)),
  );
</script>

<div class="hs" aria-label="规则命中分析">
  <header class="hs-head">
    <div>
      <h2>📊 规则命中分析</h2>
      {#if data}
        <p class="hs-sub">
          规则集版本 <code>{data.ruleset_version}</code> · 共 {data.total_rules} 条
          · 生成 {fmtTime(data.generated_at_ms)}
        </p>
      {:else}
        <p class="hs-sub">server 侧聚合器视角的结构命中统计(进程内存,重启归零;权威在审计链)。</p>
      {/if}
    </div>
    <div class="hs-tools">
      <div class="hs-tabs" role="tablist">
        {#each ["all", "hit", "zero"] as f (f)}
          <button
            type="button"
            class="hs-tab"
            class:active={filter === f}
            role="tab"
            aria-selected={filter === f}
            onclick={() => {
              filter = f as Filter;
              void refresh(filter);
            }}
          >
            {f === "all" ? "全部" : f === "hit" ? "已命中" : "零命中"}
          </button>
        {/each}
      </div>
      <button type="button" class="hs-btn" disabled={loading} onclick={() => void refresh()}>
        {loading ? "加载中…" : "⟳ 刷新"}
      </button>
    </div>
  </header>

  {#if loading}
    <p class="hs-status">加载中…</p>
  {:else if error}
    <div class="hs-status hs-err">
      {error}
      <button type="button" class="hs-btn" onclick={() => void refresh()}>重试</button>
    </div>
  {:else if !data}
    <p class="hs-status">切一个筛选或刷新加载。</p>
  {:else}
    {#if data.entries.length === 0 && data.zero_hits.length === 0}
      <p class="hs-status">当前版本暂无统计(规则集刚加载且尚无命令执行)。</p>
    {:else}
      <table class="hs-table">
        <thead>
          <tr>
            <th>来源</th>
            <th>下标</th>
            <th>指令类型</th>
            <th class="num">命中数</th>
            <th class="bar">分布</th>
            <th>最近命中</th>
            <th>切片</th>
          </tr>
        </thead>
        <tbody>
          {#each data.entries as e ( `${e.index}@${e.source}` )}
            {@const key = `${e.index}@${e.source}`}
            <tr class:zero={zeroKeys.has(key)}>
              <td><code class="hs-src">{e.source}</code></td>
              <td class="num">{e.index}</td>
              <td><code>{e.instr_type}</code></td>
              <td class="num strong">{e.hit_count}</td>
              <td class="bar">
                <span
                  class="hs-bar"
                  style="width: {Math.round((e.hit_count / maxHit) * 100)}%"
                ></span>
              </td>
              <td>{fmtTime(e.last_hit_at_ms)}</td>
              <td>
                <button
                  type="button"
                  class="hs-btn sm"
                  onclick={() => void toggleSeries(e)}
                >
                  {expanded === key ? "收起" : "跨版本"}
                </button>
              </td>
            </tr>
            {#if expanded === key}
              <tr class="series-row">
                <td colspan="7">
                  {#if seriesLoading}
                    <p class="hs-status">切片加载中…</p>
                  {:else if series}
                    <p class="hs-series-sum">
                      跨版本累计命中 {series.hit_total} · 已知版本 {series.series.length} 个
                    </p>
                    <ul class="hs-series">
                      {#each series.series as pt (pt.version)}
                        <li>
                          <code>{pt.version}</code>
                          <span class="hs-bar sm"
                            style="width: {Math.round(
                              (pt.hit_count / Math.max(1, series.hit_total)) * 100
                            )}%"></span>
                          <span class="num">{pt.hit_count}</span>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>

      {#if data.zero_hits.length > 0}
        <section class="hs-zero">
          <h3>零命中清单（死规则候选,{data.zero_hits.length} 条）</h3>
          <ul class="hs-zero-list">
            {#each data.zero_hits as z ( `${z.index}@${z.source}` )}
              <li>
                <code class="hs-src">{z.source}</code>
                <span class="num">#{z.index}</span>
                <code>{z.instr_type}</code>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .hs {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 20px;
    min-height: 0;
  }
  .hs-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    flex-wrap: wrap;
  }
  .hs-head h2 {
    margin: 0;
    font-size: 18px;
    color: var(--text-primary, #1e293b);
  }
  .hs-sub {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
  }
  .hs-sub code {
    font-family: var(--font-mono, monospace);
  }
  .hs-tools {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .hs-tabs {
    display: flex;
    border: 1px solid var(--border, #d1d5db);
    border-radius: 6px;
    overflow: hidden;
  }
  .hs-tab {
    font-size: 12px;
    padding: 5px 12px;
    border: none;
    background: var(--bg-card, #fff);
    color: var(--text-secondary, #4b5563);
    cursor: pointer;
  }
  .hs-tab.active {
    background: var(--brand, #2563eb);
    color: #fff;
  }
  .hs-btn {
    font-size: 12px;
    padding: 5px 10px;
    border-radius: 5px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card, #fff);
    color: var(--text-secondary, #4b5563);
    cursor: pointer;
  }
  .hs-btn.sm {
    font-size: 11px;
    padding: 3px 8px;
  }
  .hs-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .hs-status {
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
  }
  .hs-err {
    color: var(--danger, #dc2626);
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .hs-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .hs-table th {
    text-align: left;
    font-size: 11px;
    color: var(--text-secondary, #6b7280);
    border-bottom: 1px solid var(--border, #e5e7eb);
    padding: 6px 8px;
  }
  .hs-table td {
    padding: 5px 8px;
    border-bottom: 1px solid var(--border, #f1f5f9);
  }
  .hs-table tr.zero td {
    opacity: 0.55;
  }
  .hs-table .num {
    text-align: right;
    font-family: var(--font-mono, monospace);
  }
  .hs-table .strong {
    font-weight: 700;
  }
  .hs-src {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
  }
  .hs-bar {
    display: inline-block;
    height: 8px;
    min-width: 2px;
    background: var(--brand, #2563eb);
    border-radius: 4px;
  }
  .hs-bar.sm {
    height: 6px;
  }
  .series-row td {
    background: var(--bg-page, #f8fafc);
  }
  .hs-series-sum {
    margin: 0 0 6px;
    font-size: 11px;
    color: var(--text-secondary, #6b7280);
  }
  .hs-series {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .hs-series li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }
  .hs-series code {
    font-family: var(--font-mono, monospace);
    min-width: 130px;
  }
  .hs-zero {
    border-top: 1px dashed var(--border, #e5e7eb);
    padding-top: 10px;
  }
  .hs-zero h3 {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 700;
    color: var(--text-secondary, #4b5563);
  }
  .hs-zero-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 4px 12px;
    font-size: 11px;
  }
  .hs-zero-list li {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
</style>
