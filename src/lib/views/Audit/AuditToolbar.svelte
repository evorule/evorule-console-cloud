<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:业务审计工具栏(P06 §6.2)
    - 验证 BLAKE3 链按钮(触发 verifyAudit)
    - 导出审计按钮(触发 ExportDialog,预选 audit_chain)
    - 导入审计按钮(文件选择,触发 importAudit)
    - 决策建议按钮(需选中范围 + LLM 已配置)
    - LLM 因果总结按钮(需选中 fact + LLM 已配置)
    - 模式 toggle:业务 / 开发者
  状态:
    - verifying:正在验证
    - analyzing:LLM 分析中
  关联设计:P06_BUSINESS_AUDIT_TT_DESIGN.md §6.2 + §7.2 + §7.3 + §7.4
-->

<script lang="ts">
  interface Props {
    mode: "business" | "developer";
    verifying?: boolean;
    analyzing?: boolean;
    hasSelection?: boolean;
    hasCausal?: boolean;
    llmConfigured?: boolean;
    onToggleMode?: () => void;
    onVerify?: () => void;
    onExport?: () => void;
    onImportFile?: (file: File) => void;
    onDecisionSupport?: () => void;
    onCausalSummary?: () => void;
  }

  let {
    mode,
    verifying = false,
    analyzing = false,
    hasSelection = false,
    hasCausal = false,
    llmConfigured = false,
    onToggleMode,
    onVerify,
    onExport,
    onImportFile,
    onDecisionSupport,
    onCausalSummary,
  }: Props = $props();

  // 隐藏的文件输入(导入用)
  let fileInput: HTMLInputElement | null = $state(null);

  function handleImportClick(): void {
    fileInput?.click();
  }

  function handleFileChange(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    if (input.files && input.files[0]) {
      onImportFile?.(input.files[0]);
    }
    // 重置 input value 允许重复选择同一文件
    input.value = "";
  }
</script>

<div class="audit-toolbar">
  <div class="toolbar-group">
    <button
      class="tb-btn primary"
      onclick={onVerify}
      disabled={verifying}
      title="验证 BLAKE3 哈希链完整性"
    >
      {verifying ? "⏳ 验证中…" : "✅ 验证 BLAKE3 链"}
    </button>

    <button
      class="tb-btn secondary"
      onclick={onExport}
      title="导出审计链(多格式)"
    >
      📥 导出审计
    </button>

    <button
      class="tb-btn secondary"
      onclick={handleImportClick}
      title="导入审计链(验证 BLAKE3 完整性)"
    >
      📤 导入审计
    </button>

    <input
      bind:this={fileInput}
      type="file"
      accept=".json,.json.gz,application/json,application/gzip"
      onchange={handleFileChange}
      style="display:none"
      aria-hidden="true"
    />
  </div>

  <div class="toolbar-group">
    <button
      class="tb-btn llm"
      onclick={onDecisionSupport}
      disabled={!llmConfigured || analyzing || !hasSelection}
      title={!llmConfigured
        ? "请先在设置中配置 LLM"
        : !hasSelection
          ? "请先在审计时间线选中一段(Shift+Click)"
          : "LLM 分析选中的审计段"}
    >
      {analyzing ? "🤖 分析中…" : "💡 决策建议"}
    </button>

    <button
      class="tb-btn llm"
      onclick={onCausalSummary}
      disabled={!llmConfigured || !hasCausal}
      title={!llmConfigured
        ? "请先在设置中配置 LLM"
        : !hasCausal
          ? "请先选中一条 Fact 查看因果链"
          : "LLM 总结当前因果链"}
    >
      🧠 因果总结
    </button>
  </div>

  <div class="toolbar-group mode-toggle">
    <span class="mode-label">模式:</span>
    <button
      class="tb-btn mode-btn"
      class:active={mode === "business"}
      onclick={onToggleMode}
    >
      {mode === "business" ? "✓ 业务" : "业务"}
    </button>
    <button
      class="tb-btn mode-btn"
      class:active={mode === "developer"}
      onclick={onToggleMode}
    >
      {mode === "developer" ? "✓ 开发者" : "开发者"}
    </button>
  </div>
</div>

<style>
  .audit-toolbar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 12px;
    background: var(--bg-card);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    flex-wrap: wrap;
  }
  .toolbar-group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .toolbar-group.mode-toggle {
    margin-left: auto;
  }
  .mode-label {
    font-size: 11px;
    color: var(--text-secondary, #4b5563);
  }
  .tb-btn {
    font-size: 12px;
    padding: 5px 10px;
    border-radius: 5px;
    border: 1px solid;
    cursor: pointer;
    font-family: inherit;
    font-weight: 600;
    transition: all 0.12s ease;
    white-space: nowrap;
  }
  .tb-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .tb-btn.primary {
    background: var(--brand, #2563eb);
    border-color: var(--brand, #2563eb);
    color: white;
  }
  .tb-btn.primary:hover:not(:disabled) {
    background: var(--brand, #1d4ed8);
  }
  .tb-btn.secondary {
    background: var(--bg-card);
    border-color: var(--border, #d1d5db);
    color: var(--text-secondary, #4b5563);
  }
  .tb-btn.secondary:hover:not(:disabled) {
    background: var(--bg-page, #f9fafb);
  }
  .tb-btn.llm {
    background: var(--warning-bg, #fef3c7);
    border-color: var(--warning, #fde68a);
    color: var(--warning, #92400e);
  }
  .tb-btn.llm:hover:not(:disabled) {
    background: var(--warning, #fde68a);
  }
  .tb-btn.mode-btn {
    background: var(--bg-card);
    border-color: var(--border, #d1d5db);
    color: var(--text-secondary, #4b5563);
    padding: 5px 8px;
    font-size: 11px;
  }
  .tb-btn.mode-btn.active {
    background: var(--brand, #2563eb);
    border-color: var(--brand, #2563eb);
    color: white;
  }
</style>
