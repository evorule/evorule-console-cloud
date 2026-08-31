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
    provideWorkspaceBackend,
    provideAssistant,
    CONSOLE_VERSION,
    refreshWorkspaces,
    ensureDefaultWorkspace,
    seedBuiltinRules,
    refreshRules,
    currentWorkspace,
  } from "$lib/kernel";
  import type { ViewId } from "$lib/kernel";
  import { CloudHttpBackend } from "$lib/backend/cloud-http-backend";
  import { CloudWorkspaceBackend, setActiveWorkspaceBackend } from "$lib/backend/cloud-workspace-backend";
  import { DEFAULT_LOCAL_BASE_URL } from "$lib/backend/types";
  import { roleToBackend } from "$lib/backend/production-views";
  import { currentUser, hasPermission } from "$lib/stores/auth";
  import { MockBackend } from "$lib/backend/mock-backend";
  import { MockWorkspaceBackend } from "$lib/backend/mock-workspace-backend";
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
  import Glossary from "$lib/views/Help/Glossary.svelte";
  import TourOverlay from "$lib/views/Home/TourOverlay.svelte";
  import CommandPalette from "$lib/views/Home/CommandPalette.svelte";

  let { children } = $props();

  // === 术语表弹窗(顶栏 ? 打开,全局一次) ===
  let showGlossary = $state(false);
  function openGlossary() {
    showGlossary = true;
  }
  function closeGlossary() {
    showGlossary = false;
  }

  // === 命令面板(PR5:顶栏搜索框 / Ctrl+K 唤起,全局一次) ===
  let showPalette = $state(false);
  function openPalette() {
    showPalette = true;
  }
  function closePalette() {
    showPalette = false;
  }

  // === 窄屏抽屉(PR10-重1):左导航抽屉 + 右 LLM 抽屉,均含遮罩 ===
  let leftDrawerOpen = $state(false);
  let rightDrawerOpen = $state(false);
  function closeDrawers() {
    leftDrawerOpen = false;
    rightDrawerOpen = false;
  }
  function toggleLeftDrawer() {
    leftDrawerOpen = !leftDrawerOpen;
    if (leftDrawerOpen) rightDrawerOpen = false;
  }
  function toggleRightDrawer() {
    rightDrawerOpen = !rightDrawerOpen;
    if (rightDrawerOpen) leftDrawerOpen = false;
  }

  // 全局快捷键:Ctrl/⌘ + K 切换命令面板
  function handleGlobalKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      showPalette = !showPalette;
    }
  }

  // === 三栏宽度(可拖动 + 持久化) ===
  const LAYOUT_KEY = "evorule-console-cloud:layout";
  const MIN_SIDE = 160;
  const MAX_SIDE = 480;
  const LLM_COLLAPSED_W = 56;
  let leftWidth = $state(220);
  let rightWidth = $state(320);
  let draggingSide = $state<"left" | "right" | null>(null);

  // PR5:右栏 LLM 未配置时折叠为窄条,释放 20% 宽
  let llmConfigured = $derived(isLlmConfigured($llmConfig));

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
  let settingsInitialTab = $state<"network" | "llm" | "onboarding">("network");

  function openSettings(tab: "network" | "llm" | "onboarding" = "network") {
    closeDrawers();
    settingsInitialTab = tab;
    showSettings = true;
  }

  function closeSettings() {
    showSettings = false;
  }

  // 用户点击导航项时,关闭设置 + 跳转。
  // 工作台视图 /view/* 受路由守卫约束(需 已登录 && 库非空),否则会被守卫 307 弹回首页。
  // 这里在跳转前先判断,未授权时给出明确引导(登录 / 建库),避免"点了无反应"。
  function navWorkbench(viewId: ViewId) {
    closeDrawers();
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
    closeDrawers();
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
    closeDrawers();
    showSettings = false;
    goto(path);
  }

  // 极简工作台(新)— 纯 dashboard,无需登录/无需库,任何时候都能跳
  function navWorkbenchRoute() {
    closeDrawers();
    showSettings = false;
    goto("/workbench");
  }

  // 帮助页(/help)— 公开文档,任何时候可访问
  function navHelpRoute() {
    closeDrawers();
    showSettings = false;
    goto("/help");
  }

  function navMarketplace() {
    closeDrawers();
    showSettings = false;
    goto("/marketplace");
  }

  // === 注入 workspace backend(规则库/沙盒/发布等 server 应用层能力) ===
  // 与 ExecutionBackend 并列的第二个后端(内核 v0.2.0 workspace 化架构)。
  // mock 模式用内存 Mock(刷新即失,演示用);正常模式走 evorule-server workspace API。
  // 旁路 store 收敛(2026-08-28):先构造 workspace backend,execution backend
  // 持有其引用(Cloud 专属读方法委托,带 Bearer token)。
  const initialNet = get(netConfig);
  const useMock =
    browser && new URLSearchParams(window.location.search).get("mock") === "1";

  let cloudWorkspaceBackend: CloudWorkspaceBackend | null = null;
  const workspaceImpl = useMock
    ? new MockWorkspaceBackend()
    : new CloudWorkspaceBackend({
        mode: initialNet.mode,
        remoteBaseUrl: initialNet.remoteBaseUrl,
        localBaseUrl: DEFAULT_LOCAL_BASE_URL,
        authToken: initialNet.authToken,
      });
  if (!useMock) cloudWorkspaceBackend = workspaceImpl as CloudWorkspaceBackend;
  const workspaceBackend = provideWorkspaceBackend(workspaceImpl);
  // 同步登记模块级单例(store 层非组件调用点用,见 cloud-workspace-backend.ts)
  setActiveWorkspaceBackend(workspaceImpl);

  // === 注入 backend(CloudHttpBackend 双模式 + ?mock=1 零依赖模式) ===
  let cloudBackend: CloudHttpBackend | null = null;
  const backendImpl = useMock
    ? new MockBackend()
    : new CloudHttpBackend(
        {
          mode: initialNet.mode,
          remoteBaseUrl: initialNet.remoteBaseUrl,
          localBaseUrl: DEFAULT_LOCAL_BASE_URL,
          authToken: initialNet.authToken,
        },
        workspaceImpl,
      );
  if (!useMock) cloudBackend = backendImpl as CloudHttpBackend;
  if (useMock) setDemoDataset("agent");

  const backend = provideBackend(backendImpl);

  $effect(() => {
    if (!cloudBackend) return;
    const cfg = $netConfig;
    cloudBackend.reconfigure({
      mode: cfg.mode,
      remoteBaseUrl: cfg.remoteBaseUrl,
      authToken: cfg.authToken,
    });
  });

  $effect(() => {
    if (!cloudWorkspaceBackend) return;
    const cfg = $netConfig;
    // D2(2026-08-28):审计归属跟随登录用户 — 登录/登出自动重建内部实现,
    // 发布链路(submitted_by/reviewed_by/operated_by + role)与沙盒编排
    // 记录真实操作者;未登录时 actor 置空,内核回落 "console" 并 warn
    const user = $currentUser;
    cloudWorkspaceBackend.reconfigure({
      mode: cfg.mode,
      remoteBaseUrl: cfg.remoteBaseUrl,
      authToken: cfg.authToken,
      actor: user ? { name: user.id, role: roleToBackend(user.role) } : null,
    });
  });

  // === 规则库启动引导(幂等) ===
  // refreshWorkspaces(空则自动建默认 ws) → 补种内置示例(按名查重) → 拉规则列表。
  // 失败如实提示(server 未启动/网络问题),不静默吞掉。
  async function bootstrapRuleLibrary(): Promise<void> {
    try {
      await refreshWorkspaces(workspaceBackend);
      let ws = get(currentWorkspace);
      if (!ws) ws = await ensureDefaultWorkspace(workspaceBackend);
      await seedBuiltinRules(workspaceBackend, ws.id);
      await refreshRules(workspaceBackend, ws.id);
    } catch (e) {
      console.error("[layout] 规则库初始化失败:", e);
      toastInfo(
        `规则库初始化失败:${(e as Error).message}(请检查 evorule-server 是否已启动)`
      );
    }
  }

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

    // 规则库启动引导(workspace → 内置示例 → 规则列表)
    bootstrapRuleLibrary();
  });

  // 当前活动路由字符串,用于导航高亮
  function isActive(pathname: string): boolean {
    return $page.url.pathname === pathname && !showSettings;
  }
</script>

<svelte:head>
  <style>
    /* 强制深色:覆盖内核 $lib/kernel 附带全局浅色变量(执行台/状态等内核组件)
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

<svelte:window onkeydown={handleGlobalKey} />

<div class="app">
  <!-- ===== 顶栏 ===== -->
  <header class="header">
    <!-- 窄屏抽屉开关:左导航(仅窄屏可见) -->
    <button
      class="icon-btn hamburger"
      onclick={toggleLeftDrawer}
      aria-label={leftDrawerOpen ? "关闭导航" : "打开导航"}
      aria-expanded={leftDrawerOpen}
      title="导航"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>

    <a class="header-brand" href="/view/rules" onclick={(e) => { e.preventDefault(); navWorkbench("rules"); }}>
      <span class="logo">
        <img src="/evo_logo_96.png" alt="EvoRule logo" draggable="false" />
      </span>
      <span class="brand-text">evorule</span>
      <span class="brand-cloud">console-cloud</span>
    </a>

    <button
      class="search-box"
      type="button"
      onclick={openPalette}
      title="搜索或跳转(Ctrl+K)"
      aria-label="打开命令面板"
    >
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <span class="search-placeholder">搜索或跳转…</span>
      <span class="kbd">Ctrl+K</span>
    </button>

    <div
      class="conn-status"
      class:offline={connected === false}
      class:checking={connected === null}
      data-tour="connection"
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
          ? `联网模式 · ${$netConfig.remoteBaseUrl} · 点击切回本地`
          : `离线模式 · ${DEFAULT_LOCAL_BASE_URL.replace(/^https?:\/\//, "")} · 点击切到联网`}
        aria-label="切换联网/离线模式"
      >
        {$netConfig.mode === "online" ? "☁️" : "🖥️"}
      </button>

      <!-- 帮助 / 术语表(顶栏随处可达,PR4) -->
      <button
        class="icon-btn"
        onclick={openGlossary}
        title="帮助与术语表"
        aria-label="帮助与术语表"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </button>

      <TaskFlowDropdown />

      {#if $sessionStore.loggedIn}
        <NotificationBell />
      {/if}

      <!-- 窄屏抽屉开关:右 LLM 侧栏(仅窄屏 + LLM 已配置时可见) -->
      {#if llmConfigured}
        <button
          class="icon-btn header-chat-btn"
          onclick={toggleRightDrawer}
          aria-label={rightDrawerOpen ? "关闭 AI 助手" : "打开 AI 助手"}
          aria-expanded={rightDrawerOpen}
          title="AI 助手"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </button>
      {/if}

      <button class="icon-btn" onclick={() => openSettings()} title="设置" aria-label="设置">
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
    <aside class="sidebar sidebar-left {leftDrawerOpen ? 'drawer-open' : ''}" style:width={`${leftWidth}px`}>
      <div class="sidebar-section">
        <!-- 总览(UV-021 W2)— 唯一首页,Dashboard 风格,任何时候可访问 -->
        <button
          class="sidebar-item workbench-item"
          class:active={isActive("/workbench")}
          aria-current={isActive("/workbench") ? "page" : undefined}
          onclick={navWorkbenchRoute}
          title="总览 — 一键看到所有状态 + 高频操作 + 单页跳"
          aria-pressed={isActive("/workbench")}
        >
          <span class="nav-icon">🧭</span>
          <span class="nav-label">总览</span>
        </button>
        <!-- 监控大屏直达(UV-021 W2)— 原 RealWorkbench L1 面板独立成页 -->
        <button
          class="sidebar-item"
          class:active={isActive("/monitor")}
          aria-current={isActive("/monitor") ? "page" : undefined}
          onclick={() => go("/monitor")}
          title="监控大屏 — 生产运行状态实时总览"
          aria-pressed={isActive("/monitor")}
        >
          <span class="nav-icon">📊</span>
          <span class="nav-label">监控</span>
        </button>
      </div>

      <div class="sidebar-divider"></div>

      <div class="sidebar-section">
        <div class="sidebar-label">分析视图</div>
        {#each VIEW_LIST as view (view.id)}
          <button
            class="sidebar-item"
            class:active={isActive(`/view/${view.id}`)}
            aria-current={isActive(`/view/${view.id}`) ? "page" : undefined}
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
        <!-- 模板市场 — 官方规则集一键导入(UV-014 导航发现性) -->
        <button
          class="sidebar-item help-item"
          class:active={isActive("/marketplace")}
          aria-current={isActive("/marketplace") ? "page" : undefined}
          onclick={navMarketplace}
          title="模板市场 — 官方规则集(等保 2.0 等)一键导入"
          aria-pressed={isActive("/marketplace")}
        >
          <span class="nav-icon">🛒</span>
          <span class="nav-label">市场</span>
        </button>
        <!-- 帮助页(新)— 5 分钟上手 + 详细指南入口 -->
        <button
          class="sidebar-item help-item"
          class:active={isActive("/help")}
          aria-current={isActive("/help") ? "page" : undefined}
          onclick={navHelpRoute}
          title="帮助 — 5 分钟上手 + 详细使用指南"
          aria-pressed={isActive("/help")}
        >
          <span class="nav-icon">❓</span>
          <span class="nav-label">帮助</span>
        </button>
      </div>

      <div class="sidebar-divider"></div>

      <div class="sidebar-section">
        <div class="sidebar-label">治理与协作</div>
        <button
          class="sidebar-item"
          class:active={isActive("/export")}
          aria-current={isActive("/export") ? "page" : undefined}
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
            aria-current={isActive("/publish-queue") ? "page" : undefined}
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
            aria-current={isActive("/version-history") ? "page" : undefined}
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
            aria-current={isActive("/audit") ? "page" : undefined}
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
            aria-current={isActive("/governance") ? "page" : undefined}
            onclick={() => go("/governance")}
            title="治理(evorule-rule)— 数据集/规则/5 态生命周期/审批发布/版本链"
            aria-pressed={isActive("/governance")}
          >
            <span class="nav-icon">🗂️</span>
            <span class="nav-label">治理中心</span>
          </button>
          <!-- 平台管理(UV-017 W4):仅 platform 登录且持有对应用户可见。
               用 hasPermission($currentUser,…) 而非 can():后者内部 get(currentUser)
               非响应式,模板表达式不会随登录态变化重算 -->
          {#if hasPermission($currentUser, "view_users") || hasPermission($currentUser, "manage_users")}
            <button
              class="sidebar-item"
              class:active={isActive("/users")}
              aria-current={isActive("/users") ? "page" : undefined}
              onclick={() => go("/users")}
              title="用户管理 — 平台账号/角色分配/启停(manage_users 可管理)"
              aria-pressed={isActive("/users")}
            >
              <span class="nav-icon">👥</span>
              <span class="nav-label">用户管理</span>
            </button>
          {/if}
          {#if hasPermission($currentUser, "manage_roles")}
            <button
              class="sidebar-item"
              class:active={isActive("/roles")}
              aria-current={isActive("/roles") ? "page" : undefined}
              onclick={() => go("/roles")}
              title="角色管理 — 自定义角色与权限矩阵"
              aria-pressed={isActive("/roles")}
            >
              <span class="nav-icon">🛡️</span>
              <span class="nav-label">角色管理</span>
            </button>
          {/if}
        {/if}
      </div>

      <div class="sidebar-divider"></div>

      <div class="sidebar-section">
        <button
          class="sidebar-item"
          class:active={showSettings}
          aria-current={showSettings ? "page" : undefined}
          onclick={() => openSettings()}
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
        <Settings onclose={closeSettings} initialTab={settingsInitialTab} />
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

    <!-- 右 LLM 交互侧栏(PR5:未配置时折叠窄条;PR10-重1:窄屏变抽屉) -->
    <aside
      class="sidebar llm-rail {rightDrawerOpen ? 'drawer-open' : ''}"
      style:width={`${llmConfigured ? rightWidth : LLM_COLLAPSED_W}px`}
    >
      {#if llmConfigured}
        <LlmChatSidebar />
      {:else}
        <div class="llm-collapsed" title="配置 LLM 助理以启用右侧对话">
          <button
            class="llm-collapse-btn"
            onclick={() => openSettings("llm")}
            aria-label="配置 LLM 助理"
            title="配置 LLM 助理"
          >
            <span class="llm-collapse-emoji">💬</span>
            <span class="llm-collapse-text">配置 LLM</span>
          </button>
        </div>
      {/if}
    </aside>
  </div>

  <!-- 窄屏抽屉遮罩(PR10-重1):任一抽屉开时显示,点击关闭 -->
  {#if leftDrawerOpen || rightDrawerOpen}
    <div class="drawer-mask" onclick={closeDrawers} role="presentation"></div>
  {/if}

  <!-- 全局 Toast 通知 -->
  <Toast />

  <!-- PR4:术语表弹窗(顶栏 ? 打开,全局) -->
  {#if showGlossary}
    <Glossary onclose={closeGlossary} />
  {/if}

  <!-- PR5:命令面板(顶栏搜索框 / Ctrl+K 唤起,全局) -->
  {#if showPalette}
    <CommandPalette
      onclose={closePalette}
      onOpenGlossary={openGlossary}
      onOpenSettings={() => openSettings("onboarding")}
    />
  {/if}

  <!-- PR4:首启交互式引导(零依赖 spotlight),全局挂载,确保任意页面/设置里重播都能显示 -->
  <TourOverlay />
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

  /* 右栏 LLM 未配置时的折叠窄条(PR5) */
  .llm-collapsed {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: var(--sp-sm) 0;
    background: var(--sidebar-bg);
  }
  .llm-collapse-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 100%;
    padding: var(--sp-md) 2px;
    background: transparent;
    border: none;
    color: var(--sidebar-text);
    cursor: pointer;
    border-radius: var(--r-sm);
    transition: background var(--tr-fast), color var(--tr-fast);
  }
  .llm-collapse-btn:hover {
    background: var(--sidebar-hover);
    color: var(--sidebar-text-active);
  }
  .llm-collapse-emoji {
    font-size: 18px;
    line-height: 1;
  }
  .llm-collapse-text {
    font-size: 11px;
    writing-mode: vertical-rl;
    letter-spacing: 1px;
  }

  /* 抽屉开关按钮:默认隐藏,仅窄屏显示 */
  .hamburger,
  .header-chat-btn {
    display: none;
  }

  /* 顶栏置于最高层:抽屉遮罩下仍可点汉堡/聊天按钮关闭 */
  .header {
    z-index: 1300;
  }

  /* 窄屏抽屉遮罩(PR10-重1) */
  .drawer-mask {
    position: fixed;
    inset: 0;
    z-index: 1100;
    background: rgba(2, 6, 23, 0.55);
    backdrop-filter: blur(1px);
  }

  @media (max-width: 900px) {
    .hamburger,
    .header-chat-btn {
      display: inline-flex;
    }

    /* 左导航 → 离屏抽屉 */
    .sidebar-left {
      position: fixed;
      top: 52px;
      left: 0;
      bottom: 0;
      width: 280px !important;
      max-width: 82vw;
      z-index: 1200;
      transform: translateX(-100%);
      transition: transform 0.25s ease;
      box-shadow: var(--sh-modal);
      border-right: 1px solid var(--border);
    }
    .sidebar-left.drawer-open {
      transform: translateX(0);
    }

    /* 右 LLM 栏 → 离屏抽屉 */
    .llm-rail {
      position: fixed;
      top: 52px;
      right: 0;
      bottom: 0;
      width: 320px !important;
      max-width: 88vw;
      z-index: 1200;
      transform: translateX(100%);
      transition: transform 0.25s ease;
      box-shadow: var(--sh-modal);
      border-left: 1px solid var(--border);
    }
    .llm-rail.drawer-open {
      transform: translateX(0);
    }

    /* 抽屉模式不再可拖拽,隐藏分隔条 */
    .resizer {
      display: none;
    }
  }
</style>