<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  Workbench 极简首页 — 主组件(方案 C)

  职责:
    - 拉取 rules / sessions / publishQueue / audit(并行)
    - 周期性刷新时间戳(让"5 min ago"实时变化)
    - 派生 4 个统计卡数据(规则数 / session 数 / 待审数 / 最近 fact)
    - 组合 5 region 子组件
    - 所有"跳单页"动作走 goto(),不破坏现有路由守卫

  数据源:
    - $rules(规则库)
    - $sessions / $currentSessionId
    - $publishQueue(发布队列)
    - $auditData(当前 session 审计)
    - $currentWorkspace(workspace 元信息)
    - $netConfig.mode(联网/离线)

  入口:
    - /workbench 路由
    - 侧栏"🚀 工作台"按钮
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import {
    useBackend,
    useWorkspaceBackend,
    rules,
    sessions,
    currentSessionId,
    publishQueue,
    auditData,
    currentWorkspace,
    refreshRules,
    refreshSessions,
    refreshPublishQueue,
    refreshAudit,
    workspaces,
    CONSOLE_VERSION,
  } from "$lib/kernel";
  import GuidedHint from "$lib/views/Feedback/GuidedHint.svelte";
  import RecommendationCard from "./RecommendationCard.svelte";
  import { netConfig } from "$lib/config/net-config";
  import { isLlmConfigured, llmConfig } from "$lib/config/llm-config";
  import { sessionStore } from "$lib/stores/session";
  import { toastInfo, toastError } from "$lib/stores/toast";

  import WorkbenchTop from "./WorkbenchTop.svelte";
  import WorkbenchStats from "./WorkbenchStats.svelte";
  import WorkbenchQuick from "./WorkbenchQuick.svelte";
  import WorkbenchActivity from "./WorkbenchActivity.svelte";
  import WorkbenchJump from "./WorkbenchJump.svelte";

  // === 后端注入 ===
  const backend = useBackend();
  const wsBackend = useWorkspaceBackend();

  // === 状态 ===
  let serverConnected = $state<boolean | null>(null);
  let ruleConnected = $state<boolean | null>(null);
  let refreshing = $state(false);
  let lastRefreshAt = $state<Date | null>(null);
  let now = $state(new Date());

  // === 派生:订阅 store ===
  let ruleList = $derived($rules);
  let sessionList = $derived($sessions);
  let publishList = $derived($publishQueue);
  let audit = $derived($auditData);
  let ws = $derived($currentWorkspace);
  let mode = $derived($netConfig.mode);
  let workspaceList = $derived($workspaces);
  let loggedIn = $derived($sessionStore.loggedIn);
  let llmReady = $derived(isLlmConfigured($llmConfig));

  // 安全解析 Rule.metadata(JSON 字符串) → 失败视为普通规则
  function parseMetadata(s: string | null | undefined): { builtin?: boolean } {
    if (!s) return {};
    try {
      const obj = JSON.parse(s) as { builtin?: unknown };
      return { builtin: obj.builtin === true };
    } catch {
      return {};
    }
  }

  // === 派生:4 个统计卡 ===
  let statsData = $derived({
    ruleCount: ruleList.length,
    builtInCount: ruleList.filter((r) => parseMetadata(r.metadata).builtin === true).length,
    customCount: ruleList.filter((r) => parseMetadata(r.metadata).builtin !== true).length,
    sessionCount: sessionList.length,
    pendingCount: publishList.filter((p) => p.status === "pending").length,
    // audit.entries 是 unknown[];取最后一条做类型断言后取 logical_time
    lastFactAt: (() => {
      if (!audit?.entries?.length) return null;
      const last = audit.entries[audit.entries.length - 1] as
        | { logical_time?: number }
        | null
        | undefined;
      return last?.logical_time ?? null;
    })(),
    lastFactType: (() => {
      if (!audit?.entries?.length) return null;
      const last = audit.entries[audit.entries.length - 1] as
        | { fact_type?: string }
        | null
        | undefined;
      return last?.fact_type ?? null;
    })(),
  });

  // === 派生:最近活动(从 audit 提取最多 8 条) ===
  // 用 $derived.by 写完整函数体;不依赖 now(避免 30s 整列表重渲染)
  // time 字段不存 Date,WorkbenchActivity 直接显示 fact logical_time("fact #N")
  let activityData = $derived.by(() => {
    if (!audit?.entries || audit.entries.length === 0) {
      return [];
    }
    return audit.entries
      .slice(-8)
      .reverse()
      .map((raw) => {
        const e = raw as {
          logical_time?: number;
          fact_type?: string;
          payload?: { op?: string; attr?: string };
        };
        const factType = e.fact_type ?? "unknown";
        const sev: "green" | "blue" | "yellow" =
          factType === "command"
            ? "green"
            : factType === "verify"
              ? "blue"
              : "yellow";
        return {
          factTime: typeof e.logical_time === "number" ? e.logical_time : null,
          type: factType,
          text:
            factType === "command"
              ? `提交命令 ${e.payload?.op ?? ""} ${e.payload?.attr ?? ""}`.trim()
              : factType === "verify"
                ? "审计链 +1 fact"
                : factType === "rule"
                  ? "规则变更"
                  : factType,
          severity: sev,
        };
      });
  });

  // === 健康检查 ===
  // server 走 ExecutionBackend.health()(18080)
  // rule 没有原生 health,server 起来后试着 listWorkspaces 间接探测(18081)
  // rule 探测放在 server 起来后才做,避免对已知的"server 离线"做无谓探测
  async function checkHealth(): Promise<void> {
    let serverOk = false;
    let ruleOk = false;
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
    serverConnected = serverOk;
    ruleConnected = ruleOk;
  }

  // === 刷新(拉数据 + 健康检查) ===
  async function refresh(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      await checkHealth();
      const promises: Promise<unknown>[] = [
        ws ? refreshRules(wsBackend, ws.id).catch((e) => {
          console.error("[workbench] refreshRules failed:", e);
        }) : Promise.resolve(),
      ];
      // publish queue / sessions / audit 需要 ws / session
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
      lastRefreshAt = new Date();
    } finally {
      refreshing = false;
    }
  }

  // === 跳转封装 ===
  function nav(path: string, loginRequired = true): void {
    if (loginRequired && !loggedIn) {
      toastInfo("请先登录");
      void goto("/login");
      return;
    }
    void goto(path);
  }

  // === 引导任务(4 步) ===
  function showOnboarding(): void {
    void goto("/?task=open");
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
    // 时间每 30s 更新(now 让"5 min ago"重新计算)
    const timeTimer = setInterval(() => {
      now = new Date();
    }, 30000);
    return () => {
      clearInterval(healthTimer);
      clearInterval(dataTimer);
      clearInterval(timeTimer);
    };
  });

  onDestroy(() => {
    /* timers cleared in onMount return */
  });

  // === 一键操作回调 ===
  async function quickAddRule(ruleJson: string): Promise<void> {
    if (!ws) {
      toastError("当前无 workspace,请先创建");
      return;
    }
    try {
      const parsed = JSON.parse(ruleJson) as {
        rule_id?: string;
        type?: string;
        params?: object;
      };
      const ruleName = parsed.rule_id ?? `rule.user.${Date.now()}`;
      // addRule 签名: (backend, workspaceId, {name, content, description?})
      // content 是 JSON 字符串(server 端持久化原始规则定义)
      const content = JSON.stringify(
        { type: parsed.type, params: parsed.params ?? {} },
        null,
        2,
      );
      const { addRule } = await import("$lib/kernel");
      const newId = await addRule(wsBackend, ws.id, {
        name: ruleName,
        content,
      });
      if (newId) {
        toastInfo(`规则已提交: ${ruleName}`);
        await refreshRules(wsBackend, ws.id);
      } else {
        toastError("规则提交失败");
      }
    } catch (e) {
      toastError(`规则提交失败: ${(e as Error).message}`);
    }
  }

  async function quickRun(payloadJson: string): Promise<void> {
    try {
      const payload = JSON.parse(payloadJson) as object;
      // submitCommand store 签名: (backend, instruction) — store 内部读 currentSessionId
      const { submitCommand } = await import("$lib/kernel");
      const res = await submitCommand(backend, payload);
      if (res === null) {
        toastError("无活动 session,请先在执行台创建");
        return;
      }
      if (res.accepted) {
        toastInfo(`命令已提交,version=${res.version ?? "?"}`);
      } else {
        toastError(`执行失败: ${res.error ?? "未知错误"}`);
      }
    } catch (e) {
      toastError(`Payload 解析失败: ${(e as Error).message}`);
    }
  }
</script>

<div class="workbench">
  <!-- PR7:极简工作台首访提示 -->
  <GuidedHint
    hintId="workbench"
    variant="tip"
    title="极简工作台 · 一屏看全貌"
    body="这里汇总规则数、session、待审与最近操作。想深入某一块,点下方卡片或顶栏「分析视图 / 治理中心 / 审计记录」即可单页跳转。"
  />

  <!-- PR8:角色视图默认推荐 -->
  <RecommendationCard />

  <h1 class="workbench-title">🚀 工作台</h1>
  <p class="workbench-subtitle">
    一键看到所有状态 + 高频操作 · 单页视图 1 击跳转
  </p>

  <!-- Region 1: 顶部状态条 -->
  <WorkbenchTop
    {serverConnected}
    {ruleConnected}
    {ws}
    {mode}
    consoleVersion={CONSOLE_VERSION}
    {refreshing}
    {lastRefreshAt}
    onRefresh={refresh}
    onShowOnboarding={showOnboarding}
  />

  <!-- Region 2: 4 统计卡 -->
  <WorkbenchStats
    stats={statsData}
    onOpenRules={() => nav("/view/rules")}
    onOpenExecution={() => nav("/view/execution")}
    onOpenPublishQueue={() => nav("/publish-queue")}
    onOpenAudit={() => nav("/view/audit")}
  />

  <!-- Region 3: 一键操作 + Region 4: 最近活动 -->
  <div class="region-main">
    <WorkbenchQuick
      {loggedIn}
      {llmReady}
      {sessionList}
      onAddRule={quickAddRule}
      onRun={quickRun}
    />
    <WorkbenchActivity
      activity={activityData}
      onOpenFull={() => nav("/view/audit")}
    />
  </div>

  <!-- Region 5: 跳单页 8 按钮 -->
  <WorkbenchJump
    {loggedIn}
    onNav={(path, loginRequired) => nav(path, loginRequired)}
  />
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
  .region-main {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 16px;
    margin-bottom: 16px;
  }
  @media (max-width: 1024px) {
    .region-main {
      grid-template-columns: 1fr;
    }
  }
</style>
