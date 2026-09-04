<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  系统状态 widget:包装 WorkbenchTop(UV-021 注册表化)。
  数据自取:订阅 workbenchStatus store(宿主轮询产物)+ workspace/mode store。
  UV-062 ⑨:追加执行侧服务清单(GET /api/services,紧凑列表):
    - 服务名 / 类型(native|registry)/ 状态(已绑定,该端点即绑定能力全集)
    - 自取数据;随宿主刷新(lastRefreshAt 变化)重拉,对齐数据刷新模式
    - 失败显式「服务清单不可用」态,不阻塞既有连接状态显示
-->

<script lang="ts">
  import { onMount } from "svelte";
  import WorkbenchTop from "../WorkbenchTop.svelte";
  import {
    currentWorkspace,
    CONSOLE_VERSION,
    useBackend,
  } from "$lib/kernel";
  import { netConfig } from "$lib/config/net-config";
  import { workbenchStatus, workbenchRefreshNow } from "$lib/stores/workbench-status";
  import { goto } from "$app/navigation";
  import {
    CloudHttpBackend,
    type BoundServiceInfo,
  } from "$lib/backend/cloud-http-backend";

  const ws = $derived($currentWorkspace);
  const mode = $derived($netConfig.mode);
  const st = $derived($workbenchStatus);

  function showOnboarding(): void {
    void goto("/?task=open");
  }

  // === 服务清单(UV-062 ⑨,GET /api/services) ===
  const backend = useBackend();
  const cloud = backend instanceof CloudHttpBackend ? backend : null;

  let services = $state<BoundServiceInfo[] | null>(null);
  let servicesError = $state<string | null>(null);
  let servicesLoading = $state(false);
  /** 上次已见的宿主刷新时间(去重;onMount 捕获初值,避免与首次拉取重复) */
  let lastSeenRefresh: Date | null = null;

  async function loadServices(): Promise<void> {
    if (!cloud) return;
    servicesLoading = true;
    servicesError = null;
    try {
      services = await cloud.listServices();
    } catch (e) {
      // fail-fast:失败显式可见(服务清单不可用态),不静默保留旧数据
      services = null;
      servicesError = (e as Error).message;
    } finally {
      servicesLoading = false;
    }
  }

  onMount(() => {
    lastSeenRefresh = st.lastRefreshAt;
    if (cloud) void loadServices();
  });

  // 对齐宿主刷新节奏:宿主 refresh 完成会 patch lastRefreshAt → 重拉服务清单
  $effect(() => {
    const at = st.lastRefreshAt;
    if (at && at !== lastSeenRefresh) {
      lastSeenRefresh = at;
      if (cloud) void loadServices();
    }
  });

  const SOURCE_LABELS: Record<string, string> = {
    native: "原生",
    registry: "注册",
  };
</script>

<div class="system-status-widget">
  <WorkbenchTop
    serverConnected={st.serverConnected}
    ruleConnected={st.ruleConnected}
    {ws}
    {mode}
    consoleVersion={CONSOLE_VERSION}
    ruleVersion={st.ruleVersion}
    refreshing={st.refreshing}
    lastRefreshAt={st.lastRefreshAt}
    onRefresh={workbenchRefreshNow}
    onShowOnboarding={showOnboarding}
  />
  <div class="services-strip">
    <span class="services-label">
      服务清单
      {#if services}
        <span class="services-count">{services.length} 项已绑定</span>
      {/if}
    </span>
    {#if !cloud}
      <span class="services-unavailable">
        服务清单不可用:需联网模式连接 evorule-server
      </span>
    {:else if servicesError}
      <span class="services-unavailable" role="alert" title={servicesError}>
        ⚠ 服务清单不可用({servicesError})
      </span>
    {:else if servicesLoading && services === null}
      <span class="services-loading">⏳ 拉取中…</span>
    {:else if services && services.length > 0}
      <div class="services-list">
        <!-- 组合键:server /api/services 为能力对账面,native+registry 双来源,同名服务可并存(llm_advisor),单 name 键会 each_key_duplicate -->
        {#each services as s (s.source + ":" + s.name)}
          <span
            class="svc"
            title="{s.name} · {SOURCE_LABELS[s.source] ?? s.source}{s.version ? ` · v${s.version}` : ''}{s.description ? ` · ${s.description}` : ''}"
          >
            <span class="svc-dot" aria-hidden="true"></span>
            <span class="svc-name">{s.name}</span>
            <span class="svc-tag" class:registry={s.source !== "native"}
              >{SOURCE_LABELS[s.source] ?? s.source}</span
            >
            {#if s.version}
              <span class="svc-ver">v{s.version}</span>
            {/if}
          </span>
        {/each}
      </div>
    {:else if services}
      <span class="services-empty">暂无已注册服务</span>
    {/if}
  </div>
</div>

<style>
  .system-status-widget {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .services-strip {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 8px 12px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .services-label {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .services-count {
    font-weight: 400;
    font-size: 11px;
  }
  .services-list {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    max-height: 56px;
    overflow: auto;
  }
  .svc {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-input);
    font-size: 11px;
  }
  .svc-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--success, #16a34a);
    flex-shrink: 0;
  }
  .svc-name {
    color: var(--text-primary);
    font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  }
  .svc-tag {
    font-size: 10px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--brand-bg, #eff6ff);
    color: var(--brand, #2563eb);
    font-weight: 600;
  }
  .svc-tag.registry {
    background: var(--warning-bg, #fef3c7);
    color: var(--warning, #92400e);
  }
  .svc-ver {
    color: var(--text-muted);
    font-size: 10px;
    font-family: ui-monospace, monospace;
  }
  .services-unavailable {
    font-size: 11px;
    color: var(--error, #dc2626);
  }
  .services-loading,
  .services-empty {
    font-size: 11px;
    color: var(--text-muted);
  }
</style>
