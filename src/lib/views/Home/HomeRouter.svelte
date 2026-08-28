<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:状态感知 + 层感知首页路由
    - 状态决策(A/B/C):
        force-demo           → A DemoHome
        !session.loggedIn    → A DemoHome
        isEmptyDb            → B OnboardingWizard
        wizardInProgress     → B OnboardingWizard(T2 新增,见下)
        else                 → C RealWorkbench
    - 层感知(状态 C 内部):
        进入 C 时若 layerStore=null,按 production 状态选默认层
        有已发布规则 → L1 监控大屏;无 → L2 编辑台

  T2 新增 wizardInProgress:
    - 模板在 Step 2 调 loadTemplate 会向内核 rules store 加 builtin 规则,
      导致派生 isEmptyDb 变 false
    - 若不覆盖,HomeRouter 会立即从状态 B(向导)切到状态 C(工作台),
      向导流程被中断
    - wizardInProgress=true 时,HomeRouter 忽略 isEmptyDb,保持在状态 B
  依赖:sessionStore / isEmptyDb / homeModeStore / wizardInProgress / layerStore / productionStateStore
  关联设计:HOME_DESIGN.md §3(状态机) + §4.4(HomeRouter 决策) + §3.3(层视图切换矩阵)
-->

<script lang="ts">
  import { get } from "svelte/store";
  import { onMount } from "svelte";
  import { sessionStore } from "$lib/stores/session";
  import { isEmptyDb } from "$lib/stores/db";
  import { homeModeStore, wizardInProgress } from "$lib/stores/home-mode";
  import { layerStore, resolveDefaultLayer } from "$lib/stores/layer";
  import { productionStateStore } from "$lib/stores/production-state";
  import { shouldAutoStartTour, startTour } from "$lib/stores/onboarding";
  import DemoHome from "./DemoHome.svelte";
  import OnboardingWizard from "./OnboardingWizard.svelte";
  import RealWorkbench from "./RealWorkbench.svelte";

  type HomeMode = "A" | "B" | "C";

  // 状态决策(A/B/C)— 基于派生 isEmptyDb(内核 rules store)
  function resolveMode(): HomeMode {
    const mode = get(homeModeStore);
    if (mode === "force-demo") return "A";

    const session = get(sessionStore);
    if (!session.loggedIn) return "A";

    // T2:向导进行中时强制保持在 B(模板已加载规则导致 isEmptyDb=false 也不切到 C)
    if (get(wizardInProgress)) return "B";

    if (get(isEmptyDb)) return "B";

    return "C";
  }

  const mode = $derived(resolveMode());

  // 进入状态 C 时,若 layerStore 未初始化,按 production 状态选默认层
  // (有已发布规则 → L1 监控大屏;无 → L2 编辑台)
  $effect(() => {
    if (mode === "C" && get(layerStore) === null) {
      layerStore.set(resolveDefaultLayer(get(productionStateStore)));
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
  <RealWorkbench layer={$layerStore} />
{/if}
