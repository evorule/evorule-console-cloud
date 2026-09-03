<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  监控摘要 widget(UV-021 W1d,MVP 粒度,§7.3 裁定):
    - 生产状态(running/switching/offline)+ 规则集版本 两个关键数字
    - 「进入大屏」直达 /monitor(完整 MonitorDashboard)
  数据自取:getProductionState()(失败降级 offline,大屏不因一次失败而崩——
  CloudHttpBackend 既有容错语义);15s 轮询与宿主节奏一致。
  权限:view_monitor(注册表声明,无权用户整卡隐藏)。
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { useBackend } from "$lib/kernel";
  import type { CloudHttpBackend } from "$lib/backend/cloud-http-backend";
  import { DEFAULT_PRODUCTION_STATE, type ProductionState } from "$lib/backend/production-views";

  const backend = useBackend();

  let prod = $state<ProductionState>({ ...DEFAULT_PRODUCTION_STATE });
  let loadError = $state<string | null>(null);
  let timer: ReturnType<typeof setInterval> | undefined;

  // P2-02(Mavis 01):「离线」与顶栏「已连接」语义重叠致新手困惑。
  // 生产状态 status=offline 实指「无活跃生产 session」(见 production-views.ts:
  // current_session_id == null → offline),非系统掉线,故改标「未运行」。
  const statusLabel = $derived(
    prod.status === "running"
      ? "运行中"
      : prod.status === "switching"
        ? // P3-01(Mavis 01):switching = 滚动 session 零停机切换,UI 明示其含义
          "切换中 · 零停机"
        : "未运行"
  );
  const statusClass = $derived(
    prod.status === "running" ? "ok" : prod.status === "switching" ? "warn" : "off"
  );

  async function load(): Promise<void> {
    try {
      const b = backend as CloudHttpBackend;
      if (typeof b.getProductionState === "function") {
        prod = await b.getProductionState();
        loadError = null;
      } else {
        // mock 等非 cloud 后端:如实显示暂不可用,不假装离线
        loadError = "当前后端不提供生产状态查询";
      }
    } catch (e) {
      loadError = `生产状态获取失败:${(e as Error).message}`;
    }
  }

  onMount(() => {
    void load();
    timer = setInterval(() => void load(), 15000);
    return () => {
      if (timer) clearInterval(timer);
    };
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

<div class="region-monitor">
  <h2 class="region-title"><span class="icon">📊</span>生产运行摘要</h2>
  {#if loadError}
    <div class="error-row">
      <span>⚠️ {loadError}</span>
      <button class="retry" onclick={() => void load()}>重试</button>
    </div>
  {:else}
    <div class="metrics">
      <div class="metric">
        <span class="metric-label">运行状态</span>
        <span class="metric-value {statusClass}">{statusLabel}</span>
      </div>
      <div class="metric">
        <span class="metric-label">规则集版本</span>
        <span class="metric-value">v{prod.rulesetVersion}</span>
      </div>
      <div class="metric">
        <span class="metric-label">生产 Session</span>
        <span class="metric-value">{prod.currentSessionId ?? "—"}</span>
      </div>
      <button class="enter-btn" onclick={() => goto("/monitor")}>进入大屏 →</button>
    </div>
  {/if}
</div>

<style>
  .region-monitor {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
  }
  .region-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 12px;
  }
  .icon {
    margin-right: 4px;
  }
  .metrics {
    display: flex;
    gap: 24px;
    align-items: center;
    flex-wrap: wrap;
  }
  .metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .metric-label {
    font-size: 12px;
    color: var(--text-secondary);
  }
  .metric-value {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .metric-value.ok {
    color: var(--success);
  }
  .metric-value.warn {
    color: var(--warning);
  }
  .metric-value.off {
    color: var(--text-muted);
  }
  .enter-btn {
    margin-left: auto;
    padding: 6px 14px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .error-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--danger);
  }
  .retry {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    background: var(--bg-hover);
    color: var(--text-primary);
  }
</style>
