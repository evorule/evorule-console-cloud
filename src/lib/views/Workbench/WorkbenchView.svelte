<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  Workbench 总览页 — 主组件(UV-021 收敛为唯一首页)

  职责:
    - surface 宿主:轮询调度(15s 健康 / 30s 数据)与 kernel 数据刷新
    - 连接状态写入 workbenchStatus store(widget 订阅展示)
    - 渲染委托 DashboardGrid(注册表驱动,widget 见 widgets/registry.ts)

  历史:
    - 原 5 region 硬编码布局已注册表化(UV-021 W1):
      identity/monitor-summary(新)+ system-status/stats/quick/activity/jump(包装)
    - 「一切皆 plugin」交互层首个落地:新增卡片 = 注册表追加一行
-->

<script lang="ts">
  import { onMount } from "svelte";
  import DashboardGrid from "./DashboardGrid.svelte";
  import GuidedHint from "$lib/views/Feedback/GuidedHint.svelte";
  import OnboardingBanner from "$lib/views/Home/OnboardingBanner.svelte";
  import RecommendationCard from "./RecommendationCard.svelte";
  import {
    useBackend,
    useWorkspaceBackend,
    currentWorkspace,
    currentSessionId,
    refreshRules,
    refreshSessions,
    refreshPublishQueue,
    refreshAudit,
  } from "$lib/kernel";
  import { workbenchStatus, patchWorkbenchStatus, setWorkbenchRefreshAction } from "$lib/stores/workbench-status";
  import { governanceConfig } from "$lib/config/governance-config";

  /**
   * 读 rule-serve(18081)运行时版本(Mavis 01 号 P2-01)。
   * /v1/health 返回形如 { version: "v0.3.0", ... };取不到如实返回 null(不静默造假)。
   */
  async function fetchRuleVersion(baseUrl: string): Promise<string | null> {
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/health`);
      if (!res.ok) return null;
      const data = (await res.json()) as { version?: unknown };
      if (typeof data.version !== "string" || data.version.length === 0) return null;
      return data.version.startsWith("v") ? data.version : `v${data.version}`;
    } catch {
      return null;
    }
  }

  // === 后端注入 ===
  const backend = useBackend();
  const wsBackend = useWorkspaceBackend();

  // === 健康检查 ===
  // server 走 ExecutionBackend.health()(18080)
  // rule 没有原生 health,server 起来后试着 listWorkspaces 间接探测(18081)
  async function checkHealth(): Promise<void> {
    let serverOk = false;
    let ruleOk = false;
    let ruleVer: string | null = null;
    try {
      serverOk = (await backend.health()) === true;
    } catch {
      serverOk = false;
    }
    if (serverOk) {
      try {
        await wsBackend.listWorkspaces();
        ruleOk = true;
      } catch {
        ruleOk = false;
      }
    }
    // P2-01:rule 版本动态读(取不到回落 null,UI 层降级 consoleVersion,不阻塞健康检查)
    if (ruleOk) {
      ruleVer = await fetchRuleVersion($governanceConfig.baseUrl);
    }
    patchWorkbenchStatus({ serverConnected: serverOk, ruleConnected: ruleOk, ruleVersion: ruleVer });
  }

  // === 刷新(拉数据 + 健康检查) ===
  async function refresh(): Promise<void> {
    if ($workbenchStatus.refreshing) return;
    patchWorkbenchStatus({ refreshing: true });
    try {
      await checkHealth();
      const ws = $currentWorkspace;
      const promises: Promise<unknown>[] = [
        ws ? refreshRules(wsBackend, ws.id).catch((e) => {
          console.error("[workbench] refreshRules failed:", e);
        }) : Promise.resolve(),
      ];
      if (ws) {
        promises.push(
          refreshPublishQueue(wsBackend, ws.id).catch((e) => {
            console.error("[workbench] refreshPublishQueue failed:", e);
          }),
        );
      }
      promises.push(
        refreshSessions(backend).catch((e) => {
          console.error("[workbench] refreshSessions failed:", e);
        }),
      );
      const sessionId = $currentSessionId;
      if (sessionId) {
        promises.push(
          refreshAudit(backend, sessionId).catch((e) => {
            console.error("[workbench] refreshAudit failed:", e);
          }),
        );
      }
      await Promise.allSettled(promises);
      patchWorkbenchStatus({ lastRefreshAt: new Date() });
    } finally {
      patchWorkbenchStatus({ refreshing: false });
    }
  }

  // === 生命周期 ===
  onMount(() => {
    // 立即一次
    void refresh();
    // 健康检查每 15s
    const healthTimer = setInterval(() => {
      void checkHealth();
    }, 15000);
    // 数据每 30s
    const dataTimer = setInterval(() => {
      void refresh();
    }, 30000);
    // widget 可触发立即刷新
    setWorkbenchRefreshAction(() => void refresh());
    return () => {
      clearInterval(healthTimer);
      clearInterval(dataTimer);
      setWorkbenchRefreshAction(null);
    };
  });
</script>

<div class="workbench">
  <!-- 首屏引导横幅(UV-021 W2 自 RealWorkbench 迁移到新着陆路径) -->
  <OnboardingBanner />

  <!-- 极简工作台首访提示 -->
  <GuidedHint
    hintId="workbench"
    variant="tip"
    title="总览 · 一屏看全貌"
    body="这里汇总身份、生产状态、规则数、session、待审与最近操作。想深入某一块,点卡片或侧栏即可单页跳转。"
  />

  <!-- 角色视图默认推荐 -->
  <RecommendationCard />

  <h1 class="workbench-title">🧭 总览</h1>
  <p class="workbench-subtitle">
    一屏看到所有状态 + 高频操作 · 卡片按角色与权限自动显隐
  </p>

  <!-- 注册表驱动渲染(UV-021):新增卡片 = widgets/registry.ts 追加一行 -->
  <DashboardGrid surface="workbench" />
</div>

<style>
  .workbench {
    padding: 20px 24px;
    max-width: 1280px;
    margin: 0 auto;
  }
  .workbench-title {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 4px;
    font-size: 22px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .workbench-subtitle {
    color: var(--text-secondary);
    font-size: 13px;
    margin: 0 0 20px;
  }
</style>
