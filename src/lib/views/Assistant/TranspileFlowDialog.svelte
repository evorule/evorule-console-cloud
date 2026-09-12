<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 EvoRule Project
  evorule-console-cloud — AI 转译流程 Dialog
-->
<!--
  吸收自 evorule-console src/lib/views/Assistant/TranspileFlowDialog.svelte
  (UV-176 P3 激活);import 路径适配 cloud 布局(kernel 镜像区),其余原样。

  职责:自然语言 → flow JSON 草稿 → 填入画布。
  流程:
    1. 用户输入自然语言描述(如"员工提交报销,主管审批后财务打款")
    2. 点"生成流程草稿"调 assistant.transpileFlow(nl, ctx)(内核第 4 方法;
       prompt 由注入方经 prompts.ts SSOT 组装)
    3. 草稿展示 + 展示层校验(validateFlowDraft:parse/形状/node_type 白名单/
       form_ref 取值域——纯提示,不替代引擎 fail-fast)
    4. 用户可编辑,点"填入画布"回调 onfill(解析后的 flow 对象)
    5. 页面经 loadFlowAsset 投影到画布态——人可继续拖动/改属性,人点击
       编译才走既有链(draft-only,R3);LLM 永不直接 compile/publish

  填入前提:parseOk(画布只吃对象);形状/白名单/取值域问题仅提示不阻断
  (人工修正路径始终开放,引擎编译校验兜底)。
-->

<script lang="ts">
  import { useAssistantOrNull } from "$lib/kernel";
  import {
    validateFlowDraft,
    type FlowDraftCheckContext,
  } from "$lib/kernel/views/FlowCanvas/flow-model";
  import type { FlowTranspileContext } from "$lib/kernel";
  import { t } from "$lib/locale";

  let {
    context,
    onfill,
    onclose,
  }: {
    context: FlowTranspileContext;
    onfill: (flow: object) => void;
    onclose: () => void;
  } = $props();

  const assistant = useAssistantOrNull();

  let description = $state("");
  let draftJson = $state("");
  let isLoading = $state(false);
  let errorMsg = $state<string | null>(null);
  // 多轮修订(UV-178 批次D):每轮(用户原文, LLM 回复原文);纯文本对,
  // 由实现方拼入对话消息。用户驱动的连续修订(每轮人点击),非 agent 编排。
  let turns = $state<Array<{ user: string; reply: string }>>([]);

  // 展示层校验（随草稿编辑实时重算;纯派生,不改产物）
  const checkCtx = $derived.by((): FlowDraftCheckContext => ({
    nodeTypes: new Set(context.nodeTypes.map((t) => t.node_type)),
    sceneFieldIds: new Set(context.sceneFields.map((f) => f.field_id)),
    // guard 取值域（契约 v1.2 out_guards 声明投影;全部来自资产,缺省跳过校验）
    outGuards: new Map(
      context.nodeTypes
        .filter((t) => Array.isArray(t.out_guards))
        .map((t): [string, Set<string>] => [t.node_type, new Set(t.out_guards ?? [])]),
    ),
  }));
  const check = $derived(validateFlowDraft(draftJson, checkCtx));

  async function handleGenerate() {
    if (!assistant) {
      errorMsg = t("flow.dlg.errNoAssistant");
      return;
    }
    if (!description.trim()) {
      errorMsg = t("flow.dlg.errEmpty");
      return;
    }
    isLoading = true;
    errorMsg = null;
    // 组装 history(首轮为 undefined):此前轮次原文入对话;**上一轮 assistant
    // 内容取当前草稿态**(textarea 可被人工编辑,修订应基于可见草稿而非
    // LLM 原始输出);构建须在 draftJson 清空前。
    const history =
      turns.length === 0
        ? undefined
        : turns.map((tr, i) => {
            const prevDraft =
              i === turns.length - 1 && draftJson.trim() ? draftJson : tr.reply;
            return [
              { role: "user" as const, content: tr.user },
              { role: "assistant" as const, content: prevDraft },
            ];
          }).flat();
    const prevDraftJson = draftJson;
    draftJson = "";
    try {
      const result = await assistant.transpileFlow(description, context, history);
      turns = [...turns, { user: description, reply: JSON.stringify(result) }];
      draftJson = JSON.stringify(result, null, 2);
    } catch (e) {
      draftJson = prevDraftJson; // 失败保留上一轮草稿,修订链不中断
      errorMsg = (e as Error).message || t("flow.dlg.errFailed");
    } finally {
      isLoading = false;
    }
  }

  function handleEditDraft(event: Event) {
    draftJson = (event.target as HTMLTextAreaElement).value;
  }

  function handleFill() {
    if (!check.parseOk || !check.shapeOk) return;
    onfill(JSON.parse(draftJson) as object);
    onclose();
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />

<div
  class="dialog-overlay"
  onclick={onclose}
  onkeydown={(e) => e.key === "Enter" && onclose()}
  role="button"
  tabindex="0"
  aria-label={t("flow.dlg.overlayAria")}
>
  <div
    class="dialog"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="transpile-flow-title"
  >
    <header class="dialog-header">
      <h2 id="transpile-flow-title">{t("flow.dlg.aiTranspile")}</h2>
      <button class="close-btn" onclick={onclose} aria-label={t("flow.dlg.close")}>×</button>
    </header>

    <main class="dialog-body">
      <section class="step">
        <label for="transpile-flow-description">
          {turns.length > 0 ? t("flow.dlg.reviseLabel") : t("flow.dlg.step1")}
          {#if turns.length > 0}
            <span class="turn-badge">{t("flow.dlg.turnCount", { count: turns.length })}</span>
          {/if}
        </label>
        <textarea
          id="transpile-flow-description"
          bind:value={description}
          placeholder={turns.length > 0 ? t("flow.dlg.revisePlaceholder") : t("flow.dlg.step1Placeholder")}
          rows="3"
          disabled={isLoading}
        ></textarea>
        <div class="actions">
          <button
            class="btn-primary"
            onclick={() => void handleGenerate()}
            disabled={isLoading || !description.trim()}
          >
            {isLoading
              ? t("flow.dlg.generating")
              : turns.length > 0
                ? t("flow.dlg.revise")
                : t("flow.dlg.generate")}
          </button>
        </div>
      </section>

      {#if errorMsg}
        <div class="alert-error" role="alert">
          <strong>{t("flow.dlg.errTitle")}</strong>
          {errorMsg}
        </div>
      {/if}

      {#if draftJson}
        <section class="step">
          <label for="transpile-flow-draft">{t("flow.dlg.step2")}</label>
          <textarea
            id="transpile-flow-draft"
            class="code"
            value={draftJson}
            oninput={handleEditDraft}
            rows="12"
            disabled={isLoading}
          ></textarea>

          <!-- 展示层校验:纯提示不阻断(引擎编译校验兜底,R3) -->
          {#if !check.parseOk}
            <div class="hint warn">{t("flow.dlg.badJson")}</div>
          {:else if !check.shapeOk}
            <div class="hint warn">{t("flow.dlg.missingSkeleton")}</div>
          {:else if check.unknownNodeTypes.length > 0 || check.unknownFormRefs.length > 0}
            <div class="hint warn">
              {t("flow.dlg.warnPrefix")}
              {#if check.unknownNodeTypes.length > 0}
                {t("flow.dlg.unknownNodeType", { nodes: check.unknownNodeTypes.join(", ") })}
              {/if}
              {#if check.unknownFormRefs.length > 0}
                {t("flow.dlg.unknownFormRef", { nodes: check.unknownFormRefs.join(", ") })}
              {/if}
            </div>
          {:else if check.badGuards.length > 0}
            <div class="hint warn">
              {t("flow.dlg.badGuard", { nodes: check.badGuards.join(", ") })}
            </div>
          {:else}
            <div class="hint">{t("flow.dlg.allOk")}</div>
          {/if}
        </section>
      {/if}
    </main>

    <footer class="dialog-footer">
      <span class="footer-hint">{t("flow.dlg.footerHint")}</span>
      <button class="btn-secondary" onclick={onclose} disabled={isLoading}>{t("flow.dlg.discard")}</button>
      {#if draftJson}
        <button
          class="btn-primary"
          onclick={handleFill}
          disabled={isLoading || !check.parseOk || !check.shapeOk}
        >
          {t("flow.dlg.fill")}
        </button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .dialog-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: var(--spacing-md);
  }

  .dialog {
    background: var(--bg-card);
    color: var(--text-primary);
    border: var(--card-border);
    border-radius: var(--radius-lg);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
    max-width: 720px;
    width: 100%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--spacing-md) var(--spacing-lg);
    border-bottom: 1px solid var(--border);
  }

  .dialog-header h2 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
  }

  .close-btn {
    background: transparent;
    border: none;
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    color: var(--text-secondary);
    padding: 0 var(--spacing-xs);
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .dialog-body {
    padding: var(--spacing-lg);
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  .step {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .step label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  /* 多轮修订轮次徽标(UV-178 批次D) */
  .turn-badge {
    margin-left: var(--spacing-sm);
    padding: 0 var(--spacing-sm);
    border: 1px solid color-mix(in srgb, var(--brand) 45%, var(--border));
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--brand) 10%, var(--bg-card));
    color: var(--brand);
    font-size: var(--text-xs);
    font-weight: var(--font-regular, 400);
  }

  textarea {
    width: 100%;
    padding: var(--spacing-sm);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    background: var(--bg-primary);
    color: var(--text-primary);
    resize: vertical;
    box-sizing: border-box;
  }

  textarea.code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  textarea:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .actions {
    display: flex;
    gap: var(--spacing-sm);
  }

  .hint {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    background: var(--bg-primary);
    border: 1px solid var(--border);
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-md);
  }

  .hint.warn {
    color: var(--warning);
    border-color: var(--warning);
  }

  .alert-error {
    padding: var(--spacing-sm) var(--spacing-md);
    border: 1px solid var(--danger);
    background: color-mix(in srgb, var(--danger) 8%, var(--bg-card));
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--danger);
  }

  .dialog-footer {
    padding: var(--spacing-md) var(--spacing-lg);
    background: var(--bg-primary);
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .footer-hint {
    margin-right: auto;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .dialog-footer .btn-primary,
  .dialog-footer .btn-secondary {
    padding: var(--spacing-xs) var(--spacing-md);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .dialog-footer .btn-primary {
    background: var(--brand);
    color: #fff;
    border: 1px solid var(--brand);
  }

  .dialog-footer .btn-secondary {
    background: var(--bg-card);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .dialog-footer .btn-primary:disabled,
  .dialog-footer .btn-secondary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
