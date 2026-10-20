<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  /sessions 路由 — Agent 会话验证器(只读验证面,纯浏览器端零后端)。
  导入 evo-agent-session v1 文件(或选内置演示)→ BLAKE3 链重算 →
  时间线/动作明细/级联信任标记 → 篡改实验(改一字节看链红)。
  边界:不做会话编辑、不落库、不替代审计页(真实治理数据走 /audit)。
-->

<script lang="ts">
  import {
    ContractError,
    type AgentSessionFile,
    type SessionVerification,
  } from "$lib/session-audit/types";
  import { importAndVerify, verifySession } from "$lib/session-audit/verify";
  import killerFixture from "$lib/session-audit/fixtures/agent-killer.json";
  import computeFixture from "$lib/session-audit/fixtures/numeric-compute.json";
  import { toastError, toastSuccess } from "$lib/stores/toast";

  let file: AgentSessionFile | null = $state(null);
  let verification: SessionVerification | null = $state(null);
  let sourceLabel = $state("");
  let errorMsg = $state<string | null>(null);
  /** 篡改实验的原始备份(Restore 语义) */
  let pristine: AgentSessionFile | null = null;
  let tampered = $state(false);
  let fileInput: HTMLInputElement;

  function load(raw: unknown, label: string): void {
    try {
      const result = importAndVerify(raw);
      pristine = structuredClone(result.file) as AgentSessionFile;
      file = result.file;
      verification = result.verification;
      sourceLabel = label;
      errorMsg = null;
      tampered = false;
      if (result.verification.chainIntact) {
        toastSuccess("链验证通过:完整性完好", "会话验证");
      }
    } catch (e) {
      const msg = e instanceof ContractError ? e.message : (e as Error).message;
      errorMsg = msg;
      file = null;
      verification = null;
      toastError(msg, "契约校验失败");
    }
  }

  function loadKiller(): void {
    load(killerFixture, "内置演示 · 安全护栏线");
  }

  function loadCompute(): void {
    load(computeFixture, "内置演示 · 确定性计算线");
  }

  async function onFilePick(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const picked = input.files?.[0];
    if (!picked) return;
    try {
      const text = await picked.text();
      load(JSON.parse(text), `导入文件 · ${picked.name}`);
    } catch (e) {
      errorMsg = `JSON 解析失败:${(e as Error).message}`;
      toastError(errorMsg, "导入失败");
    } finally {
      input.value = "";
    }
  }

  // 篡改实验:定位第一个数值型字段改一个字节(数值 19→91 级别的位错),
  // 重算后 first_broken 起全链红——浏览器本地完成,零后端。
  function tamperOneByte(): void {
    if (!file || !pristine) return;
    const fact = file.facts.find((f) => {
      const p = f.payload as Record<string, unknown> | undefined;
      return p && Object.values(p).some((v) => typeof v === "number");
    });
    if (!fact) {
      toastError("演示会话无数值字段可篡改", "篡改实验");
      return;
    }
    const payload = fact.payload as Record<string, unknown>;
    const key = Object.keys(payload).find(
      (k) => typeof payload[k] === "number",
    ) as string;
    payload[key] = (payload[key] as number) + 0.01;
    tampered = true;
    verification = verifySession(file);
  }

  function restore(): void {
    if (!pristine) return;
    file = structuredClone(pristine) as AgentSessionFile;
    verification = verifySession(file);
    tampered = false;
    toastSuccess("已恢复原始导出,链复绿", "会话验证");
  }

  function factSummary(fact: Record<string, unknown>): string {
    const p = fact.payload ?? fact.message ?? fact.trigger ?? {};
    const s = JSON.stringify(p);
    return s.length > 140 ? `${s.slice(0, 140)}…` : s;
  }

  function fmtBroken(i: number | null): string {
    return i === null ? "" : `第 ${i + 1} 条(id=${file?.facts[i]?.id})起不可信`;
  }
</script>

<svelte:head>
  <title>会话验证 · evorule</title>
</svelte:head>

<div class="sv">
  <header class="sv-header">
    <h1>🔍 会话验证</h1>
    <p class="sv-sub">
      导入 evo-agent-session 文件,浏览器端重算 BLAKE3 链——第三方可独立验证,
      不信任任何服务器
    </p>
  </header>

  <!-- ① 来源区:内置演示 + 文件导入 -->
  <section class="sv-source">
    <div class="sv-source-buttons">
      <button class="sv-btn" onclick={loadKiller}>
        🛡️ 内置演示 · 安全护栏线
      </button>
      <button class="sv-btn" onclick={loadCompute}>
        🧮 内置演示 · 确定性计算线
      </button>
      <button class="sv-btn sv-btn-primary" onclick={() => fileInput.click()}>
        📂 导入会话文件(.json)
      </button>
      <input
        bind:this={fileInput}
        type="file"
        accept=".json,application/json"
        onchange={onFilePick}
        class="sv-file-hidden"
        aria-label="选择会话文件"
      />
    </div>
    {#if sourceLabel}
      <span class="sv-source-label">当前来源:{sourceLabel}</span>
    {/if}
    {#if errorMsg}
      <div class="sv-error" role="alert">契约不符:{errorMsg}</div>
    {/if}
  </section>

  {#if file && verification}
    <!-- ② 摘要带:manifest + 验证徽标 -->
    <section class="sv-summary" class:broken={!verification.chainIntact}>
      <div class="sv-summary-main">
        <div class="sv-task">{file.manifest.task_summary}</div>
        <div class="sv-meta">
          {file.manifest.producer} v{file.manifest.producer_version} ·
          {file.manifest.session_id} · {file.manifest.created_at}
          {#if file.manifest.verdict}
            <span class="sv-verdict">verdict: {file.manifest.verdict}</span>
          {/if}
        </div>
      </div>
      <div class="sv-badge" class:ok={verification.chainIntact}>
        {#if verification.chainIntact}
          ✅ 链完整 · {file.facts.length} 条事实全可信
        {:else}
          ❌ 链已断 · {fmtBroken(verification.firstBroken)}
        {/if}
      </div>
    </section>

    <!-- ③ 时间线:逐条事实 + 信任标记 -->
    <section class="sv-section">
      <h2 class="sv-section-title">事实时间线</h2>
      <ol class="sv-timeline">
        {#each file.facts as fact, i}
          {@const v = verification.factVerdicts[i]}
          <li class="sv-fact" class:untrusted={!v.trusted}>
            <span class="sv-fact-dot" class:ok={v.trusted}></span>
            <div class="sv-fact-body">
              <div class="sv-fact-head">
                <span class="sv-fact-type">#{i + 1} {fact.type}</span>
                <span class="sv-fact-time">{fact.timestamp ?? ""}</span>
                {#if !v.trusted}
                  <span class="sv-fact-flag">
                    {#if !v.hashOk}哈希不符{/if}
                    {#if !v.hashOk && !v.linkOk} · {/if}
                    {#if !v.linkOk}链链接断{/if}
                    {#if v.hashOk && v.linkOk}(级联不可信){/if}
                  </span>
                {/if}
              </div>
              <div class="sv-fact-summary">{factSummary(fact as Record<string, unknown>)}</div>
              <div class="sv-fact-hash" title="链声明哈希">{file.chain.entries[i].fact_hash.slice(0, 30)}…</div>
            </div>
          </li>
        {/each}
      </ol>
    </section>

    <!-- ④ LLM 动作明细 -->
    {#if file.tool_calls.length > 0}
      <section class="sv-section">
        <h2 class="sv-section-title">LLM 动作明细(tool_calls)</h2>
        <ul class="sv-calls">
          {#each file.tool_calls as call (call.seq)}
            <li class="sv-call">
              <span class="sv-call-seq">#{call.seq}</span>
              <span class="sv-call-name">{call.name}</span>
              <span class="sv-call-args">{call.args_summary}</span>
              <span class="sv-call-result">→ {call.result_summary ?? ""}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- ⑤ 篡改实验 -->
    <section class="sv-section sv-tamper">
      <h2 class="sv-section-title">篡改实验</h2>
      <p class="sv-tamper-desc">
        改一个字节,看链如何红:篡改某条事实的数值字段后重算,断点及之后全部不可信
        (first_broken + 级联语义)。
      </p>
      <div class="sv-tamper-actions">
        {#if !tampered}
          <button class="sv-btn sv-btn-danger" onclick={tamperOneByte}>
            ✏️ 篡改一个字节
          </button>
        {:else}
          <button class="sv-btn" onclick={restore}>
            ↩️ 恢复原始导出
          </button>
        {/if}
      </div>
    </section>
    {/if}
</div>

<style>
  .sv {
    max-width: 880px;
    margin: 0 auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .sv-header h1 {
    margin: 0 0 4px 0;
    font-size: 22px;
    color: var(--text-primary);
  }
  .sv-sub {
    margin: 0;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .sv-source {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sv-source-buttons {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .sv-btn {
    padding: 8px 14px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border-strong);
    background: var(--bg-card);
    color: var(--text-primary);
    font-size: 13px;
    cursor: pointer;
  }
  .sv-btn:hover {
    background: var(--bg-hover);
  }
  .sv-btn-primary {
    border-color: var(--brand);
    color: var(--brand);
  }
  .sv-btn-danger {
    border-color: var(--danger);
    color: var(--danger);
  }
  .sv-file-hidden {
    display: none;
  }
  .sv-source-label {
    font-size: 12px;
    color: var(--text-muted);
  }
  .sv-error {
    padding: 10px 14px;
    border-radius: var(--r-sm);
    background: var(--danger-bg);
    color: var(--danger);
    font-size: 13px;
  }

  .sv-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 18px;
    border: 1px solid var(--success);
    border-radius: var(--r-lg);
    background: var(--success-bg);
    flex-wrap: wrap;
  }
  .sv-summary.broken {
    border-color: var(--danger);
    background: var(--danger-bg);
  }
  .sv-task {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .sv-meta {
    font-size: 12px;
    color: var(--text-secondary);
    margin-top: 4px;
  }
  .sv-verdict {
    margin-left: 8px;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--bg-hover);
  }
  .sv-badge {
    font-size: 13px;
    font-weight: 600;
    color: var(--success);
    white-space: nowrap;
  }
  .sv-summary.broken .sv-badge {
    color: var(--danger);
  }

  .sv-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sv-section-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .sv-timeline {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sv-fact {
    display: flex;
    gap: 12px;
    padding: 10px 14px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
  }
  .sv-fact.untrusted {
    border-color: var(--danger);
    background: var(--danger-bg);
  }
  .sv-fact-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--danger);
    flex-shrink: 0;
    margin-top: 5px;
  }
  .sv-fact-dot.ok {
    background: var(--success);
  }
  .sv-fact-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .sv-fact-head {
    display: flex;
    gap: 10px;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .sv-fact-type {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .sv-fact-time {
    font-size: 11px;
    color: var(--text-muted);
  }
  .sv-fact-flag {
    font-size: 11px;
    font-weight: 600;
    color: var(--danger);
  }
  .sv-fact-summary {
    font-size: 12px;
    color: var(--text-secondary);
    word-break: break-all;
  }
  .sv-fact-hash {
    font-size: 10px;
    font-family: monospace;
    color: var(--text-muted);
  }

  .sv-calls {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sv-call {
    display: flex;
    gap: 10px;
    align-items: baseline;
    padding: 8px 14px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    font-size: 12px;
    flex-wrap: wrap;
  }
  .sv-call-seq {
    color: var(--text-muted);
  }
  .sv-call-name {
    font-weight: 600;
    color: var(--brand);
    font-family: monospace;
  }
  .sv-call-args {
    color: var(--text-secondary);
    font-family: monospace;
  }
  .sv-call-result {
    color: var(--text-primary);
  }

  .sv-tamper {
    padding: 16px 18px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-lg);
  }
  .sv-tamper-desc {
    margin: 0;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .sv-tamper-actions {
    display: flex;
    gap: 10px;
  }
</style>
