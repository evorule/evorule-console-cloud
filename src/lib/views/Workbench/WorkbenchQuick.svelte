<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  Region 3 — 一键操作(3 tab)
    Tab 1 加规则(直接 JSON 提交)
    Tab 2 试运行(选 session + payload,submitCommand)
    Tab 3 LLM 快速(检测 LLM 配置,未配置给引导)

  设计:这是 workbench 极简版的"添加"入口,真实重操作走完整视图
       (规则库 / 执行台 / 助手侧栏)
-->

<script lang="ts">
  import type { SessionId } from "$lib/kernel";

  interface Props {
    loggedIn: boolean;
    llmReady: boolean;
    sessionList: SessionId[];
    onAddRule: (json: string) => void | Promise<void>;
    onRun: (json: string) => void | Promise<void>;
  }

  let { loggedIn, llmReady, sessionList, onAddRule, onRun }: Props = $props();

  type Tab = "rule" | "run" | "llm";
  let activeTab = $state<Tab>("rule");

  // Tab 1 state
  let ruleJson = $state(`{
  "type": "set",
  "params": {
    "attr": "__exec__.payload.x",
    "operation": "set",
    "value": 42
  }
}`);
  let ruleId = $state("rule.user.demo");

  // P1-01:一键插入一个完整可提交的示例(P2-03 同类:inline JSON 校验)
  const EXAMPLE_RULE_ID = "rule.medical.triage";
  const EXAMPLE_RULE_JSON = `{
  "type": "set",
  "params": {
    "attr": "__exec__.payload.priority",
    "operation": "set",
    "value": 1
  }
}`;
  let ruleError = $state<string | null>(null);

  // Tab 2 state
  let selectedSession = $state<number | "">("");
  let payloadJson = $state('{"order_id": 12345}');

  // 默认选第一个 session
  $effect(() => {
    if ((selectedSession === "" || selectedSession === 0) && sessionList.length > 0) {
      selectedSession = sessionList[0];
    }
  });

  function loadExample(): void {
    ruleId = EXAMPLE_RULE_ID;
    ruleJson = EXAMPLE_RULE_JSON;
    ruleError = null;
  }

  function handleAddRule(): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(ruleJson);
    } catch (e) {
      // P2-03:inline JSON 校验,非法时导向可诊断错误,不静默闪断
      ruleError = `规则 JSON 非法,请修正后再提交 — ${(e as Error).message}`;
      return;
    }
    ruleError = null;
    const full = JSON.stringify(
      { rule_id: ruleId, ...(parsed as Record<string, unknown>) },
      null,
      2,
    );
    void onAddRule(full);
  }

  function handleRun() {
    void onRun(payloadJson);
  }
</script>

<div class="region-quick">
  <h2 class="region-title"><span class="icon">⚡</span>一键操作</h2>
  <div class="quick-tabs">
    <button
      class="quick-tab"
      class:active={activeTab === "rule"}
      onclick={() => (activeTab = "rule")}
    >
      ➕ 加规则
    </button>
    <button
      class="quick-tab"
      class:active={activeTab === "run"}
      onclick={() => (activeTab = "run")}
    >
      ▶ 试运行
    </button>
    <button
      class="quick-tab"
      class:active={activeTab === "llm"}
      onclick={() => (activeTab = "llm")}
    >
      🤖 LLM 快速
    </button>
  </div>

  {#if activeTab === "rule"}
    <div class="quick-panel">
      <div class="form-field">
        <label for="quick-rule-id">规则 ID</label>
        <input
          id="quick-rule-id"
          type="text"
          bind:value={ruleId}
          placeholder="rule.&lt;scope&gt;.&lt;name&gt;"
        />
      </div>
      <div class="form-field">
        <label for="quick-rule-json">规则 JSON(type + params)</label>
        <textarea id="quick-rule-json" bind:value={ruleJson}></textarea>
      </div>
      {#if ruleError}
        <div class="json-error" role="alert">{ruleError}</div>
      {/if}
      <div class="btn-row">
        <button
          class="btn btn-primary"
          onclick={handleAddRule}
          disabled={!loggedIn}
          title={loggedIn ? "提交到当前 workspace" : "请先登录"}
        >
          ➕ 提交
        </button>
        <button class="btn btn-secondary" type="button" onclick={loadExample}>
          📋 插入完整示例
        </button>
        <a class="btn btn-secondary" href="/view/rules">🧙 走向导</a>
        <a class="btn btn-secondary" href="/view/rules">📁 看 demo</a>
      </div>
    </div>
  {:else if activeTab === "run"}
    <div class="quick-panel">
      <div class="form-row">
        <div class="form-field">
          <label for="quick-session">Session</label>
          <select id="quick-session" bind:value={selectedSession}>
            {#if sessionList.length === 0}
              <option value="">(暂无 session)</option>
            {:else}
              {#each sessionList as sid (sid)}
                <option value={sid}>#{sid}</option>
              {/each}
            {/if}
          </select>
        </div>
        <div class="form-field" style="flex: 2;">
          <label for="quick-payload">Payload (JSON)</label>
          <input id="quick-payload" type="text" bind:value={payloadJson} placeholder={"{key: value}"} />
        </div>
      </div>
      <div class="btn-row">
        <button
          class="btn btn-primary"
          onclick={handleRun}
          disabled={!loggedIn || sessionList.length === 0}
        >
          ▶ 执行
        </button>
        <a class="btn btn-secondary" href="/view/timetravel">⏱ 回放</a>
        <a class="btn btn-secondary" href="/view/state">🔄 看状态</a>
      </div>
    </div>
  {:else if activeTab === "llm"}
    <div class="quick-panel">
      {#if llmReady}
        <div class="llm-ready">
          ✅ LLM 已配置 · 侧栏直接对话
        </div>
        <div class="btn-row">
          <a class="btn btn-primary" href="/view/rules">🪄 起草规则</a>
          <a class="btn btn-secondary" href="/view/audit">🔍 解释规则</a>
        </div>
      {:else}
        <div class="llm-disabled">
          ⚠ LLM 尚未配置 · 请在「设置 → LLM 配置」填写 API key 后使用
        </div>
        <!-- P1-02:无 Key 也可预览 LLM 将产出的结果形态,降低配置焦虑 -->
        <details class="llm-sample">
          <summary>💡 查看 LLM 样例输出(无需 Key)</summary>
          <p class="llm-sample-note">
            配置 Key 后,LLM 会按带外协议自动<b>起草</b>与<b>解释</b>规则。下方为未接入时的静态示意:
          </p>
          <pre class="llm-sample-pre">{`拟定规则 rule.medical.triage:
{
  "type": "set",
  "params": {
    "attr": "__exec__.payload.triage_level",
    "operation": "set",
    "value": "normal"
  }
}
→ 该规则将轻症患者标记为 normal 分诊级别。`}</pre>
        </details>
        <div class="btn-row">
          <a class="btn btn-secondary" href="/?openSettings=llm">⚙️ 打开设置</a>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .region-quick {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
  }
  .region-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 12px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .region-title .icon {
    font-size: 16px;
  }
  .quick-tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 12px;
  }
  .quick-tab {
    padding: 8px 12px;
    background: transparent;
    border: 0;
    color: var(--text-muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    font-size: 13px;
  }
  .quick-tab:hover {
    color: var(--text-primary);
  }
  .quick-tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--primary, #2563eb);
  }
  .form-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }
  .form-field label {
    font-size: 12px;
    color: var(--text-secondary);
  }
  .form-field input,
  .form-field textarea,
  .form-field select {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 10px;
    color: var(--text-primary);
    font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
    font-size: 12px;
  }
  .form-field input:focus,
  .form-field textarea:focus,
  .form-field select:focus {
    outline: none;
    border-color: var(--primary, #2563eb);
  }
  .form-field textarea {
    min-height: 100px;
    resize: vertical;
  }
  .form-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }
  .form-row .form-field {
    flex: 1;
    margin-bottom: 0;
  }
  .btn {
    padding: 8px 14px;
    border: 0;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    text-decoration: none;
    color: inherit;
  }
  .btn-primary {
    background: var(--primary, #2563eb);
    color: white;
  }
  .btn-primary:hover:not(:disabled) {
    background: #1d4ed8;
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-secondary {
    background: var(--bg-input);
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }
  .btn-secondary:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .btn-row {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
  }
  .llm-disabled {
    padding: 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
    background: var(--bg-input);
    border-radius: 4px;
  }
  .json-error {
    padding: 8px 10px;
    margin-bottom: 10px;
    font-size: 12px;
    color: var(--danger, #dc2626);
    background: rgba(220, 38, 38, 0.08);
    border-left: 3px solid var(--danger, #dc2626);
    border-radius: 4px;
    font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
    word-break: break-all;
  }
  .llm-sample {
    margin-top: 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 10px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .llm-sample summary {
    cursor: pointer;
    color: var(--text-secondary);
  }
  .llm-sample-note {
    margin: 8px 0 6px;
    line-height: 1.6;
  }
  .llm-sample-pre {
    margin: 0;
    padding: 8px 10px;
    background: var(--bg-input);
    border-radius: 4px;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
    font-size: 12px;
    color: var(--text-primary);
  }
  .llm-ready {
    padding: 16px;
    text-align: center;
    color: var(--success, #16a34a);
    font-size: 13px;
    background: rgba(22, 163, 74, 0.1);
    border-radius: 4px;
  }
</style>
