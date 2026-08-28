<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- 5 视图渲染页(迁移自原 src/routes/+page.svelte) -->
<!--
  职责:
    - 根据 /view/[id] 路由参数渲染对应视图(rules/execution/state/audit/timetravel)
    - audit → BusinessAuditView(P06 业务包装,替代内核 AuditView)
    - timetravel → BusinessTimeTravel(P06 业务包装,替代内核 TimeTravelView)
    - 同步 currentView store(用于顶部 nav-tabs 高亮)
    - 接通 LLM callback → Dialog(原 +page.svelte 逻辑)
    - 接通 ExportDialog(P07):BusinessAuditView onExportRequest → 打开 ExportDialog
  关联设计:HOME_DESIGN.md §4.1 路由表(/view/[id] → ViewRenderer)
-->

<script lang="ts">
  import { page } from "$app/stores";
  import { setView, ExecutionPadView, StateView } from "$lib/kernel";
  import type { ViewId } from "$lib/kernel";
  import {
    activeAssistantDialog,
    openAssistantDialog,
  } from "$lib/stores/assistant-ui";
  import { toastInfo } from "$lib/stores/toast";
  // T2: rules 视图接入 BusinessRuleLibrary(包装内核 RuleLibraryView + 业务/开发者模式)
  import BusinessRuleLibrary from "$lib/views/Rules/BusinessRuleLibrary.svelte";
  import DraftRuleDialog from "$lib/views/Assistant/DraftRuleDialog.svelte";
  import ExplainRuleDialog from "$lib/views/Assistant/ExplainRuleDialog.svelte";
  import GenerateInputDialog from "$lib/views/Assistant/GenerateInputDialog.svelte";
  // T4: audit / timetravel 视图接入业务包装(P06)
  import BusinessAuditView from "$lib/views/Audit/BusinessAuditView.svelte";
  import BusinessTimeTravel from "$lib/views/TimeTravel/BusinessTimeTravel.svelte";
  // T4: P07 ExportDialog(由 BusinessAuditView 触发)
  import ExportDialog from "$lib/views/Export/ExportDialog.svelte";
  import type {
    ExportContentType,
    ExportFilters,
  } from "$lib/stores/export-types";

  // 合法的 5 视图 id
  const VALID_VIEWS: ViewId[] = [
    "rules",
    "execution",
    "state",
    "audit",
    "timetravel",
  ];

  // 从路由参数获取 viewId,非法值 fallback 到 'rules'
  const viewId = $derived(
    VALID_VIEWS.includes($page.params.id as ViewId)
      ? ($page.params.id as ViewId)
      : "rules",
  );

  // 同步到 currentView store(用于顶部 nav-tabs 高亮)
  $effect(() => {
    setView(viewId);
  });

  // === P07 ExportDialog 状态(由 BusinessAuditView onExportRequest 触发) ===
  let exportOpen = $state(false);
  let exportPreset = $state<
    | { contents?: ExportContentType[]; filters?: Partial<ExportFilters> }
    | undefined
  >(undefined);

  function handleExportRequest(preset: {
    contents: string[];
    filters?: unknown;
  }): void {
    // BusinessAuditView 传入的 contents 是 string[],这里收窄为 ExportContentType[]
    // (BusinessAuditView 已保证只传合法的 ExportContentType 值)
    exportPreset = {
      contents: preset.contents as ExportContentType[],
      filters: preset.filters as Partial<ExportFilters> | undefined,
    };
    exportOpen = true;
  }

  function handleCloseExport(): void {
    exportOpen = false;
    exportPreset = undefined;
  }

  // === 回滚请求(P0:toast 提示;真实回滚 API 由后续阶段接入) ===
  function handleRollbackRequest(targetVersion: number): void {
    toastInfo(
      `回滚请求已记录: ruleset v${targetVersion}(P0 演示模式,真实回滚 API 待接入)`,
    );
  }
</script>

{#if viewId === "rules"}
  <BusinessRuleLibrary
    onaiGenerateDraft={() => openAssistantDialog("draft")}
    onaiExplainRule={() => openAssistantDialog("explain")}
  />
{:else if viewId === "execution"}
  <ExecutionPadView onaiGenerateInput={() => openAssistantDialog("input")} />
{:else if viewId === "state"}
  <StateView />
{:else if viewId === "audit"}
  <BusinessAuditView
    onRollbackRequest={handleRollbackRequest}
    onExportRequest={handleExportRequest}
  />
{:else if viewId === "timetravel"}
  <BusinessTimeTravel onRollbackRequest={handleRollbackRequest} />
{/if}

<!-- LLM 三 Dialog(条件渲染,只一个能开) -->
{#if $activeAssistantDialog === "draft"}
  <DraftRuleDialog />
{:else if $activeAssistantDialog === "explain"}
  <ExplainRuleDialog />
{:else if $activeAssistantDialog === "input"}
  <GenerateInputDialog />
{/if}

<!-- T4: P07 通用导出对话框(由 BusinessAuditView 触发) -->
<ExportDialog
  open={exportOpen}
  preset={exportPreset}
  onClose={handleCloseExport}
/>
