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
    type SharedFactEntry,
    type SharedFactsVersionInfo,
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
    /** 回滚请求回调(由父组件处理实际回滚 API) */
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

  // === UV-062 W2 接线1+2:审计设置(auto_verify 开关 + 双格式导出) ===
  /** auto_verify 当前状态(null = 未知:无 session / 读取中 / 读取失败) */
  let autoVerifyEnabled = $state<boolean | null>(null);
  let autoVerifyToggling = $state(false);
  let autoVerifyError = $state<string | null>(null);
  let exportingFormat = $state<"json" | "compressed" | null>(null);

  // === UV-062 W2 接线4:因果深度(null = 未知:无 session / 读取中 / 读取失败) ===
  let causalDepth = $state<number | null>(null);
  let causalDepthError = $state<string | null>(null);

  // === UV-084 W1-A5:共享事实(跨会话广播事实查询,GET /api/shared/facts) ===
  let sharedFactsExpanded = $state(false);
  let sharedFacts = $state<SharedFactEntry[] | null>(null);
  let sharedFactsVersionInfo = $state<SharedFactsVersionInfo | null>(null);
  let sharedFactsPrefix = $state("");
  let sharedFactsLoading = $state(false);
  let sharedFactsError = $state<string | null>(null);

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
    // UV-078 W2-B6:键前缀统一为 evorule-console-cloud:,读旧键迁移(读旧→写新→删旧)
    const OLD_KEY = "evorule:audit-mode";
    const NEW_KEY = "evorule-console-cloud:audit-mode";
    const saved =
      typeof localStorage !== "undefined"
        ? (localStorage.getItem(NEW_KEY) ?? localStorage.getItem(OLD_KEY))
        : null;
    if (saved === "business" || saved === "developer") {
      mode = saved;
    }
    if (typeof localStorage !== "undefined") {
      if (localStorage.getItem(OLD_KEY) !== null) {
        localStorage.setItem(NEW_KEY, mode);
        localStorage.removeItem(OLD_KEY);
      }
    }
    // 拉取审计链
    void loadAudit();
  });

  // session 变化时重新拉取审计链 + auto_verify 状态 + 因果深度
  $effect(() => {
    if (sessionId !== null) {
      void loadAudit();
      void loadAutoVerify();
      void loadCausalDepth();
    }
  });

  async function loadAudit(): Promise<void> {
    if (sessionId === null) return;
    await refreshAudit(backend, sessionId);
  }

  // === UV-062 W2 接线2:auto_verify 开关 ===
  /** 读取当前会话的审计链自动验证状态(失败显式错误态,不静默) */
  async function loadAutoVerify(): Promise<void> {
    if (sessionId === null) return;
    autoVerifyError = null;
    try {
      const status = await backend.getAutoVerify(sessionId);
      autoVerifyEnabled = status.auto_verify;
    } catch (e) {
      autoVerifyEnabled = null;
      autoVerifyError = `读取失败: ${(e as Error).message}`;
    }
  }

  /** 切换 auto_verify:乐观更新 → POST;失败回滚显示 + toast 报错 */
  async function handleToggleAutoVerify(): Promise<void> {
    if (sessionId === null || autoVerifyEnabled === null || autoVerifyToggling) {
      return;
    }
    const prev = autoVerifyEnabled;
    const next = !prev;
    autoVerifyToggling = true;
    autoVerifyError = null;
    autoVerifyEnabled = next; // 乐观更新
    try {
      const result = await backend.setAutoVerify(sessionId, next);
      if (!result.success) {
        // server 显式拒绝:回滚 + 报错
        autoVerifyEnabled = prev;
        autoVerifyError = result.message || "server 拒绝";
        toastError(`自动验证设置失败: ${autoVerifyError}`);
      } else {
        autoVerifyEnabled = result.auto_verify;
        toastSuccess(
          `自动验证已${result.auto_verify ? "开启" : "关闭"}`,
        );
      }
    } catch (e) {
      // 网络/HTTP 错误:回滚 + toast
      autoVerifyEnabled = prev;
      autoVerifyError = (e as Error).message;
      toastError(`自动验证设置失败: ${(e as Error).message}`);
    } finally {
      autoVerifyToggling = false;
    }
  }

  // === UV-062 W2 接线4:因果深度 ===
  /** 读取当前会话因果深度(GET /causal_depth;失败显式错误态,不静默) */
  async function loadCausalDepth(): Promise<void> {
    if (sessionId === null) return;
    causalDepthError = null;
    try {
      const info = await backend.getCausalDepth(sessionId);
      causalDepth = info.causal_depth;
    } catch (e) {
      causalDepth = null;
      causalDepthError = `读取失败: ${(e as Error).message}`;
    }
  }

  // === UV-084 W1-A5:共享事实(跨会话广播,只读查询面) ===
  /**
   * 拉取共享事实列表 + 日志版本。跨会话全局数据,不依赖当前 session;
   * 失败显式错误态(不静默),支持前缀过滤。
   */
  async function loadSharedFacts(): Promise<void> {
    sharedFactsLoading = true;
    sharedFactsError = null;
    try {
      const prefix = sharedFactsPrefix.trim() || undefined;
      const [facts, version] = await Promise.all([
        backend.getSharedFacts(prefix),
        backend.getSharedFactsVersion(),
      ]);
      sharedFacts = facts;
      sharedFactsVersionInfo = version;
    } catch (e) {
      sharedFacts = null;
      sharedFactsVersionInfo = null;
      sharedFactsError = `读取失败: ${(e as Error).message}`;
    } finally {
      sharedFactsLoading = false;
    }
  }

  /** 展开/折叠共享事实区块;首次展开自动拉取 */
  function handleToggleSharedFacts(): void {
    sharedFactsExpanded = !sharedFactsExpanded;
    if (sharedFactsExpanded && sharedFacts === null && !sharedFactsLoading) {
      void loadSharedFacts();
    }
  }

  // === UV-062 W2 接线1:审计链双格式导出 ===
  /**
   * 导出审计链(JSON / 压缩)。复用 audit-export store:
   * fetch blob + Bearer(backend 层注入)+ URL.createObjectURL 下载;
   * store 内部捕获错误置 error 态,此处读态显式 toast(不静默)。
   */
  async function handleExportChain(compressed: boolean): Promise<void> {
    if (sessionId === null) {
      toastError("无活动 session,无法导出审计链");
      return;
    }
    exportingFormat = compressed ? "compressed" : "json";
    try {
      await exportAudit(sessionId, backend, compressed);
      const state = get(auditExportStore);
      if (state.status === "error") {
        toastError(state.message);
      } else if (state.status === "done") {
        toastSuccess(state.message);
      }
    } finally {
      exportingFormat = null;
    }
  }

  // === 工具栏回调 ===
  function handleToggleMode(): void {
    mode = mode === "business" ? "developer" : "business";
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("evorule-console-cloud:audit-mode", mode);
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
    // UV-084 W1:server 端 import 是破坏性操作(完全覆盖当前会话审计链),须二次确认
    const confirmed = confirm(
      `导入将完全覆盖 session ${sessionId} 的当前审计链,且不可撤销。\n确定导入 "${file.name}" 吗?`,
    );
    if (!confirmed) {
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

    <!-- UV-062 W2 接线1+2:审计设置区(auto_verify 开关 + 双格式审计链导出) -->
    <div class="audit-settings">
      <div class="setting-item">
        <span class="setting-label">⚙️ 自动验证</span>
        {#if sessionId === null}
          <span class="setting-hint">无活动 session</span>
        {:else if autoVerifyError}
          <span class="setting-error" title={autoVerifyError}
            >⚠️ {autoVerifyError}</span
          >
          <button
            class="setting-retry"
            onclick={() => void loadAutoVerify()}
            title="重试读取自动验证状态">↻ 重试</button
          >
        {:else if autoVerifyEnabled === null}
          <span class="setting-hint">读取中…</span>
        {:else}
          <button
            class="av-switch"
            class:on={autoVerifyEnabled}
            role="switch"
            aria-checked={autoVerifyEnabled}
            aria-label="审计链自动验证开关"
            disabled={autoVerifyToggling}
            onclick={() => void handleToggleAutoVerify()}
            title="审计链实时验证:开启后 server 每次写入审计事实即自动校验 BLAKE3 链"
          >
            <span class="av-track"><span class="av-knob"></span></span>
            <span class="av-text"
              >{autoVerifyToggling ? "…" : autoVerifyEnabled ? "已开启" : "已关闭"}</span
            >
          </button>
        {/if}
      </div>

      <div class="setting-divider"></div>

      <div class="setting-item">
        <span class="setting-label">📥 导出审计链</span>
        <button
          class="export-btn"
          onclick={() => void handleExportChain(false)}
          disabled={exportingFormat !== null}
          title="下载完整审计链 JSON(含完整哈希链)"
        >
          {exportingFormat === "json" ? "⏳ 导出中…" : "JSON"}
        </button>
        <button
          class="export-btn"
          onclick={() => void handleExportChain(true)}
          disabled={exportingFormat !== null}
          title="下载 gzip 压缩审计链(体积约为 JSON 的 5-10%)"
        >
          {exportingFormat === "compressed" ? "⏳ 导出中…" : "压缩 (.gz)"}
        </button>
      </div>
    </div>

    <!-- UV-084 W1-A5:共享事实区块(跨会话广播事实,只读查询面;默认折叠) -->
    <div class="shared-facts-section">
      <button
        class="shared-facts-toggle"
        onclick={handleToggleSharedFacts}
        aria-expanded={sharedFactsExpanded}
        title="跨会话广播的共享事实(payload 写入 shared.* 前缀路径时同步广播)"
      >
        <span class="toggle-arrow" class:expanded={sharedFactsExpanded}>▸</span>
        🌐 共享事实(跨会话广播)
        {#if sharedFactsVersionInfo}
          <span class="shared-facts-meta"
            >v{sharedFactsVersionInfo.version} · {sharedFactsVersionInfo.history_len}
              条</span
          >
        {/if}
      </button>

      {#if sharedFactsExpanded}
        <div class="shared-facts-body">
          <div class="shared-facts-filter">
            <input
              type="text"
              bind:value={sharedFactsPrefix}
              placeholder="路径前缀过滤(如 shared.platform.),回车查询"
              onkeydown={(e) => {
                if (e.key === "Enter") void loadSharedFacts();
              }}
            />
            <button
              class="shared-facts-refresh"
              onclick={() => void loadSharedFacts()}
              disabled={sharedFactsLoading}
              >{sharedFactsLoading ? "⏳ 查询中…" : "查询"}</button
            >
          </div>

          {#if sharedFactsError}
            <div class="shared-facts-error">⚠️ {sharedFactsError}</div>
          {:else if sharedFacts === null}
            <div class="shared-facts-hint">尚未查询</div>
          {:else if sharedFacts.length === 0}
            <div class="shared-facts-hint">无匹配的共享事实</div>
          {:else}
            <table class="shared-facts-table">
              <thead>
                <tr>
                  <th>fact_id</th>
                  <th>路径</th>
                  <th>值</th>
                  <th>来源会话</th>
                  <th>版本</th>
                </tr>
              </thead>
              <tbody>
                {#each sharedFacts as f (f.fact_id)}
                  <tr>
                    <td class="mono">{f.fact_id}</td>
                    <td class="mono path">{f.path}</td>
                    <td class="mono value"
                      >{JSON.stringify(f.value).slice(0, 80)}</td
                    >
                    <td class="mono">#{f.source_session_id}</td>
                    <td class="mono">{f.version}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      {/if}
    </div>

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
        <!-- UV-062 W2 接线4:当前会话因果深度 -->
        <div class="causal-depth-bar">
          <span class="cd-label">🌊 因果深度</span>
          {#if sessionId === null}
            <span class="setting-hint">无活动 session</span>
          {:else if causalDepthError}
            <span class="setting-error" title={causalDepthError}
              >⚠️ {causalDepthError}</span
            >
            <button
              class="setting-retry"
              onclick={() => void loadCausalDepth()}
              title="重试读取因果深度">↻ 重试</button
            >
          {:else if causalDepth === null}
            <span class="setting-hint">读取中…</span>
          {:else}
            <span class="cd-value" title="当前会话因果链深度(最长因果链层数)"
              >{causalDepth}</span
            >
          {/if}
          {#if sessionId !== null && !causalDepthError}
            <button
              class="cd-refresh"
              onclick={() => void loadCausalDepth()}
              title="刷新因果深度">↻</button
            >
          {/if}
        </div>
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
    background: var(--bg-page, #f8fafc);
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
    background: var(--warning-bg, #fef3c7);
    border-bottom: 1px solid var(--warning, #fde68a);
    font-size: 12px;
    color: var(--warning, #92400e);
  }
  .dev-back-btn {
    background: var(--bg-card);
    border: 1px solid var(--warning, #fde68a);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 11px;
    cursor: pointer;
    color: var(--warning, #92400e);
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
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 6px;
    flex-wrap: wrap;
  }
  .quick-rollback .hint {
    font-size: 10px;
    color: var(--text-secondary, #6b7280);
  }

  .audit-error,
  .decision-error {
    padding: 8px 12px;
    background: var(--danger-bg, #fef2f2);
    border: 1px solid var(--danger, #fca5a5);
    border-radius: 6px;
    color: var(--danger, #991b1b);
    font-size: 12px;
  }
  .export-toast {
    padding: 8px 12px;
    background: var(--success-bg, #dcfce7);
    border: 1px solid var(--success, #86efac);
    border-radius: 6px;
    color: var(--success, #166534);
    font-size: 12px;
  }

  /* === UV-062 W2 接线1+2:审计设置区 === */
  .audit-settings {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    background: var(--bg-card);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .setting-item {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .setting-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary, #4b5563);
    white-space: nowrap;
  }
  .setting-divider {
    width: 1px;
    height: 20px;
    background: var(--border, #e5e7eb);
  }
  .setting-hint {
    font-size: 11px;
    color: var(--text-secondary, #9ca3af);
  }
  .setting-error {
    font-size: 11px;
    color: var(--danger, #991b1b);
    max-width: 360px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .setting-retry {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card);
    color: var(--text-secondary, #6b7280);
    cursor: pointer;
  }
  .setting-retry:hover {
    background: var(--bg-page, #f9fafb);
  }

  /* === UV-084 W1-A5:共享事实区块(跨会话广播,只读查询面) === */
  .shared-facts-section {
    background: var(--bg-card);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    flex-shrink: 0;
    overflow: hidden;
  }
  .shared-facts-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: transparent;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary, #4b5563);
    cursor: pointer;
    text-align: left;
  }
  .shared-facts-toggle:hover {
    background: var(--bg-page, #f9fafb);
  }
  .toggle-arrow {
    display: inline-block;
    transition: transform 0.15s ease;
    font-size: 10px;
    color: var(--text-dim, #9ca3af);
  }
  .toggle-arrow.expanded {
    transform: rotate(90deg);
  }
  .shared-facts-meta {
    font-size: 11px;
    font-weight: 400;
    color: var(--text-dim, #9ca3af);
    margin-left: auto;
  }
  .shared-facts-body {
    padding: 8px 12px 12px;
    border-top: 1px solid var(--border, #e5e7eb);
  }
  .shared-facts-filter {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }
  .shared-facts-filter input {
    flex: 1;
    font-size: 12px;
    padding: 4px 8px;
    border: 1px solid var(--border, #d1d5db);
    border-radius: 4px;
    background: var(--bg-page, #f9fafb);
    color: var(--text-primary, #111827);
  }
  .shared-facts-refresh {
    font-size: 12px;
    padding: 4px 12px;
    border-radius: 4px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card);
    color: var(--text-secondary, #6b7280);
    cursor: pointer;
  }
  .shared-facts-refresh:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .shared-facts-error {
    font-size: 12px;
    color: var(--danger, #991b1b);
  }
  .shared-facts-hint {
    font-size: 12px;
    color: var(--text-dim, #9ca3af);
  }
  .shared-facts-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  .shared-facts-table th {
    text-align: left;
    padding: 4px 8px;
    color: var(--text-dim, #9ca3af);
    font-weight: 600;
    border-bottom: 1px solid var(--border, #e5e7eb);
    white-space: nowrap;
  }
  .shared-facts-table td {
    padding: 4px 8px;
    border-bottom: 1px solid var(--border, #f3f4f6);
    color: var(--text-secondary, #4b5563);
  }
  .shared-facts-table .mono {
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
  }
  .shared-facts-table .path {
    color: var(--accent, #2563eb);
  }
  .shared-facts-table .value {
    max-width: 360px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .av-switch {
    display: flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    font-family: inherit;
  }
  .av-switch:disabled {
    cursor: wait;
    opacity: 0.6;
  }
  .av-track {
    position: relative;
    display: inline-block;
    width: 34px;
    height: 18px;
    border-radius: 9px;
    background: var(--border, #d1d5db);
    transition: background 0.15s ease;
    flex-shrink: 0;
  }
  .av-switch.on .av-track {
    background: var(--success, #10b981);
  }
  .av-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: white;
    transition: transform 0.15s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }
  .av-switch.on .av-knob {
    transform: translateX(16px);
  }
  .av-text {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary, #6b7280);
    white-space: nowrap;
  }
  .av-switch.on .av-text {
    color: var(--success, #059669);
  }
  .export-btn {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 5px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card);
    color: var(--text-secondary, #4b5563);
    cursor: pointer;
    font-family: inherit;
    font-weight: 600;
    white-space: nowrap;
  }
  .export-btn:hover:not(:disabled) {
    background: var(--bg-page, #f9fafb);
  }
  .export-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* === UV-062 W2 接线4:因果深度显示条 === */
  .causal-depth-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--bg-card);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 6px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .cd-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary, #4b5563);
    white-space: nowrap;
  }
  .cd-value {
    font-family: var(--font-mono, monospace);
    font-size: 14px;
    font-weight: 700;
    color: var(--brand, #7c3aed);
    background: var(--info-bg, #f5f3ff);
    padding: 0 8px;
    border-radius: 4px;
  }
  .cd-refresh {
    margin-left: auto;
    background: transparent;
    border: 1px solid var(--border, #d1d5db);
    border-radius: 4px;
    padding: 1px 7px;
    font-size: 11px;
    cursor: pointer;
    color: var(--text-secondary, #6b7280);
  }
  .cd-refresh:hover {
    background: var(--bg-page, #f9fafb);
  }

  @media (max-width: 1024px) {
    .main-area {
      grid-template-columns: 1fr;
    }
  }
</style>
