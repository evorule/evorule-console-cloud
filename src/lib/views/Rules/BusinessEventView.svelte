<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:业务事件工作台（孤儿域接线批:business-event 三件套此前全库零 UI 消费）
    业务工作流:选模板 → 填业务表单 → LLM 翻译为指令 → 影响预览 → 试提交
  集成点:
    - LLM:useAssistantOrNull(大众版注入;未配置引导去 LLM 设置)
    - 执行:useBackend + createSession 临时试验会话(与向导试跑同款范式)
    - 影响预览:impact-preview 派生 store(指令 × 规则库匹配)
  语义红线:翻译产物是草稿指令,提交走既有命令链(审计链自证)
-->

<script lang="ts">
  import {
    businessEventStore,
    currentEventId,
    createEventFromTemplate,
    updateFormData,
    updateEventName,
    translateEvent,
    submitEvent,
    getEvent,
    type BusinessEvent,
  } from "$lib/stores/business-event";
  import {
    BUILTIN_TEMPLATES,
    getTemplate,
  } from "$lib/stores/business-event-templates";
  import { impactPreview } from "$lib/stores/impact-preview";
  import { useBackend } from "$lib/kernel";
  import { createSession } from "$lib/kernel";
  import {
    useAssistantOrNull,
  } from "$lib/kernel/assistant/assistant-context";
  import type { LlmAssistant } from "$lib/assistant/types";
  import { CloudLlmAssistant } from "$lib/assistant/cloud-llm-assistant";
  import {
    toastSuccess,
    toastError,
    toastInfo,
  } from "$lib/stores/toast";
  import { get } from "svelte/store";

  const backend = useBackend();
  // 大众版层收窄（与 TranspileCommandDialog 同款;isConfigured 为大众版独有）
  const assistant = useAssistantOrNull() as LlmAssistant | CloudLlmAssistant | null;

  const events = $derived($businessEventStore);
  const currentId = $derived($currentEventId);
  const current = $derived(currentId ? (getEvent(currentId) ?? null) : null);
  const preview = $derived($impactPreview);
  const templateOf = $derived(current ? getTemplate(current.templateId) : null);

  let translating = $state(false);
  let submitting = $state(false);

  const llmReady = $derived(
    !!assistant &&
      typeof (assistant as LlmAssistant).isConfigured === "function" &&
      (assistant as LlmAssistant).isConfigured(),
  );

  function selectEvent(id: string): void {
    currentEventId.set(id);
  }

  function handleCreate(templateId: string): void {
    try {
      const id = createEventFromTemplate(templateId);
      currentEventId.set(id);
      const tpl = getTemplate(templateId);
      toastSuccess(`事件已创建（模板:${tpl?.name ?? templateId}）`);
    } catch (e) {
      toastError((e as Error).message);
    }
  }

  function handleNameInput(e: Event): void {
    if (!currentId) return;
    updateEventName(currentId, (e.currentTarget as HTMLInputElement).value);
  }

  function handleFieldInput(name: string, e: Event): void {
    if (!currentId) return;
    const el = e.currentTarget as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const value =
      el instanceof HTMLInputElement && el.type === "checkbox"
        ? el.checked
        : el.value;
    updateFormData(currentId, { [name]: value });
  }

  function fieldValue(event: BusinessEvent, name: string, fallback: unknown): unknown {
    return event.formData[name] ?? fallback;
  }

  async function handleTranslate(): Promise<void> {
    if (!currentId || translating) return;
    if (!assistant || !llmReady) {
      toastInfo("请先在「设置 → LLM」配置模型后再翻译");
      return;
    }
    translating = true;
    try {
      await translateEvent(currentId, assistant);
      toastSuccess("已翻译为指令草稿（可查看影响预览后提交）");
    } catch (e) {
      toastError(`翻译失败: ${(e as Error).message}`);
    } finally {
      translating = false;
    }
  }

  async function handleSubmit(): Promise<void>
  {
    if (!currentId || submitting) return;
    const event = getEvent(currentId);
    if (!event?.instruction) {
      toastError("尚未翻译为指令,无法提交");
      return;
    }
    submitting = true;
    try {
      const sessionId = await createSession(backend);
      if (sessionId === null) {
        toastError("无法创建试验会话(服务不可用?),提交中止");
        return;
      }
      const result = await submitEvent(currentId, sessionId, backend);
      if (result.accepted) {
        toastSuccess(
          `事件已提交并在试验会话 #${sessionId} 执行(版本 v${result.version ?? "?"})`,
        );
      } else {
        toastError(`提交被拒绝: ${result.error ?? "未知原因"}`);
      }
    } catch (e) {
      toastError(`提交失败: ${(e as Error).message}`);
    } finally {
      submitting = false;
    }
  }

  function fieldInputType(t: string): string {
    return t === "textarea" ? "" : t === "date" ? "date" : t === "number" ? "number" : "text";
  }
</script>

<div class="bev" aria-label="业务事件工作台">
  <!-- 左栏:事件列表 + 模板新建 -->
  <aside class="bev-side">
    <section class="bev-sec">
      <h3 class="bev-sec-title">业务事件</h3>
      {#if events.length === 0}
        <p class="bev-hint">从下方模板创建第一个业务事件。</p>
      {:else}
        <ul class="bev-events">
          {#each events as ev (ev.id)}
            <li>
              <button
                type="button"
                class="bev-ev-btn"
                class:active={ev.id === currentId}
                onclick={() => selectEvent(ev.id)}
              >
                <span>{getTemplate(ev.templateId)?.icon ?? "📄"} {ev.name}</span>
                <span class="bev-ev-status">
                  {ev.translateStatus === "translated"
                    ? "已翻译"
                    : ev.translateStatus === "error"
                      ? "翻译失败"
                      : ev.translateStatus === "translating"
                        ? "翻译中"
                        : "草稿"}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="bev-sec">
      <h3 class="bev-sec-title">从模板新建</h3>
      <div class="bev-tpl-grid">
        {#each BUILTIN_TEMPLATES as tpl (tpl.id)}
          <button
            type="button"
            class="bev-tpl-btn"
            title={tpl.description}
            onclick={() => handleCreate(tpl.id)}
          >
            <span class="bev-tpl-icon">{tpl.icon}</span>
            <span class="bev-tpl-name">{tpl.name}</span>
            <span class="bev-tpl-ind">{tpl.industry}</span>
          </button>
        {/each}
      </div>
    </section>
  </aside>

  <!-- 主区:当前事件编辑 -->
  <section class="bev-main">
    {#if !current}
      <div class="bev-empty">
        <p>选择左侧事件,或从模板新建一个业务事件。</p>
        <p class="bev-hint">
          工作流:填业务表单 → LLM 翻译为指令草稿 → 影响预览 → 提交试验会话。
        </p>
      </div>
    {:else}
      <header class="bev-head">
        <input
          class="bev-name"
          value={current.name}
          oninput={handleNameInput}
          aria-label="事件名称"
        />
        <span class="bev-tpl-tag">{templateOf?.name}</span>
      </header>

      <!-- 动态表单 -->
      <section class="bev-sec">
        <h3 class="bev-sec-title">业务表单</h3>
        <div class="bev-form">
          {#each templateOf?.formSchema ?? [] as f (f.name)}
            <label class="bev-field">
              <span class="bev-field-label">
                {f.label}{f.required ? " *" : ""}
                {#if f.termHint}<em class="bev-term-hint">（{f.termHint}）</em>{/if}
              </span>
              {#if f.type === "textarea"}
                <textarea
                  rows="3"
                  value={String(fieldValue(current, f.name, f.defaultValue ?? ""))}
                  oninput={(e) => handleFieldInput(f.name, e)}
                ></textarea>
              {:else if f.type === "select"}
                <select
                  onchange={(e) => handleFieldInput(f.name, e)}
                  value={String(fieldValue(current, f.name, f.defaultValue ?? ""))}
                >
                  {#each f.options ?? [] as opt (opt.value)}
                    <option value={opt.value}>{opt.label}</option>
                  {/each}
                </select>
              {:else if f.type === "checkbox"}
                <input
                  type="checkbox"
                  checked={!!fieldValue(current, f.name, f.defaultValue ?? false)}
                  onchange={(e) => handleFieldInput(f.name, e)}
                />
              {:else}
                <input
                  type={fieldInputType(f.type)}
                  value={String(fieldValue(current, f.name, f.defaultValue ?? ""))}
                  oninput={(e) => handleFieldInput(f.name, e)}
                  required={f.required}
                  min={f.validate?.min}
                  max={f.validate?.max}
                />
              {/if}
            </label>
          {/each}
        </div>
      </section>

      <!-- 翻译 + 影响预览 + 提交 -->
      <section class="bev-sec">
        <h3 class="bev-sec-title">翻译与提交</h3>
        <div class="bev-actions">
          <button
            type="button"
            class="bev-btn primary"
            disabled={translating || !llmReady}
            title={llmReady ? "调 LLM 将表单翻译为指令草稿" : "请先在设置中配置 LLM"}
            onclick={handleTranslate}
          >
            {translating ? "翻译中…" : "🪄 翻译为指令草稿"}
          </button>
          <button
            type="button"
            class="bev-btn success"
            disabled={submitting || current.translateStatus !== "translated"}
            title={current.translateStatus === "translated" ? "创建试验会话并提交执行" : "需先翻译"}
            onclick={handleSubmit}
          >
            {submitting ? "提交中…" : "🚀 提交试验会话"}
          </button>
        </div>
        {#if current.translateError}
          <p class="bev-err">翻译失败: {current.translateError}</p>
        {/if}

        {#if current.instruction}
          <details class="bev-instr" open>
            <summary>指令草稿（LLM 产物,可审计）</summary>
            <pre class="bev-json">{JSON.stringify(current.instruction, null, 2)}</pre>
          </details>
        {/if}

        {#if preview}
          <div class="bev-impact">
            <h4 class="bev-impact-title">
              影响预览:命中 {preview.matchedCount} / 不命中 {preview.unmatchedCount}
              （置信度 {preview.confidence}）
            </h4>
            <ul class="bev-impact-list">
              {#each preview.matches as m (m.ruleId)}
                <li class:hit={m.matched}>
                  <span class="bev-impact-name">{m.ruleId}</span>
                  <span class="bev-impact-verdict">
                    {m.matched
                      ? `命中字段: ${m.matchedFields.join(", ") || "(根级)"} · 预计 ${m.expectedFactType}`
                      : "不命中"}
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if current.lastResult}
          <p class="bev-result" class:ok={current.lastResult.accepted}>
            上次提交:{current.lastResult.accepted
              ? `已接受(版本 v${current.lastResult.version ?? "?"})`
              : `被拒绝(${current.lastResult.error ?? "未知"})`}
          </p>
        {/if}
      </section>
    {/if}
  </section>
</div>

<style>
  .bev {
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: 12px;
    min-height: 0;
  }
  .bev-side {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .bev-sec {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bev-sec-title {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
    color: var(--text-secondary, #4b5563);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .bev-hint {
    font-size: 11px;
    color: var(--text-secondary, #6b7280);
  }
  .bev-events {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .bev-ev-btn {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    padding: 5px 8px;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 6px;
    background: var(--bg-card, #fff);
    color: var(--text-primary, #111827);
    cursor: pointer;
    text-align: left;
  }
  .bev-ev-btn.active {
    border-color: var(--brand, #2563eb);
    background: var(--info-bg, #eff6ff);
  }
  .bev-ev-status {
    font-size: 10px;
    color: var(--text-secondary, #6b7280);
    white-space: nowrap;
  }
  .bev-tpl-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .bev-tpl-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    font-size: 11px;
    padding: 8px;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    background: var(--bg-card, #fff);
    cursor: pointer;
  }
  .bev-tpl-btn:hover {
    border-color: var(--brand, #2563eb);
  }
  .bev-tpl-icon {
    font-size: 16px;
  }
  .bev-tpl-name {
    font-weight: 600;
    color: var(--text-primary, #111827);
  }
  .bev-tpl-ind {
    font-size: 10px;
    color: var(--text-secondary, #6b7280);
  }
  .bev-main {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    overflow-y: auto;
  }
  .bev-empty {
    padding: 40px 20px;
    text-align: center;
    font-size: 13px;
    color: var(--text-secondary, #6b7280);
    border: 1px dashed var(--border, #e5e7eb);
    border-radius: 10px;
  }
  .bev-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .bev-name {
    font-size: 15px;
    font-weight: 700;
    padding: 6px 10px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--text-primary, #111827);
    flex: 1;
    min-width: 0;
  }
  .bev-name:hover,
  .bev-name:focus {
    border-color: var(--border, #d1d5db);
    background: var(--bg-card, #fff);
    outline: none;
  }
  .bev-tpl-tag {
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 999px;
    background: var(--info-bg, #eff6ff);
    color: var(--info, #1e40af);
    white-space: nowrap;
  }
  .bev-form {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
  }
  .bev-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 11px;
    color: var(--text-secondary, #4b5563);
  }
  .bev-field input,
  .bev-field select,
  .bev-field textarea {
    font-size: 12px;
    padding: 6px 8px;
    border: 1px solid var(--border, #d1d5db);
    border-radius: 5px;
    font-family: inherit;
    background: var(--bg-card, #fff);
    color: var(--text-primary, #111827);
  }
  .bev-term-hint {
    font-style: normal;
    color: var(--text-secondary, #9ca3af);
  }
  .bev-actions {
    display: flex;
    gap: 8px;
  }
  .bev-btn {
    font-size: 12px;
    font-weight: 600;
    padding: 7px 14px;
    border-radius: 6px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card, #fff);
    color: var(--text-secondary, #4b5563);
    cursor: pointer;
  }
  .bev-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .bev-btn.primary {
    background: var(--brand, #2563eb);
    border-color: var(--brand, #2563eb);
    color: #fff;
  }
  .bev-btn.success {
    background: var(--success, #10b981);
    border-color: var(--success, #10b981);
    color: #fff;
  }
  .bev-err {
    font-size: 12px;
    color: var(--danger, #dc2626);
    margin: 0;
  }
  .bev-instr {
    font-size: 12px;
  }
  .bev-instr summary {
    cursor: pointer;
    color: var(--text-secondary, #4b5563);
  }
  .bev-json {
    margin: 6px 0 0;
    padding: 10px;
    background: var(--bg-page, #f8fafc);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 6px;
    font-size: 11px;
    overflow: auto;
    max-height: 240px;
  }
  .bev-impact {
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    padding: 8px 10px;
  }
  .bev-impact-title {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 700;
  }
  .bev-impact-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .bev-impact-list li {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 11px;
    padding: 3px 6px;
    border-radius: 4px;
  }
  .bev-impact-list li.hit {
    background: var(--success-bg, #ecfdf5);
  }
  .bev-impact-name {
    font-weight: 600;
  }
  .bev-impact-verdict {
    color: var(--text-secondary, #6b7280);
  }
  .bev-result {
    margin: 0;
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
  }
  .bev-result.ok {
    color: var(--success, #059669);
  }
</style>
