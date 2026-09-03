<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:业务执行台主视图(P04 包装内核 ExecutionPadView)
    - 顶部:模式切换(业务模式/开发者模式)+ 事件选择器
    - 三栏布局:EventFormPanel(左) | InstructionPanel(中) | ImpactPreviewPanel(右)
    - 底部:SubmitBar
    - 开发者模式:切换到内核 ExecutionPadView 原始界面
  关联设计:P04_BUSINESS_EXECUTION_PAD_DESIGN.md §6(布局) + §3(模式切换)
-->

<script lang="ts">
  import { get } from "svelte/store";
  import { HttpBackendError, type ExecutionBackend } from "$lib/kernel";
  import {
    createEventFromTemplate,
    currentEvent,
    currentEventId,
    businessEventStore,
    updateFormData,
    updateEventName,
    updateInstruction,
    translateEvent,
    submitEvent,
    deleteEvent,
  } from "$lib/stores/business-event";
  import { getTemplate } from "$lib/stores/business-event-templates";
  import { impactPreview } from "$lib/stores/impact-preview";
  import type { BusinessEventTemplate } from "$lib/stores/business-event-templates";
  import { pushToast } from "$lib/stores/toast";
  import type { LlmAssistant } from "$lib/assistant/types";
  import EventFormPanel from "./EventFormPanel.svelte";
  import InstructionPanel from "./InstructionPanel.svelte";
  import ImpactPreviewPanel from "./ImpactPreviewPanel.svelte";
  import SubmitBar from "./SubmitBar.svelte";
  import DeveloperModeToggle from "$lib/views/Rules/DeveloperModeToggle.svelte";

  interface Props {
    /** LLM Assistant 实例(供翻译用) */
    assistant: LlmAssistant;
    /** 内核 ExecutionBackend(供提交用) */
    backend: ExecutionBackend;
    /** 当前 sessionId(供提交用) */
    sessionId: number;
    /** 可选择的行业过滤(默认 all) */
    industryFilter?: "all" | "medical" | "finance";
  }

  let {
    assistant,
    backend,
    sessionId,
    industryFilter = "all",
  }: Props = $props();

  let developerMode = $state(false);
  let submitting = $state(false);
  // UV-062:停止/强制中止进行中标志(与提交互斥,由 SubmitBar canStop 消费)
  let stopping = $state(false);
  let aborting = $state(false);

  // 派生:当前事件($ 前缀订阅;get() 快照读在 $derived 中不追踪,事件更新会失明)
  const ev = $derived($currentEvent);

  const selectedTemplate: BusinessEventTemplate | undefined = $derived(
    ev ? getTemplate(ev.templateId) : undefined,
  );

  const preview = $derived($impactPreview);

  // === 事件选择 ===
  function handleSelectTemplate(templateId: string): void {
    // 若当前已有事件且未提交,提示覆盖
    const existing = get(currentEventId);
    if (existing) {
      const oldEv = get(currentEvent);
      if (oldEv && oldEv.lastSubmittedAt) {
        // 已有已提交事件,直接新建(不删除历史)
      } else if (oldEv && Object.keys(oldEv.formData).length > 0) {
        if (!confirm("切换模板将清空当前未提交的数据,是否继续?")) return;
        deleteEvent(existing);
      } else {
        deleteEvent(existing);
      }
    }
    const newId = createEventFromTemplate(templateId);
    currentEventId.set(newId);
  }

  function handleChangeName(name: string): void {
    const id = get(currentEventId);
    if (!id) return;
    updateEventName(id, name);
  }

  function handleChangeFormData(data: Record<string, unknown>): void {
    const id = get(currentEventId);
    if (!id) return;
    updateFormData(id, data);
  }

  function handleEditInstructionJson(jsonText: string): void {
    const id = get(currentEventId);
    if (!id || !jsonText.trim()) return;
    try {
      const obj = JSON.parse(jsonText);
      updateInstruction(id, obj);
    } catch {
      // parseError 在 InstructionPanel 内显示
    }
  }

  async function handleTranslate(): Promise<void> {
    const id = get(currentEventId);
    if (!id) {
      pushToast("请先选择模板并填写表单", "warning");
      return;
    }
    try {
      await translateEvent(id, assistant);
      pushToast("翻译成功", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "翻译失败";
      pushToast(msg, "error");
    }
  }

  async function handleSubmit(): Promise<void> {
    const id = get(currentEventId);
    if (!id) {
      pushToast("无事件可提交", "warning");
      return;
    }
    const e = get(currentEvent);
    if (!e?.instruction) {
      pushToast("请先翻译为 instruction JSON", "warning");
      return;
    }
    submitting = true;
    try {
      await submitEvent(id, sessionId, backend);
      pushToast("提交成功,已运行规则", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "提交失败";
      pushToast(msg, "error");
    } finally {
      submitting = false;
    }
  }

  function handleRetranslate(): void {
    void handleTranslate();
  }

  /**
   * UV-062:把 backend 异常映射为含可操作指引的 toast 文案。
   * fail-fast 诚实原则:任何失败都显式提示,拒绝静默吞错。
   */
  function stopActionErrorMessage(err: unknown, action: string): string {
    if (err instanceof HttpBackendError) {
      // status 0 = fetch 层网络错误(连接拒绝 / DNS / CORS)
      if (err.status === 0) {
        return `${action}失败:无法连接 evorule-server,请检查服务是否启动或网络/代理配置`;
      }
      if (err.status === 404 && action === "强制中止") {
        // abort 条件挂载:404 可能是未启用 --allow-abort,也可能 会话不存在
        return `${action}失败:server 未启用强制中止:启动参数需 --allow-abort(或环境变量 EVORULE_ALLOW_ABORT=1);若已启用则为会话不存在`;
      }
      if (err.status === 404) {
        return `${action}失败:会话不存在(可能已被关闭)`;
      }
      return `${action}失败:HTTP ${err.status} — ${err.message}`;
    }
    return `${action}失败:${err instanceof Error ? err.message : String(err)}`;
  }

  /** UV-062:停止 — 温和中断,下一检查点生效(无条件可用) */
  async function handleInterrupt(): Promise<void> {
    if (!(sessionId > 0)) {
      pushToast("无活跃 session,无法停止", "warning");
      return;
    }
    stopping = true;
    try {
      const r = await backend.interruptSession(sessionId);
      if (r.success) {
        pushToast(`已请求中断 session ${r.session_id}:${r.message}`, "success");
      } else {
        pushToast(`中断请求被拒绝:${r.message}`, "warning");
      }
    } catch (err) {
      pushToast(stopActionErrorMessage(err, "中断"), "error");
    } finally {
      stopping = false;
    }
  }

  /** UV-062:强制中止 — 破坏性操作,确认对话框二次确认后才调用 */
  async function handleAbort(): Promise<void> {
    if (!(sessionId > 0)) {
      pushToast("无活跃 session,无法中止", "warning");
      return;
    }
    if (
      !confirm(
        "强制中止将立即终止反应器任务(破坏性操作,不等待检查点,不可撤销)。\n确认继续?",
      )
    ) {
      return;
    }
    aborting = true;
    try {
      const r = await backend.abortSession(sessionId);
      if (r.success) {
        pushToast(`已强制中止 session ${r.session_id}:${r.message}`, "success");
      } else {
        pushToast(`中止请求被拒绝:${r.message}`, "warning");
      }
    } catch (err) {
      pushToast(stopActionErrorMessage(err, "强制中止"), "error");
    } finally {
      aborting = false;
    }
  }

  function handleClear(): void {
    const id = get(currentEventId);
    if (!id) return;
    if (!confirm("确认清空当前事件?")) return;
    deleteEvent(id);
    currentEventId.set(null);
    pushToast("已清空", "info");
  }
</script>

<div class="business-execution-pad">
  <!-- 顶部栏 -->
  <header class="pad-header">
    <div class="header-left">
      <h2 class="pad-title">🚀 业务执行台</h2>
      <span class="pad-subtitle">
        P04 · 用业务语言提交事件,LLM 翻译为内核指令
      </span>
    </div>
    <div class="header-right">
      <DeveloperModeToggle bind:devMode={developerMode} />
      <!-- 事件选择器(已创建事件的下拉) -->
      <select class="event-select" bind:value={$currentEventId}>
        <option value={null}>-- 新建事件 --</option>
        {#each $businessEventStore as e (e.id)}
          <option value={e.id}>
            {e.name} ({new Date(e.createdAt).toLocaleDateString()})
            {e.lastSubmittedAt ? " ✔" : ""}
          </option>
        {/each}
      </select>
    </div>
  </header>

  {#if developerMode}
    <!-- 开发者模式:提示切换到内核视图(此处不直接 import,避免循环依赖,实际入口在 routes/view/+page) -->
    <div class="dev-mode-hint">
      <p>💡 开发者模式下可直接操作内核 ExecutionPadView。</p>
      <p>点击顶部"内核执行控制台"导航进入内核原始界面。</p>
    </div>
  {/if}

  <!-- 三栏主体 + 底部栏 -->
  <div class="pad-body">
    <div class="pad-columns">
      <!-- 左:表单 -->
      <div class="col col-form">
        <EventFormPanel
          templateId={selectedTemplate?.id ?? null}
          onSelectTemplate={handleSelectTemplate}
          eventName={ev?.name ?? ""}
          onChangeEventName={handleChangeName}
          formData={ev?.formData ?? {}}
          onChangeFormData={handleChangeFormData}
          {industryFilter}
          disabled={submitting}
        />
      </div>

      <!-- 中:指令 -->
      <div class="col col-instruction">
        <InstructionPanel
          instruction={ev?.instruction ?? null}
          translateStatus={ev?.translateStatus ?? "idle"}
          translateError={ev?.translateError ?? null}
          {developerMode}
          onTranslate={handleTranslate}
          onEditInstructionJson={handleEditInstructionJson}
          canTranslate={!!ev &&
            !!selectedTemplate &&
            Object.keys(ev.formData).length > 0}
        />
      </div>

      <!-- 右:影响预览 -->
      <div class="col col-preview">
        <ImpactPreviewPanel {preview} />
      </div>
    </div>

    <!-- 底部:提交栏 -->
    <SubmitBar
      translateStatus={ev?.translateStatus ?? "idle"}
      hasInstruction={!!ev?.instruction}
      lastResult={ev?.lastResult ?? null}
      lastSubmittedAt={ev?.lastSubmittedAt ?? null}
      {sessionId}
      {submitting}
      {stopping}
      {aborting}
      onSubmit={handleSubmit}
      onRetranslate={handleRetranslate}
      onClear={handleClear}
      onInterrupt={handleInterrupt}
      onAbort={handleAbort}
      disabled={!ev}
    />
  </div>
</div>

<style>
  .business-execution-pad {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg-page, #f8fafc);
  }
  .pad-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: var(--bg-card);
    border-bottom: 1px solid var(--border, #e2e8f0);
    flex-wrap: wrap;
    gap: 10px;
  }
  .header-left {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .pad-title {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary, #1e293b);
  }
  .pad-subtitle {
    font-size: 11px;
    color: var(--text-secondary, #64748b);
  }
  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .event-select {
    font-size: 12px;
    padding: 5px 10px;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 4px;
    background: var(--bg-card);
    color: var(--text-primary, #1e293b);
  }
  .dev-mode-hint {
    padding: 10px 16px;
    background: var(--warning-bg, #fef3c7);
    color: var(--warning, #92400e);
    font-size: 12px;
    border-bottom: 1px solid var(--warning, #fde68a);
  }
  .dev-mode-hint p {
    margin: 2px 0;
  }
  .pad-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .pad-columns {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 10px;
    padding: 10px;
    flex: 1;
    min-height: 0;
  }
  .col {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .col-form > :global(*) {
    flex: 1;
    min-height: 0;
  }
  .col-instruction > :global(*) {
    flex: 1;
    min-height: 0;
  }
  .col-preview > :global(*) {
    flex: 1;
    min-height: 0;
  }

  @media (max-width: 1024px) {
    .pad-columns {
      grid-template-columns: 1fr;
      overflow-y: auto;
    }
    .col {
      min-height: 300px;
    }
  }
</style>
