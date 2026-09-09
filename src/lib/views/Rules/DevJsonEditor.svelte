<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:规则库开发者模式 JSON 编辑器(首次体验反馈落地:开发者模式不可用)。
    - 左侧规则列表(技术 id + 中文描述),点击选中(懒加载 content)
    - 右侧 JSON 编辑区 + 校验(复用 RuleValidator G1-G7,错误通俗化)+ 保存
    - 只读规则(内置)不可保存,给出提示
  关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §9.2(开发者模式入口)
-->

<script lang="ts">
  import {
    RuleValidator,
    friendlyRuleError,
    isRuleReadonly,
    updateRule,
    currentWorkspace,
    type Rule,
    type WorkspaceBackend,
  } from "$lib/kernel";
  import { get } from "svelte/store";
  import { toastSuccess, toastError, toastWarning } from "$lib/stores/toast";

  let {
    rules,
    wb,
    selectedRuleId,
    onSelect,
  }: {
    rules: Rule[];
    wb: WorkspaceBackend;
    selectedRuleId: string | null;
    onSelect: (ruleId: string) => Promise<void>;
  } = $props();

  // === 编辑区状态 ===
  let editContent = $state("");
  let validation = $state<{ valid: boolean; errors: string[] } | null>(null);
  let saving = $state(false);

  const selected = $derived(
    selectedRuleId ? rules.find((r) => r.id === selectedRuleId) ?? null : null,
  );

  // 选中规则变化时同步编辑内容(content 懒加载,就绪后填充)
  $effect(() => {
    if (selected?.content !== undefined) {
      editContent = selected.content;
      validation = null;
    } else if (selected) {
      // content 尚未加载:置空,等 onSelect 的懒加载完成后再填充
      editContent = "";
      validation = null;
    }
  });

  function handleValidate(): void {
    const v = RuleValidator.validate(editContent);
    validation = { valid: v.valid, errors: v.errors.map((e) => e.message) };
  }

  async function handleSave(): Promise<void> {
    if (!selected) return;
    const v = RuleValidator.validate(editContent);
    validation = { valid: v.valid, errors: v.errors.map((e) => e.message) };
    if (!v.valid) {
      toastError("规则未通过校验,无法保存", "开发者模式");
      return;
    }
    if (isRuleReadonly(selected)) {
      toastWarning("内置规则为只读,不可直接修改;可先复制为新副本", "开发者模式");
      return;
    }
    const ws = get(currentWorkspace);
    if (!ws) {
      toastError("当前没有 workspace,无法保存", "开发者模式");
      return;
    }
    saving = true;
    try {
      await updateRule(wb, ws.id, selected.id, { content: editContent });
      toastSuccess("规则内容已保存", "开发者模式");
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e), "保存失败");
    } finally {
      saving = false;
    }
  }
</script>

<div class="dev-editor">
  <aside class="dev-list">
    <div class="dev-list-head">规则列表({rules.length})</div>
    {#each rules as rule (rule.id)}
      <button
        type="button"
        class="dev-rule-item"
        class:selected={selectedRuleId === rule.id}
        onclick={() => onSelect(rule.id)}
      >
        <div class="dev-rule-name">{rule.description || rule.name}</div>
        <div class="dev-rule-id">{rule.name}</div>
        <div class="dev-rule-meta">
          {isRuleReadonly(rule) ? "内置" : "用户"} · v{rule.version ?? 1}
        </div>
      </button>
    {:else}
      <p class="dev-empty">暂无规则,请先通过建库向导创建。</p>
    {/each}
  </aside>

  <main class="dev-main">
    {#if !selected}
      <div class="dev-hint">👈 从左侧选择规则进行 JSON 编辑</div>
    {:else}
      <header class="dev-main-head">
        <div>
          <div class="dev-title">{selected.description || selected.name}</div>
          <div class="dev-sub">{selected.name}</div>
        </div>
        <div class="dev-actions">
          <button class="btn" onclick={handleValidate}>校验</button>
          <button
            class="btn btn-primary"
            onclick={handleSave}
            disabled={saving || isRuleReadonly(selected)}
            title={isRuleReadonly(selected)
              ? "内置规则只读,请复制为新副本后再编辑"
              : "保存到当前 workspace"}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </header>

      {#if isRuleReadonly(selected)}
        <p class="dev-readonly-note">⚠️ 内置规则为只读,需先复制为新副本后才能编辑。</p>
      {/if}

      <textarea
        class="dev-textarea"
        bind:value={editContent}
        spellcheck="false"
        autocomplete="off"
        aria-label="规则 JSON 内容"
      ></textarea>

      {#if validation}
        <div class="dev-validation" class:ok={validation.valid} class:bad={!validation.valid}>
          {#if validation.valid}
            ✅ 校验通过(结构合法,可保存)
          {:else}
            ❌ 校验失败:
            <ul>
              {#each validation.errors as err}
                <li>{friendlyRuleError(err)}</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    {/if}
  </main>
</div>

<style>
  .dev-editor {
    flex: 1;
    display: grid;
    grid-template-columns: 280px 1fr;
    min-height: 0;
  }
  .dev-list {
    border-right: 1px solid var(--border, #e2e8f0);
    overflow-y: auto;
    background: var(--bg-card);
  }
  .dev-list-head {
    padding: 8px 12px;
    font-size: 11px;
    color: var(--text-secondary, #64748b);
    font-weight: 600;
    text-transform: uppercase;
    border-bottom: 1px solid var(--border, #e2e8f0);
    position: sticky;
    top: 0;
    background: var(--bg-page, #f8fafc);
    z-index: 1;
  }
  .dev-rule-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 10px 12px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--bg-hover, #f1f5f9);
    cursor: pointer;
  }
  .dev-rule-item:hover {
    background: var(--bg-page, #f8fafc);
  }
  .dev-rule-item.selected {
    background: var(--info-bg, #eef2ff);
    border-left: 3px solid var(--brand, #2563eb);
    padding-left: 9px;
  }
  .dev-rule-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #1e293b);
    line-height: 1.4;
  }
  .dev-rule-id {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-secondary, #64748b);
    margin-top: 2px;
  }
  .dev-rule-meta {
    font-size: 10px;
    color: var(--text-secondary, #64748b);
    margin-top: 4px;
  }
  .dev-empty {
    padding: 16px;
    font-size: 12px;
    color: var(--text-secondary, #64748b);
  }

  .dev-main {
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .dev-main-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    flex-wrap: wrap;
  }
  .dev-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary, #1e293b);
  }
  .dev-sub {
    font-family: monospace;
    font-size: 12px;
    color: var(--text-secondary, #64748b);
  }
  .dev-actions {
    display: flex;
    gap: 8px;
  }
  .dev-readonly-note {
    margin: 0;
    padding: 8px 12px;
    background: var(--warning-bg, #fef3c7);
    border: 1px solid var(--warning, #f59e0b);
    border-radius: 6px;
    font-size: 12px;
    color: var(--warning, #92400e);
  }
  .dev-textarea {
    width: 100%;
    min-height: 320px;
    padding: 12px;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    line-height: 1.6;
    background: var(--bg-card);
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 6px;
    color: var(--text-primary, #1e293b);
    resize: vertical;
  }
  .dev-textarea:focus {
    outline: none;
    border-color: var(--brand, #2563eb);
  }
  .dev-validation {
    padding: 10px 12px;
    border-radius: 6px;
    font-size: 13px;
  }
  .dev-validation.ok {
    background: var(--success-bg, #dcfce7);
    color: var(--success, #166534);
  }
  .dev-validation.bad {
    background: var(--danger-bg, #fee2e2);
    color: var(--danger, #991b1b);
  }
  .dev-validation ul {
    margin: 4px 0 0 16px;
    padding: 0;
  }
  .dev-hint {
    padding: 40px;
    text-align: center;
    color: var(--text-secondary, #64748b);
    font-size: 14px;
  }
  .btn {
    padding: 6px 14px;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 4px;
    background: var(--bg-card);
    cursor: pointer;
    font-size: 13px;
  }
  .btn-primary {
    background: var(--brand, #2563eb);
    color: white;
    border-color: var(--brand, #2563eb);
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
