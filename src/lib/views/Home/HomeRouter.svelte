<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:状态感知首页路由(UV-021 W2 收敛)
    - 状态决策(A/B/C):
        force-demo           → A DemoHome
        !session.loggedIn    → A DemoHome
        isEmptyDb            → B OnboardingWizard
        wizardInProgress     → B OnboardingWizard(向导进行中不切走)
        else                 → C goto('/workbench') 总览着陆(UV-021 W2)
    - 历史:状态 C 原内嵌 RealWorkbench(层感知 L1/L2),已随 UV-021 W2 退役:
      总览 /workbench 成为唯一首页,监控大屏改由侧栏「监控」直达(/monitor)

  依赖:sessionStore / isEmptyDb / homeModeStore / wizardInProgress
  关联设计:HOME_DESIGN.md §3(状态机) + UV-021 盘点与计划(07)
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { sessionStore } from "$lib/stores/session";
  import { isEmptyDb } from "$lib/stores/db";
  import { homeModeStore, wizardInProgress } from "$lib/stores/home-mode";
  import { shouldAutoStartTour, startTour } from "$lib/stores/onboarding";
  import DemoHome from "./DemoHome.svelte";
  import OnboardingWizard from "./OnboardingWizard.svelte";

  type HomeMode = "A" | "B" | "C";

  // 状态决策(A/B/C)— 基于派生 isEmptyDb(内核 rules store)
  //
  // 响应式关键:必须用 $ 前缀自动订阅读取 store。
  // 原实现 resolveMode() 内部用 get(store) 快照读 — Svelte 5 中 get()
  // 不被 $derived 依赖追踪,mode 在组件挂载时求值一次后永久冻结,
  // 导致登录/取消向导/完成建库等状态迁移全部失效(建库向导无法退出 bug)。
  const mode = $derived.by<HomeMode>(() => {
    if ($homeModeStore === "force-demo") return "A";

    if (!$sessionStore.loggedIn) return "A";

    // T2:向导进行中时强制保持在 B(模板已加载规则导致 isEmptyDb=false 也不切到 C)
    if ($wizardInProgress) return "B";

    if ($isEmptyDb) return "B";

    return "C";
  });

  // 状态 C → 总览着陆(UV-021 W2):/workbench 是唯一首页
  $effect(() => {
    if (mode === "C") {
      void goto("/workbench");
    }
  });

  // PR3:首次进入首页且未看过/未跳过引导时,自动播放 Tour
  onMount(() => {
    if (shouldAutoStartTour()) {
      startTour();
    }
  });
</script>

{#if mode === "A"}
  <DemoHome />
{:else if mode === "B"}
  <OnboardingWizard />
{:else}
  <!-- C:跳转 /workbench 过渡态(正常情况一闪而过) -->
  <div class="redirecting">正在进入总览…</div>

  <style>
    .redirecting {
      max-width: 1200px;
      margin: 0 auto;
      padding: 48px 24px;
      text-align: center;
      color: var(--text-secondary, #64748b);
      font-size: 14px;
    }
  </style>
{/if}
