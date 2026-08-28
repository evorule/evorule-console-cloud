<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:业务审计主视图(P06 §6.1 + §6.2 + §8.1)
    - 包装内核 AuditView(开发者模式)
    - 业务模式:AuditToolbar + AuditTimeline + CausalGraph + DecisionSupportPanel
    - onMount / sessionId 变化时:refreshAudit 拉取审计链
    - 验证 / 决策建议 / 导出 / 导入 / 因果总结 全部走 store actions
    - 一键回滚:委托父组件处理(不在本视图直调 backend API)
  注入:
    - useBackend():ExecutionBackend(来自 +layout.svelte provideBackend)
    - useAssistantOrNull():LLM Assistant(可能为 null)
  关联设计:P06_BUSINESS_AUDIT_TT_DESIGN.md §6 + §7 + §8.1
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import {
    AuditView,
    useBackend,
    useAssistantOrNull,
    currentSessionId,
    auditLoading,
    auditError,
    refreshAudit,
    verifyAuditChain,
    fetchCausalChain,
    clearCausalSelection,
    causalSelection,
  } from "$lib/kernel";
  import { toastInfo, toastError, toastSuccess } from "$lib/stores/toast";
  import {
    businessAuditStore,
    businessAuditSummary,
  } from "$lib/stores/business-audit";
  import {
    businessCausalStore,
    causalSummary,
    setCausalSummary,
  } from "$lib/stores/business-causal";
  import {
    decisionSupportStore,
    isAnalyzing,
    decisionSupportError,
    requestDecisionSupport,
    clearDecisionSupport,
  } from "$lib/stores/decision-support";
  import {
    auditExportStore,
    exportAudit,
    importAudit,
    resetAuditExport,
    readFileAsText,
    readFileAsBlob,
  } from "$lib/stores/audit-export";

  import AuditToolbar from "./AuditToolbar.svelte";
  import AuditTimeline from "./AuditTimeline.svelte";
  import CausalGraph from "./CausalGraph.svelte";
  import DecisionSupportPanel from "./DecisionSupportPanel.svelte";
  import RollbackButton from "./RollbackButton.svelte";
  import ConfirmDialog from "../Home/Monitor/ConfirmDialog.svelte";

  // === Props ===
  interface Props {
    /** 回滚请求回调(由父组件 / RealWorkbench 处理实际回滚 API) */
    onRollbackRequest?: (targetVersion: number) => void;
    /** 导出按钮回调(打开 P07 ExportDialog,预选 audit_chain) */
    onExportRequest?: (preset: {
      contents: string[];
      filters?: unknown;
    }) => void;
  }

  let { onRollbackRequest, onExportRequest }: Props = $props();

  // === Context ===
  const backend = useBackend();
  const assistant = useAssistantOrNull();

  // === 状态 ===
  let mode = $state<"business" | "developer">("business");
  let selectedFactId = $state<number | null>(null);
  let selectedRange = $state<{ from: number; to: number } | null>(null);
  let verifying = $state(false);
  let showRollbackConfirm = $state(false);
  let rollbackTarget = $state<number | null>(null);

  // === 派生:store 订阅(用 $ 自动订阅,确保响应式) ===
  let auditEntries = $derived($businessAuditStore);
  let summary = $derived($businessAuditSummary);
  let causalChain = $derived($businessCausalStore);
  let causalLoading = $derived($auditLoading);
  let decision = $derived($decisionSupportStore);
  let analyzing = $derived($isAnalyzing);
  let sessionId = $derived($currentSessionId);
  let hasCausal = $derived($causalSelection !== null);
  let auditErr = $derived($auditError);
  let exportState = $derived($auditExportStore);
  let decisionErr = $derived($decisionSupportError);

  // === 持久化 mode 到 localStorage ===
  onMount(() => {
    const saved =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("evorule:audit-mode")
        : null;
    if (saved === "business" || saved === "developer") {
      mode = saved;
    }
    // 拉取审计链
    void loadAudit();
  });

  // session 变化时重新拉取审计链
  $effect(() => {
    if (sessionId !== null) {
      void loadAudit();
    }
  });

  async function loadAudit(): Promise<void> {
    if (sessionId === null) return;
    await refreshAudit(backend, sessionId);
  }

  // === 工具栏回调 ===
  function handleToggleMode(): void {
    mode = mode === "business" ? "developer" : "business";
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("evorule:audit-mode", mode);
    }
  }

  async function handleVerify(): Promise<void> {
    if (sessionId === null) {
      toastError("无活动 session,无法验证");
      return;
    }
    verifying = true;
    try {
      const result = await verifyAuditChain(backend, sessionId);
      if (result?.verified) {
        toastSuccess("BLAKE3 审计链验证通过,链完整不可篡改");
      } else {
        toastError(`审计链验证失败: ${result?.detail ?? "链断裂,可能被篡改"}`);
      }
    } catch (e) {
      toastError(`验证失败: ${(e as Error).message}`);
    } finally {
      verifying = false;
    }
  }

  function handleExport(): void {
    if (onExportRequest) {
      // 委托给父组件打开 P07 ExportDialog(预选 audit_chain + visible 范围)
      onExportRequest({
        contents: ["audit_chain", "causal_chain"],
        filters: { timeRange: "visible" },
      });
      return;
    }
    // 兜底:直接调用 P06 §5.4 简版导出(JSON)
    if (sessionId === null) {
      toastError("无活动 session,无法导出");
      return;
    }
    void exportAudit(sessionId, backend, false);
  }

  async function handleImportFile(file: File): Promise<void> {
    if (sessionId === null) {
      toastError("无活动 session,无法导入");
      return;
    }
    try {
      const isCompressed =
        file.name.endsWith(".gz") || file.type === "application/gzip";
      if (isCompressed) {
        const blob = readFileAsBlob(file);
        await importAudit(sessionId, backend, blob, true);
      } else {
        const text = await readFileAsText(file);
        const data = JSON.parse(text);
        await importAudit(sessionId, backend, data, false);
      }
      const state = get(auditExportStore);
      if (state.status === "done") {
        toastSuccess(state.message);
      } else if (state.status === "error") {
        toastError(state.message);
      }
    } catch (e) {
      toastError(`导入失败: ${(e as Error).message}`);
    }
  }

  async function handleDecisionSupport(): Promise<void> {
    if (!assistant) {
      toastError("LLM 未配置,请先在设置中配置");
      return;
    }
    if (!selectedRange) {
      toastInfo("请先在审计时间线选中一段(Shift+Click 起止条目)");
      return;
    }
    await requestDecisionSupport(assistant, selectedRange);
    const err = get(decisionSupportError);
    if (err) {
      toastError(err);
    } else if (get(decisionSupportStore)) {
      toastSuccess("决策建议已生成");
    }
  }

  async function handleCausalSummary(): Promise<void> {
    if (!assistant) {
      toastError("LLM 未配置,无法生成因果总结");
      return;
    }
    if (!causalChain) {
      toastInfo("请先选中一条 Fact 查看因果链");
      return;
    }
    try {
      const prompt = `分析以下 evorule 因果链,用一段中文总结因果关系(不超过 100 字):

${causalChain.nodes
  .map((n, i) => `[${i + 1}] ${n.businessDescription} → ${n.causalExplanation}`)
  .join("\n")}

只输出总结文字,不要 JSON,不要 markdown。`;

      const result = await assistant.explainRule({ prompt } as object);
      setCausalSummary(result);
      toastSuccess("因果链总结已生成");
    } catch (e) {
      toastError(`因果总结失败: ${(e as Error).message}`);
    }
  }

  // === 时间线回调 ===
  function handleSelectFact(factId: number): void {
    if (factId < 0) {
      // 清除选择
      selectedFactId = null;
      selectedRange = null;
      clearCausalSelection();
      setCausalSummary(null);
      return;
    }
    selectedFactId = factId;
    selectedRange = null;
    if (sessionId !== null) {
      void fetchCausalChain(backend, sessionId, factId);
    }
  }

  function handleSelectRange(range: { from: number; to: number } | null): void {
    selectedRange = range;
  }

  function handleCloseCausal(): void {
    clearCausalSelection();
    setCausalSummary(null);
    selectedFactId = null;
  }

  // === 决策支持回滚 ===
  function handleRollbackFromDecision(targetVersion: number): void {
    rollbackTarget = targetVersion;
    showRollbackConfirm = true;
  }

  function handleRollbackButton(version: number): void {
    rollbackTarget = version;
    showRollbackConfirm = true;
  }

  function handleConfirmRollback(): void {
    showRollbackConfirm = false;
    if (rollbackTarget !== null) {
      onRollbackRequest?.(rollbackTarget);
      toastInfo(`回滚请求已提交: ruleset v${rollbackTarget}`);
    }
    rollbackTarget = null;
  }

  function handleCancelRollback(): void {
    showRollbackConfirm = false;
    rollbackTarget = null;
  }
</script>

{#if mode === "developer"}
  <div class="developer-mode-wrapper">
    <div class="dev-banner">
      <span>🔧 开发者模式 — 显示内核 AuditView(raw 数据)</span>
      <button class="dev-back-btn" onclick={handleToggleMode}
        >← 返回业务模式</button
      >
    </div>
    <AuditView />
  </div>
{:else}
  <div class="business-audit-view">
    <AuditToolbar
      {mode}
      {verifying}
      {analyzing}
      hasSelection={selectedRange !== null}
      {hasCausal}
      llmConfigured={assistant !== null}
      onToggleMode={handleToggleMode}
      onVerify={handleVerify}
      onExport={handleExport}
      onImportFile={handleImportFile}
      onDecisionSupport={handleDecisionSupport}
      onCausalSummary={handleCausalSummary}
    />

    {#if auditErr}
      <div class="audit-error">⚠️ {auditErr}</div>
    {/if}

    {#if exportState.status === "done" && exportState.message}
      <div class="export-toast">{exportState.message}</div>
    {/if}

    <div class="main-area">
      <div class="timeline-col">
        <AuditTimeline
          entries={auditEntries}
          {summary}
          {selectedFactId}
          {selectedRange}
          onSelectFact={handleSelectFact}
          onSelectRange={handleSelectRange}
        />
      </div>
      <div class="causal-col">
        <CausalGraph
          chain={causalChain}
          loading={causalLoading && !causalChain}
          onClose={handleCloseCausal}
        />
        {#if selectedFactId !== null && sessionId !== null}
          <div class="quick-rollback">
            <RollbackButton
              version={selectedFactId}
              onRollbackRequest={handleRollbackButton}
            />
            <span class="hint"
              >注:fact_id 作为版本号参考,实际回滚版本由 Confirm 确认</span
            >
          </div>
        {/if}
      </div>
    </div>

    {#if decision}
      <DecisionSupportPanel
        {decision}
        onRollback={handleRollbackFromDecision}
        onClose={clearDecisionSupport}
      />
    {/if}

    {#if decisionErr}
      <div class="decision-error">⚠️ {decisionErr}</div>
    {/if}
  </div>
{/if}

{#if showRollbackConfirm && rollbackTarget !== null}
  <ConfirmDialog
    open={showRollbackConfirm}
    title="一键回滚"
    message={`确认回滚到 ruleset v${rollbackTarget}?将用旧规则产生新版本,触发滚动 session 热重载。`}
    confirmLabel="确认回滚"
    level="danger"
    onConfirm={handleConfirmRollback}
    onCancel={handleCancelRollback}
  />
{/if}

<style>
  .business-audit-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding: 10px 12px;
    gap: 10px;
    background: var(--color-gray-50, #f8fafc);
    overflow: auto;
  }

  .developer-mode-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: auto;
  }
  .dev-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--color-warning-bg, #fef3c7);
    border-bottom: 1px solid var(--color-warning, #fde68a);
    font-size: 12px;
    color: var(--color-warning, #92400e);
  }
  .dev-back-btn {
    background: var(--bg-card);
    border: 1px solid var(--color-warning, #fde68a);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 11px;
    cursor: pointer;
    color: var(--color-warning, #92400e);
    font-weight: 600;
  }

  .main-area {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
    gap: 10px;
    flex: 1;
    min-height: 360px;
  }
  .timeline-col,
  .causal-col {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .causal-col {
    overflow: hidden;
  }

  .quick-rollback {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--bg-card);
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 6px;
    flex-wrap: wrap;
  }
  .quick-rollback .hint {
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
  }

  .audit-error,
  .decision-error {
    padding: 8px 12px;
    background: var(--color-error-bg, #fef2f2);
    border: 1px solid var(--color-error, #fca5a5);
    border-radius: 6px;
    color: var(--color-error, #991b1b);
    font-size: 12px;
  }
  .export-toast {
    padding: 8px 12px;
    background: var(--color-success-bg, #dcfce7);
    border: 1px solid var(--color-success, #86efac);
    border-radius: 6px;
    color: var(--color-success, #166534);
    font-size: 12px;
  }

  @media (max-width: 1024px) {
    .main-area {
      grid-template-columns: 1fr;
    }
  }
</style>
