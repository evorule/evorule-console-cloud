<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console-cloud 根布局 — Docker 三栏：顶栏 + 左导航 + 主内容 + 右 LLM 侧栏 -->
<!--
  Phase 2: 用 CloudHttpBackend 替代内核 HttpBackend(支持联网/离线双模式)
  Phase 3-4: assistant 注入 CloudLlmAssistant(配置完备时)
  三栏: 左导航侧栏(VIEW_LIST + 治理 + 设置) + 居中主内容(20%/60%/20%)
        + 右侧 LLM 交互侧栏;侧栏宽度可拖动并持久化到 localStorage
-->

<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { browser } from "$app/environment";
  import {
    VIEW_LIST,
    provideBackend,
    provideAssistant,
    CONSOLE_VERSION,
  } from "@evorule/console";
  import type { ViewId } from "@evorule/console";
  import { CloudHttpBackend } from "$lib/backend/cloud-http-backend";
  import { MockBackend } from "$lib/backend/mock-backend";
  import { netConfig, toggleNetMode } from "$lib/config/net-config";
  import { setDemoDataset } from "$lib/stores/demo-dataset";
  import { llmConfig, isLlmConfigured } from "$lib/config/llm-config";
  import { CloudLlmAssistant } from "$lib/assistant/cloud-llm-assistant";
  import { sessionStore } from "$lib/stores/session";
  import { isEmptyDb } from "$lib/stores/db";
  import { toastInfo } from "$lib/stores/toast";
  import Settings from "$lib/views/Settings/Settings.svelte";
  import Toast from "$lib/views/Feedback/Toast.svelte";
  import UserMenu from "$lib/views/Auth/UserMenu.svelte";
  import NotificationBell from "$lib/views/Notifications/NotificationBell.svelte";
  import TaskFlowDropdown from "$lib/views/Home/TaskFlowDropdown.svelte";
  import TaskFlowWizard from "$lib/views/Home/TaskFlowWizard.svelte";
  import LlmChatSidebar from "$lib/views/Assistant/LlmChatSidebar.svelte";

  let { children } = $props();

  // === 三栏宽度(可拖动 + 持久化) ===
  const LAYOUT_KEY = "evorule-console-cloud:layout";
  const MIN_SIDE = 160;
  const MAX_SIDE = 480;
  let leftWidth = $state(220);
  let rightWidth = $state(320);
  let draggingSide = $state<"left" | "right" | null>(null);

  function clampWidth(v: number): number {
    return Math.min(MAX_SIDE, Math.max(MIN_SIDE, v));
  }

  function persistLayout(): void {
    if (!browser) return;
    localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({ leftWidth, rightWidth })
    );
  }

  function startDrag(side: "left" | "right", e: PointerEvent): void {
    if (!browser) return;
    draggingSide = side;
    e.preventDefault();

    const onMove = (ev: PointerEvent) => {
      if (draggingSide === "left") {
        leftWidth = clampWidth(ev.clientX);
      } else if (draggingSide === "right") {
        rightWidth = clampWidth(window.innerWidth - ev.clientX);
      }
    };
    const onUp = () => {
      draggingSide = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      persistLayout();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // === 设置入口(大众版独立管理,不修改内核 VIEW_LIST) ===
  let showSettings = $state(false);

  function openSettings() {
    showSettings = true;
  }

  function closeSettings() {
    showSettings = false;
  }

  // 用户点击导航项时,关闭设置 + 跳转。
  // 工作台视图 /view/* 受路由守卫约束(需 已登录 && 库非空),否则会被守卫 307 弹回首页。
  // 这里在跳转前先判断,未授权时给出明确引导(登录 / 建库),避免"点了无反应"。
  function navWorkbench(viewId: ViewId) {
    showSettings = false;
    const loggedIn = get(sessionStore).loggedIn;
    if (loggedIn && !get(isEmptyDb)) {
      goto(`/view/${viewId}`);
      return;
    }
    if (!loggedIn) {
      toastInfo('请先登录，以访问工作台');
      goto('/login');
      return;
    }
    toastInfo('请先完成规则库创建向导，再进入工作台');
    goto('/');
  }

  // /export 也受守卫约束(需 已登录 && 库非空)
  function navExport() {
    showSettings = false;
    const loggedIn = get(sessionStore).loggedIn;
    if (loggedIn && !get(isEmptyDb)) {
      goto('/export');
      return;
    }
    if (!loggedIn) {
      toastInfo('请先登录，以访问导出中心');
      goto('/login');
      return;
    }
    toastInfo('请先完成规则库创建向导，再导出');
    goto('/');
  }

  // 其余导航(治理/发布队列/版本历史/审计)直接跳转,由各自 +page 自守卫
  function go(path: string) {
    showSettings = false;
    goto(path);
  }

  // === 注入 backend(CloudHttpBackend 双模式 + ?mock=1 零依赖模式) ===
  const initialNet = get(netConfig);
  const useMock =
    browser && new URLSearchParams(window.location.search).get("mock") === "1";

  let cloudBackend: CloudHttpBackend | null = null;
  const backendImpl = useMock
    ? new MockBackend()
    : new CloudHttpBackend({
        mode: initialNet.mode,
        remoteBaseUrl: initialNet.remoteBaseUrl,
        localBaseUrl: "http://localhost:18090",
      });
  if (!useMock) cloudBackend = backendImpl as CloudHttpBackend;
  if (useMock) setDemoDataset("agent");

  const backend = provideBackend(backendImpl);

  $effect(() => {
    if (!cloudBackend) return;
    const cfg = $netConfig;
    cloudBackend.reconfigure({
      mode: cfg.mode,
      remoteBaseUrl: cfg.remoteBaseUrl,
    });
  });

  // === 注入 LLM assistant(配置完备时注入,否则 null) ===
  const initialLlm = get(llmConfig);
  if (isLlmConfigured(initialLlm)) {
    provideAssistant(new CloudLlmAssistant(initialLlm));
  } else {
    provideAssistant(null);
  }

  // === 连接状态 ===
  let connected = $state<boolean | null>(null);

  // === 主题 ===
  let theme = $state<"dark">("dark");

  onMount(() => {
    // 恢复三栏宽度(无持久化值则默认 20%/60%/20%)
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { leftWidth: number; rightWidth: number };
        if (typeof saved.leftWidth === "number")
          leftWidth = clampWidth(saved.leftWidth);
        if (typeof saved.rightWidth === "number")
          rightWidth = clampWidth(saved.rightWidth);
      } else {
        leftWidth = clampWidth(window.innerWidth * 0.2);
        rightWidth = clampWidth(window.innerWidth * 0.2);
      }
    } catch {
      leftWidth = clampWidth(window.innerWidth * 0.2);
      rightWidth = clampWidth(window.innerWidth * 0.2);
    }

    // 主题:固定深色(整体消灭白色底色)
    theme = "dark";
    document.documentElement.setAttribute("data-theme", "dark");
    localStorage.setItem("theme", "dark");

    // backend 健康检查
    backend
      .health()
      .then((ok) => {
        connected = ok;
      })
      .catch(() => {
        connected = false;
      });
  });

  // 当前活动路由字符串,用于导航高亮
  function isActive(pathname: string): boolean {
    return $page.url.pathname === pathname && !showSettings;
  }
</script>

<svelte:head>
  <style>
    /* 强制深色:覆盖内核 @evorule/console 附带全局浅色变量(执行台/状态等内核组件)
       内核自带 app.css 在 :root 定义 --bg-card:#ffffff,复用其组件时会把该页全局变量覆盖为白;
       此处用 html 选择器 + !important 兜底,保证任何路由都是深色。 */
    html {
      --bg-page: #0b1929 !important;
      --bg-card: #0d1117 !important;
      --bg-header: #09101f !important;
      --bg-primary: #0b1929 !important;
      --bg-input: #0d1117 !important;
      --bg-hover: rgba(255, 255, 255, 0.06) !important;
      --bg-active: rgba(29, 99, 237, 0.15) !important;
      --border: rgba(255, 255, 255, 0.08) !important;
      --border-strong: rgba(255, 255, 255, 0.15) !important;
      --text-primary: #f1f5f9 !important;
      --text-secondary: #94a3b8 !important;
      --text-muted: #64748b !important;
      --text-inverse: #0f172a !important;
      --sidebar-bg: #09101f !important;
      --sidebar-text: rgba(255, 255, 255, 0.65) !important;
      --sidebar-text-active: #ffffff !important;
      --sidebar-hover: rgba(255, 255, 255, 0.06) !important;
      --sidebar-active: rgba(255, 255, 255, 0.08) !important;
    }
    /* 兜底:内核会话面板直接置深色,杜绝白底 */
    .session-panel {
      background: #0d1117 !important;
    }
  </style>
</svelte:head>

<div class="app">
  <!-- ===== 顶栏 ===== -->
  <header class="header">
    <a class="header-brand" href="/view/rules" onclick={(e) => { e.preventDefault(); navWorkbench("rules"); }}>
      <span class="logo">
        <img src="/evo_logo_96.png" alt="EvoRule logo" draggable="false" />
      </span>
      <span class="brand-text">evorule</span>
      <span class="brand-cloud">console-cloud</span>
    </a>

    <div class="search-box">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input type="text" placeholder="搜索规则集、数据集、发布记录..." />
      <span class="kbd">Ctrl+K</span>
    </div>

    <div
      class="conn-status"
      class:offline={connected === false}
      class:checking={connected === null}
      title={connected === false
        ? "evorule-server 未响应(检查地址或启动服务器)"
        : "evorule-server 连接状态"}
    >
      <span class="dot"></span>
      {connected === null ? "检测中" : connected ? "已连接" : "未连接"}
    </div>

    <div class="header-actions">
      <!-- 联网/离线切换(快捷,正式配置在设置面板) -->
      <button
        class="icon-btn"
        onclick={toggleNetMode}
        title={$netConfig.mode === "online"
          ? `联网模式 · {$netConfig.remoteBaseUrl} · 点击切回本地`
          : "离线模式 · localhost:18090 · 点击切到联网"}
        aria-label="切换联网/离线模式"
      >
        {$netConfig.mode === "online" ? "☁️" : "🖥️"}
      </button>

      <TaskFlowDropdown />

      {#if $sessionStore.loggedIn}
        <NotificationBell />
      {/if}

      <button class="icon-btn" onclick={openSettings} title="设置" aria-label="设置">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>

      <UserMenu />
    </div>
  </header>

  <!-- 任务流进度条 -->
  <TaskFlowWizard />

  <!-- ===== 主区(三栏) ===== -->
  <div class="main">
    <!-- 左导航侧栏 -->
    <aside class="sidebar" style:width={`${leftWidth}px`}>
      <div class="sidebar-section">
        <div class="sidebar-label">工作台</div>
        {#each VIEW_LIST as view (view.id)}
          <button
            class="sidebar-item"
            class:active={isActive(`/view/${view.id}`)}
            onclick={() => navWorkbench(view.id)}
            title={view.essence}
            aria-pressed={isActive(`/view/${view.id}`)}
          >
            <span class="nav-icon">{view.icon}</span>
            <span class="nav-label">{view.label}</span>
          </button>
        {/each}
      </div>

      <div class="sidebar-divider"></div>

      <div class="sidebar-section">
        <div class="sidebar-label">治理与协作</div>
        <button
          class="sidebar-item"
          class:active={isActive("/export")}
          onclick={() => navExport()}
          title="通用结果导出中心 — 6 种内容 × 4 种格式,BLAKE3 完整性自证"
          aria-pressed={isActive("/export")}
        >
          <span class="nav-icon">📤</span>
          <span class="nav-label">导出</span>
        </button>

        {#if $sessionStore.loggedIn}
          <button
            class="sidebar-item"
            class:active={isActive("/publish-queue")}
            onclick={() => go("/publish-queue")}
            title="发布队列 — 规则集发布审批与紧急回滚"
            aria-pressed={isActive("/publish-queue")}
          >
            <span class="nav-icon">📥</span>
            <span class="nav-label">发布队列</span>
          </button>
          <button
            class="sidebar-item"
            class:active={isActive("/version-history")}
            onclick={() => go("/version-history")}
            title="版本历史 — 生产规则集版本时间线"
            aria-pressed={isActive("/version-history")}
          >
            <span class="nav-icon">📜</span>
            <span class="nav-label">版本历史</span>
          </button>
          <button
            class="sidebar-item"
            class:active={isActive("/audit")}
            onclick={() => go("/audit")}
            title="审计员工作台 — BLAKE3 审计链 + 因果链回溯"
            aria-pressed={isActive("/audit")}
          >
            <span class="nav-icon">🔍</span>
            <span class="nav-label">审计记录</span>
          </button>
          <button
            class="sidebar-item"
            class:active={isActive("/governance")}
            onclick={() => go("/governance")}
            title="治理(evorule-rule)— 数据集/规则/5 态生命周期/审批发布/版本链"
            aria-pressed={isActive("/governance")}
          >
            <span class="nav-icon">🗂️</span>
            <span class="nav-label">治理中心</span>
          </button>
        {/if}
      </div>

      <div class="sidebar-divider"></div>

      <div class="sidebar-section">
        <button
          class="sidebar-item"
          class:active={showSettings}
          onclick={openSettings}
          title="设置(联网 + LLM 配置)"
          aria-pressed={showSettings}
        >
          <span class="nav-icon">⚙️</span>
          <span class="nav-label">设置</span>
        </button>
      </div>

      <div class="version-footer">
        <span class="dot"></span>
        evorule-server · 内核 v{CONSOLE_VERSION}
      </div>
    </aside>

    <!-- 左拖动分隔条 -->
    <div
      class="resizer"
      class:dragging={draggingSide === "left"}
      onpointerdown={(e) => startDrag("left", e)}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整左侧栏宽度"
    ></div>

    <!-- 居中主内容 -->
    <main class="content">
      {#if showSettings}
        <Settings onclose={closeSettings} />
      {:else}
        {@render children()}
      {/if}
    </main>

    <!-- 右拖动分隔条 -->
    <div
      class="resizer"
      class:dragging={draggingSide === "right"}
      onpointerdown={(e) => startDrag("right", e)}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整右侧栏宽度"
    ></div>

    <!-- 右 LLM 交互侧栏 -->
    <aside class="sidebar llm-rail" style:width={`${rightWidth}px`}>
      <LlmChatSidebar />
    </aside>
  </div>

  <!-- 全局 Toast 通知 -->
  <Toast />
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  /* 侧栏内的 emoji 图标(内核 VIEW_LIST 的 icon 是 emoji) */
  .nav-icon {
    width: 20px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    line-height: 1;
  }
  .nav-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 右侧 LLM 侧栏:去 padding + 禁止外层滚动(内容由 LlmChatSidebar 自绘自滚) */
  .llm-rail {
    padding: 0;
    overflow: hidden;
    background: var(--sidebar-bg);
    border-left: 1px solid var(--border);
  }

  /* 联网/离线切换 icon-btn 显示 emoji 时字号微调 */
  .header-actions .icon-btn {
    font-size: var(--fs-base);
  }

  /* 连接状态徽标(样品页样式,非浅色时默认成功绿) */
  .conn-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-xs);
    padding: 4px var(--sp-sm);
    border-radius: var(--r-sm);
    background: var(--success-bg);
    color: var(--success);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .conn-status.offline {
    background: var(--danger-bg);
    color: var(--danger);
  }
  .conn-status.checking {
    background: var(--warning-bg);
    color: var(--warning);
  }
</style>