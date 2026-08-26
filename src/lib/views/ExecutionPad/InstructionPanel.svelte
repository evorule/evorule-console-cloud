<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:指令层面板(中间区域:LLM 翻译状态 + instruction JSON 预览/编辑)
    - 翻译状态:idle/translating/translated/error
    - [翻译]按钮:调 translateEvent(LLM)
    - 预览模式:只读 JSON
    - 开发者模式:可直接编辑 instruction JSON
  关联设计:P04_BUSINESS_EXECUTION_PAD_DESIGN.md §5.2(指令层) + §7.2(LLM 翻译流)
-->

<script lang="ts">
  import type { TranslateStatus } from "$lib/stores/business-event";

  interface Props {
    instruction: object | null;
    translateStatus: TranslateStatus;
    translateError: string | null;
    /** 是否开发者模式(可直接编辑 instruction) */
    developerMode?: boolean;
    /** 编辑 instruction JSON 内容(开发者模式) */
    onEditInstructionJson?: (jsonText: string) => void;
    /** 触发 LLM 翻译 */
    onTranslate: () => void;
    /** 是否禁用翻译按钮 */
    canTranslate?: boolean;
  }

  let {
    instruction,
    translateStatus,
    translateError,
    developerMode = false,
    onEditInstructionJson,
    onTranslate,
    canTranslate = true,
  }: Props = $props();

  let editableJson = $state("");
  let parseError = $state<string | null>(null);

  // 当 instruction 变化时,同步到编辑框(若未在编辑中)
  $effect(() => {
    if (instruction) {
      editableJson = JSON.stringify(instruction, null, 2);
      parseError = null;
    } else {
      editableJson = "";
      parseError = null;
    }
  });

  function handleJsonInput(e: Event): void {
    const el = e.currentTarget as HTMLTextAreaElement;
    editableJson = el.value;
    try {
      if (editableJson.trim()) {
        JSON.parse(editableJson);
        parseError = null;
        onEditInstructionJson?.(editableJson);
      } else {
        parseError = null;
      }
    } catch (err) {
      parseError = err instanceof Error ? err.message : "JSON 解析失败";
    }
  }

  const statusInfo = $derived.by<{ text: string; cls: string; icon: string }>(
    () => {
      switch (translateStatus) {
        case "idle":
          return { text: "未翻译", cls: "status-idle", icon: "⏸" };
        case "translating":
          return { text: "翻译中...", cls: "status-translating", icon: "⏳" };
        case "translated":
          return { text: "已翻译", cls: "status-translated", icon: "✅" };
        case "error":
          return { text: "翻译失败", cls: "status-error", icon: "❌" };
        default:
          return { text: "未知", cls: "status-idle", icon: "❓" };
      }
    },
  );
</script>

<div class="instruction-panel">
  <header class="panel-header">
    <h3 class="panel-title">🧠 指令层(instruction JSON)</h3>
    <div class="header-right">
      <span class={`status-chip ${statusInfo.cls}`}>
        <span class="status-icon">{statusInfo.icon}</span>
        <span class="status-text">{statusInfo.text}</span>
      </span>
      {#if developerMode}
        <span class="dev-badge">DEV</span>
      {/if}
    </div>
  </header>

  <div class="translate-row">
    <button
      type="button"
      class="btn btn-primary btn-translate"
      onclick={onTranslate}
      disabled={!canTranslate || translateStatus === "translating"}
    >
      {translateStatus === "translating" ? "⏳ 翻译中..." : "🔮 翻译为指令"}
    </button>
    <span class="translate-hint">
      {canTranslate
        ? "用 LLM 将业务表单翻译为内核指令"
        : "请先填写表单并选择模板"}
    </span>
  </div>

  {#if translateError}
    <div class="error-banner">
      ❌ {translateError}
    </div>
  {/if}

  {#if !instruction && translateStatus === "idle"}
    <div class="empty-hint">
      <div class="empty-icon">📝</div>
      <p>尚未生成指令 JSON</p>
      <p class="hint-sub">
        填写左侧表单后点击"翻译为指令",或在开发者模式下直接编辑。
      </p>
    </div>
  {:else}
    <div class="json-container" class:has-error={!!parseError}>
      {#if developerMode}
        <textarea
          class="json-textarea"
          rows={14}
          spellcheck={false}
          bind:value={editableJson}
          oninput={handleJsonInput}
          placeholder={'{"domain": "medical", "action": "...", "payload": {...}}'}
        ></textarea>
      {:else}
        <pre class="json-preview">
{instruction ? JSON.stringify(instruction, null, 2) : "// 无数据"}</pre>
      {/if}
    </div>
    {#if parseError}
      <div class="parse-error">⚠ JSON 语法错误:{parseError}</div>
    {/if}
  {/if}
</div>

<style>
  .instruction-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    background: var(--bg-card);
    border: 1px solid var(--color-gray-200, #e2e8f0);
    border-radius: 8px;
    height: 100%;
    overflow-y: auto;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .panel-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary, #1e293b);
  }
  .header-right {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .status-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }
  .status-icon {
    font-size: 10px;
  }
  .status-idle {
    background: var(--color-gray-100, #f1f5f9);
    color: var(--color-gray-600, #475569);
  }
  .status-translating {
    background: var(--color-info-bg, #dbeafe);
    color: var(--color-info, #1e40af);
  }
  .status-translated {
    background: var(--color-success-bg, #d1fae5);
    color: var(--color-success, #065f46);
  }
  .status-error {
    background: var(--color-error-bg, #fee2e2);
    color: var(--color-error, #991b1b);
  }
  .dev-badge {
    background: var(--brand, #7c3aed);
    color: white;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .translate-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .btn {
    font-size: 13px;
    padding: 6px 12px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 4px;
    background: var(--bg-card);
    cursor: pointer;
    font-family: inherit;
  }
  .btn-primary {
    background: var(--color-primary, #2563eb);
    border-color: var(--color-primary, #2563eb);
    color: white;
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-translate {
    font-weight: 600;
  }
  .translate-hint {
    font-size: 11px;
    color: var(--color-text-secondary, #64748b);
  }
  .error-banner {
    padding: 8px 10px;
    background: var(--color-error-bg, #fef2f2);
    color: var(--color-error, #dc2626);
    border-radius: 4px;
    font-size: 12px;
  }
  .empty-hint {
    padding: 32px 16px;
    text-align: center;
    color: var(--color-text-secondary, #64748b);
    border: 1px dashed var(--color-gray-300, #cbd5e1);
    border-radius: 6px;
    background: var(--color-gray-50, #f8fafc);
  }
  .empty-icon {
    font-size: 28px;
    margin-bottom: 8px;
  }
  .empty-hint p {
    margin: 4px 0;
    font-size: 13px;
  }
  .hint-sub {
    font-size: 11px;
    opacity: 0.8;
  }
  .json-container {
    border: 1px solid var(--color-gray-200, #e2e8f0);
    border-radius: 6px;
    overflow: hidden;
    flex: 1;
    min-height: 200px;
  }
  .json-container.has-error {
    border-color: var(--color-error, #dc2626);
  }
  .json-preview {
    margin: 0;
    padding: 10px;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    line-height: 1.5;
    background: #0f172a;
    color: #e2e8f0;
    overflow-x: auto;
    white-space: pre;
    max-height: 340px;
    overflow-y: auto;
  }
  .json-textarea {
    width: 100%;
    height: 100%;
    min-height: 280px;
    padding: 10px;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    line-height: 1.5;
    background: #0f172a;
    color: #e2e8f0;
    border: none;
    outline: none;
    resize: vertical;
    box-sizing: border-box;
  }
  .parse-error {
    font-size: 11px;
    color: var(--color-error, #dc2626);
    padding: 4px 6px;
  }
</style>
