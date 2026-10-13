<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:业务术语管理弹窗（P2-4 接线:addBusinessTerm/updateBusinessTerm/
  deprecateBusinessTerm 此前全库零消费,术语库只读）
  - 列表:行业/key/标签/状态/版本
  - 新建:industry + key + label + 同义词 + 描述
  - 编辑:key 不可改（store 约束:改 key 破坏规则关联）;可改 label/同义词/描述
  - 弃用:标记 status=deprecated（不删除,保留规则关联可溯）
-->

<script lang="ts">
  import {
    businessTermsStore,
    addBusinessTerm,
    updateBusinessTerm,
    deprecateBusinessTerm,
    type BusinessTerm,
  } from "$lib/stores/business-terms";
  import { toastSuccess, toastError } from "$lib/stores/toast";

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const terms = $derived($businessTermsStore);

  // === 编辑器状态 ===
  let editorMode = $state<"none" | "new" | "edit">("none");
  let editId = $state<string | null>(null);
  let fIndustry = $state("finance");
  let fKey = $state("");
  let fLabel = $state("");
  let fSynonyms = $state("");
  let fDescription = $state("");

  const INDUSTRY_OPTIONS = ["finance", "compliance", "medical", "legal", "general"];

  function openNew(): void {
    editorMode = "new";
    editId = null;
    fIndustry = "finance";
    fKey = "";
    fLabel = "";
    fSynonyms = "";
    fDescription = "";
  }

  function openEdit(t: BusinessTerm): void {
    editorMode = "edit";
    editId = t.id;
    fIndustry = t.industry;
    fKey = t.key;
    fLabel = t.label;
    fSynonyms = t.synonyms.join(", ");
    fDescription = t.description;
  }

  function closeEditor(): void {
    editorMode = "none";
    editId = null;
  }

  function parseSynonyms(raw: string): string[] {
    return raw
      .split(/[,，;；]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function handleSubmit(e: SubmitEvent): void {
    e.preventDefault();
    if (!fKey.trim() || !fLabel.trim()) {
      toastError("key 与中文标签必填");
      return;
    }
    try {
      if (editorMode === "new") {
        addBusinessTerm({
          industry: fIndustry,
          key: fKey.trim(),
          label: fLabel.trim(),
          synonyms: parseSynonyms(fSynonyms),
          description: fDescription.trim(),
          status: "active",
        });
        toastSuccess(`术语 ${fIndustry}.${fKey.trim()} 已创建`);
      } else if (editId) {
        updateBusinessTerm(editId, {
          label: fLabel.trim(),
          synonyms: parseSynonyms(fSynonyms),
          description: fDescription.trim(),
        });
        toastSuccess(`术语 ${editId} 已更新`);
      }
      closeEditor();
    } catch (e) {
      toastError((e as Error).message);
    }
  }

  function handleDeprecate(t: BusinessTerm): void {
    if (!window.confirm(`弃用术语 ${t.id}?不删除,规则关联保留可溯。`)) return;
    try {
      deprecateBusinessTerm(t.id);
      toastSuccess(`术语 ${t.id} 已弃用`);
    } catch (e) {
      toastError((e as Error).message);
    }
  }
</script>

<div
  class="tm-overlay"
  role="presentation"
  onclick={(e) => {
    if (e.currentTarget === e.target) onClose();
  }}
>
  <div class="tm-panel" role="dialog" aria-label="术语管理">
    <header class="tm-header">
      <h3 class="tm-title">📚 术语管理</h3>
      <button class="tm-btn" onclick={onClose}>✕ 关闭</button>
    </header>

    <div class="tm-body">
      <ul class="tm-list">
        {#each terms as t (t.id)}
          <li class="tm-row" class:deprecated={t.status === "deprecated"}>
            <span class="tm-id" title={t.id}>{t.id}</span>
            <span class="tm-label">{t.label}</span>
            <span class="tm-status">{t.status}</span>
            <span class="tm-ver">v{t.version}</span>
            <span class="tm-actions">
              {#if t.status !== "deprecated"}
                <button class="tm-btn" onclick={() => openEdit(t)}>编辑</button>
                <button class="tm-btn warn" onclick={() => handleDeprecate(t)}>
                  弃用
                </button>
              {/if}
            </span>
          </li>
        {:else}
          <li class="tm-empty">术语库为空——用下方表单创建第一个术语。</li>
        {/each}
      </ul>

      {#if editorMode !== "none"}
        <form class="tm-form" onsubmit={handleSubmit}>
          <h4 class="tm-form-title">
            {editorMode === "new" ? "新建术语" : `编辑术语 ${editId}`}
          </h4>
          <label class="tm-field">
            <span>行业 *</span>
            <select bind:value={fIndustry} disabled={editorMode === "edit"}>
              {#each INDUSTRY_OPTIONS as ind (ind)}
                <option value={ind}>{ind}</option>
              {/each}
            </select>
          </label>
          <label class="tm-field">
            <span>key（英文字段名）*{editorMode === "edit" ? "（不可改）" : ""}</span>
            <input
              bind:value={fKey}
              disabled={editorMode === "edit"}
              placeholder="如 amount"
              required
            />
          </label>
          <label class="tm-field">
            <span>中文标签 *</span>
            <input bind:value={fLabel} placeholder="如 金额" required />
          </label>
          <label class="tm-field">
            <span>同义词（逗号分隔）</span>
            <input bind:value={fSynonyms} placeholder="如 金额, 数额" />
          </label>
          <label class="tm-field">
            <span>业务解释</span>
            <textarea bind:value={fDescription} rows="2"></textarea>
          </label>
          <div class="tm-form-actions">
            <button type="submit" class="tm-btn primary">
              {editorMode === "new" ? "创建" : "保存"}
            </button>
            <button type="button" class="tm-btn" onclick={closeEditor}>取消</button>
          </div>
        </form>
      {:else}
        <button class="tm-btn primary tm-new" onclick={openNew}>+ 新建术语</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .tm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
  }
  .tm-panel {
    background: var(--bg-card, #fff);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 10px;
    width: min(640px, 92vw);
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    padding: 14px 16px;
    gap: 10px;
  }
  .tm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .tm-title {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
  }
  .tm-body {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tm-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .tm-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 6px;
    font-size: 12px;
  }
  .tm-row.deprecated {
    opacity: 0.55;
  }
  .tm-id {
    font-family: var(--font-mono, monospace);
    font-weight: 600;
  }
  .tm-label {
    color: var(--text-secondary, #4b5563);
  }
  .tm-status {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--bg-page, #f3f4f6);
  }
  .tm-ver {
    color: var(--text-secondary, #6b7280);
    font-size: 10px;
  }
  .tm-actions {
    margin-left: auto;
    display: flex;
    gap: 4px;
  }
  .tm-empty {
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
    padding: 8px 0;
  }
  .tm-btn {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 5px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card, #fff);
    color: var(--text-secondary, #4b5563);
    cursor: pointer;
  }
  .tm-btn.primary {
    border-color: var(--brand, #2563eb);
    background: var(--brand, #2563eb);
    color: #fff;
  }
  .tm-btn.warn {
    border-color: #fdba74;
    color: #9a3412;
  }
  .tm-btn.warn:hover {
    background: #fff7ed;
  }
  .tm-new {
    align-self: flex-start;
  }
  .tm-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px dashed var(--border, #d1d5db);
    border-radius: 8px;
    padding: 10px;
  }
  .tm-form-title {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
  }
  .tm-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 11px;
    color: var(--text-secondary, #4b5563);
  }
  .tm-field input,
  .tm-field select,
  .tm-field textarea {
    font-size: 12px;
    padding: 5px 8px;
    border: 1px solid var(--border, #d1d5db);
    border-radius: 5px;
    font-family: inherit;
  }
  .tm-form-actions {
    display: flex;
    gap: 8px;
  }
</style>
