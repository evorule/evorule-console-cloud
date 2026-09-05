<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:建库向导步骤 4 — 试运行
    - 展示 Step 3 创建的规则
    - 用户填业务事件(简化:JSON 文本框,基于 schema 字段提示)
    - 尝试 createSession + submitCommand
    - 后端离线时优雅降级(提示 + 允许跳过)
    - P0 限制:规则在 localStorage,试运行展示 session 机制,真正测试规则需 P1+ 服务端规则加载
  关联设计:P01_BUILD_SCHEMA_DESIGN.md §6.5 + §10.1(数据流)
-->

<script lang="ts">
  import {
    useBackendOrNull,
    createSession,
    submitCommand,
  } from "$lib/kernel";
  import { getMeta } from "$lib/stores/rule-business-meta";
  import { getSchemaById } from "$lib/stores/business-form-schema";
  import { toastInfo, toastSuccess, toastWarning } from "$lib/stores/toast";

  let {
    createdRuleId,
    onBack,
    onNext,
  }: {
    createdRuleId: string | null;
    onBack: () => void;
    onNext: () => void;
  } = $props();

  const backend = useBackendOrNull();

  // 规则业务元数据 + schema(用于提示输入字段)
  const meta = $derived(createdRuleId ? getMeta(createdRuleId) : null);
  const schema = $derived(meta?.schemaId ? getSchemaById(meta.schemaId) : null);

  // 默认测试事件(基于 schema 字段生成提示)
  const defaultEvent = $derived.by(() => {
    if (!schema) return '{\n  "amount": 12000\n}';
    const sample: Record<string, unknown> = {};
    for (const f of schema.fields) {
      if (f.group === "condition") {
        sample[f.id.split(".").pop() ?? f.id] = f.defaultValue ?? "";
      }
    }
    return JSON.stringify(sample, null, 2);
  });

  let eventInput = $state("");
  $effect(() => {
    eventInput = defaultEvent;
  });

  // 试运行状态
  let runStatus = $state<"idle" | "running" | "success" | "failed" | "offline">(
    "idle",
  );
  let runResult = $state<string>("");
  let runError = $state<string>("");

  async function handleTrialRun(): Promise<void> {
    if (!backend) {
      runStatus = "offline";
      runError = "未注入后端(backend=null),无法试运行";
      toastWarning("后端不可用,可跳过此步", "试运行");
      return;
    }

    // 解析事件 JSON
    let eventPayload: object;
    try {
      eventPayload = JSON.parse(eventInput);
    } catch (e) {
      runStatus = "failed";
      runError = `事件 JSON 解析失败:${(e as Error).message}`;
      return;
    }

    runStatus = "running";
    runError = "";
    runResult = "";

    try {
      // 1. 健康检查
      const healthy = await backend.health();
      if (!healthy) {
        runStatus = "offline";
        runError =
          "evorule-server 未响应(检查地址或启动服务器)。可跳过此步,规则已保存到本地,稍后可经治理链发布到执行域。";
        toastWarning("服务器离线,可跳过", "试运行");
        return;
      }

      // 2. 创建 session(createSession 内部会设置 currentSessionId)
      const sessionId = await createSession(backend);
      if (sessionId === null) {
        runStatus = "failed";
        runError = "创建 session 失败(服务器返回 null)";
        return;
      }

      // 3. 提交事件(submitCommand 内部用 currentSessionId)
      // P0 限制:规则在 localStorage,服务端规则集未加载,
      // 此处仅展示 session 提交机制;真正测试规则需 P1+ 服务端规则加载
      const instruction = { type: "event", payload: eventPayload };
      const result = await submitCommand(backend, instruction);

      if (result && result.accepted) {
        runStatus = "success";
        runResult = `事件已提交(session=${sessionId},version=${result.version ?? "?"})。
注意:规则存储在浏览器本地,server 当前规则集尚未包含此规则,本次提交主要演示 session 机制。
要让规则真正驱动执行:完成向导后用「导出规则 JSON」→ 治理中心「从向导包导入」→ 发布 → 部署,新会话即生效。`;
        toastSuccess("事件已提交(演示 session 机制)", "试运行");
      } else {
        runStatus = "failed";
        runError = result?.error ?? "提交被拒绝";
      }
    } catch (e) {
      runStatus = "failed";
      runError = (e as Error).message;
    }
  }
</script>

<div class="step-trial-run">
  <h2>步骤 4:试运行</h2>
  <p class="step-desc">
    用业务事件测试规则。规则存储在浏览器本地,此处演示 session 提交机制;
    要让规则真正生效,完成向导后走 导出 → 治理中心发布 → 部署 链路。
  </p>

  {#if createdRuleId && meta}
    <div class="rule-summary">
      <strong>已创建规则:</strong>
      <span class="rule-id">{createdRuleId}</span>
      <span class="rule-meta"
        >行业:{meta.industry} · 业务对象:{meta.businessObject}</span
      >
      {#if meta.schemaId}
        <span class="rule-meta"
          >场景:{getSchemaById(meta.schemaId)?.scenario ?? meta.schemaId}</span
        >
      {/if}
    </div>
  {/if}

  <div class="event-input-section">
    <label for="event-input">业务事件(JSON)</label>
    {#if schema}
      <small class="hint">
        基于「{schema.scenario}」字段提示,可改。条件字段:
        {schema.fields
          .filter((f) => f.group === "condition")
          .map((f) => f.id.split(".").pop())
          .join(" / ")}
      </small>
    {/if}
    <textarea
      id="event-input"
      bind:value={eventInput}
      rows="8"
      class="json-textarea"
    ></textarea>
  </div>

  <div class="run-actions">
    <button
      class="btn-primary"
      onclick={handleTrialRun}
      disabled={runStatus === "running"}
    >
      {runStatus === "running" ? "运行中..." : "▶ 提交事件试运行"}
    </button>
  </div>

  {#if runStatus === "offline" || runStatus === "failed"}
    <div class="result-box error">
      <strong>⚠ {runStatus === "offline" ? "服务器离线" : "试运行失败"}</strong
      >
      <p>{runError}</p>
      <p class="hint">规则已保存到本地,可跳过此步进入工作台。</p>
    </div>
  {:else if runStatus === "success"}
    <div class="result-box success">
      <strong>✅ 试运行完成</strong>
      <pre>{runResult}</pre>
    </div>
  {/if}

  <div class="actions">
    <button class="btn-ghost" onclick={onBack}>上一步</button>
    <button class="btn-primary" onclick={onNext}>下一步</button>
  </div>
</div>

<style>
  .step-trial-run {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h2 {
    font-size: 18px;
    margin: 0;
    color: var(--text-primary, #1e293b);
  }
  .step-desc {
    font-size: 13px;
    color: var(--text-secondary, #64748b);
    margin: 0;
  }

  .rule-summary {
    padding: 10px 12px;
    background: var(--info-bg, #dbeafe);
    border-radius: 6px;
    font-size: 13px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .rule-id {
    font-family: monospace;
    background: var(--bg-card);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .rule-meta {
    color: var(--text-secondary, #64748b);
    font-size: 12px;
  }

  .event-input-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  label {
    font-size: 13px;
    font-weight: 600;
  }
  .hint {
    font-size: 11px;
    color: var(--text-secondary, #64748b);
  }
  .json-textarea {
    font-family: monospace;
    font-size: 12px;
    padding: 10px;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 6px;
    resize: vertical;
  }

  .run-actions {
    display: flex;
    gap: 8px;
  }

  .result-box {
    padding: 12px;
    border-radius: 6px;
    font-size: 13px;
  }
  .result-box.error {
    background: var(--danger-bg, #fee2e2);
    color: var(--danger, #991b1b);
  }
  .result-box.success {
    background: var(--success-bg, #dcfce7);
    color: var(--success, #166534);
  }
  .result-box pre {
    margin: 6px 0 0 0;
    white-space: pre-wrap;
    font-family: monospace;
    font-size: 12px;
  }
  .result-box p {
    margin: 4px 0;
  }

  .actions {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 12px;
  }
  .btn-primary,
  .btn-ghost {
    padding: 8px 20px;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
    border: none;
  }
  .btn-primary {
    background: var(--brand, #2563eb);
    color: white;
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-ghost {
    background: transparent;
    color: var(--text-secondary, #64748b);
    border: 1px solid var(--border, #cbd5e1);
  }
</style>
