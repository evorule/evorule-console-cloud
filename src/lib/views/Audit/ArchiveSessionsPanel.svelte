<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:历史会话审计档案面板(UV-016)
    - 消费 GET /api/audit-archive/sessions 与 /api/audit-archive/sessions/{id}/audit
    - 归档分组:LLM 侧车审计会话 / 业务会话;活跃会话标记
    - LLM 详情:call_external Command 的 messages / audit_purpose、
      IoRequest params、IoResponse result/error 可展开查看
    - 只读:档案数据来自 WAL 重建,不提供任何写操作
  说明:仅 CloudHttpBackend(联网模式)提供档案端点;其他 backend 显示不可用提示
-->

<script lang="ts">
  import { onMount } from "svelte";
  import {
    CloudHttpBackend,
    type ArchiveSessionMeta,
    type ArchiveAudit,
    type ArchiveAuditEntry,
  } from "$lib/backend/cloud-http-backend";
  import { useBackend } from "$lib/kernel";
  import { toastError } from "$lib/stores/toast";

  const backend = useBackend();
  const cloud = backend instanceof CloudHttpBackend ? backend : null;

  // === 状态 ===
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let sessions = $state<ArchiveSessionMeta[]>([]);
  let activeIds = $state<Set<number>>(new Set());

  let selectedId = $state<number | null>(null);
  let auditLoading = $state(false);
  let auditError = $state<string | null>(null);
  let audit = $state<ArchiveAudit | null>(null);
  /** 展开详情的条目 fact_id 集合 */
  let expanded = $state<Set<number>>(new Set());

  // === 派生:归档分组(LLM 侧车在前) ===
  let sidecarSessions = $derived(sessions.filter((s) => s.is_llm_sidecar));
  let normalSessions = $derived(sessions.filter((s) => !s.is_llm_sidecar));

  onMount(() => {
    if (cloud) void refresh();
  });

  async function refresh(): Promise<void> {
    if (!cloud) return;
    loading = true;
    loadError = null;
    try {
      const resp = await cloud.listArchiveSessions();
      sessions = resp.sessions;
      activeIds = new Set(resp.active_session_ids);
    } catch (e) {
      loadError = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function selectSession(id: number): Promise<void> {
    if (!cloud) return;
    if (selectedId === id) {
      // 再次点击收起
      selectedId = null;
      audit = null;
      auditError = null;
      return;
    }
    selectedId = id;
    auditLoading = true;
    auditError = null;
    audit = null;
    expanded = new Set();
    try {
      // include_content=true:LLM 审计详情(IoRequest params / IoResponse result)依赖此参数
      audit = await cloud.getArchiveAudit(id, true);
    } catch (e) {
      auditError = (e as Error).message;
    } finally {
      auditLoading = false;
    }
  }

  function toggleExpand(factId: number): void {
    const next = new Set(expanded);
    if (next.has(factId)) {
      next.delete(factId);
    } else {
      next.add(factId);
    }
    expanded = next;
  }

  // === LLM 详情提取 ===

  interface LlmDetail {
    purpose: string | null;
    messages: unknown;
    result: unknown;
    error: string | null;
  }

  function asObject(v: unknown): Record<string, unknown> | null {
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  }

  /** messages 可能是 JSON 字符串或数组,尽力解析 */
  function parseMessages(v: unknown): unknown {
    if (typeof v === "string") {
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }
    return v;
  }

  /** 从条目 content_json 提取 LLM 审计详情;非 LLM 条目返回 null */
  function extractLlmDetail(entry: ArchiveAuditEntry): LlmDetail | null {
    const content = asObject(entry.content_json);
    if (!content) return null;

    if (content.type === "Command") {
      const ins = asObject(content.instruction);
      if (!ins || ins.type !== "call_external") return null;
      const params = asObject(ins.params);
      if (!params || params.messages === undefined) return null;
      return {
        purpose:
          typeof params.audit_purpose === "string"
            ? params.audit_purpose
            : null,
        messages: parseMessages(params.messages),
        result: null,
        error: null,
      };
    }
    if (content.type === "IoRequest") {
      const params = asObject(content.params);
      if (!params || params.messages === undefined) return null;
      return {
        purpose:
          typeof params.audit_purpose === "string"
            ? params.audit_purpose
            : null,
        messages: parseMessages(params.messages),
        result: null,
        error: null,
      };
    }
    if (content.type === "IoResponse") {
      return {
        purpose: null,
        messages: null,
        result: content.result ?? null,
        error:
          typeof content.error === "string" && content.error
            ? content.error
            : null,
      };
    }
    return null;
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function prettyJson(v: unknown): string {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }

  const purposeLabels: Record<string, string> = {
    draft_rule: "起草规则",
    gen_tests: "生成测试",
    explain_rule: "解释规则",
  };
  function purposeLabel(p: string | null): string {
    if (!p) return "侧车审计";
    return purposeLabels[p] ?? p;
  }
</script>

<div class="archive-panel">
  <div class="panel-header">
    <h2>🗄️ 历史会话审计档案</h2>
    {#if cloud}
      <button
        class="refresh-btn"
        onclick={refresh}
        disabled={loading}
        title="重新扫描 WAL 档案目录"
      >
        {loading ? "⏳ 扫描中…" : "↻ 刷新"}
      </button>
    {/if}
  </div>

  {#if !cloud}
    <div class="hint-box">
      审计档案仅在联网模式(连接 evorule-server)下可用;当前 backend 不提供档案端点。
    </div>
  {:else if loadError}
    <div class="error-box" role="alert">档案扫描失败:{loadError}</div>
  {:else if sessions.length === 0 && !loading}
    <div class="hint-box">暂无历史会话档案(服务器重启后,WAL 中的历史会话会出现在这里)。</div>
  {:else}
    {#if sidecarSessions.length > 0}
      <div class="group">
        <div class="group-title">🤖 LLM 侧车审计会话({sidecarSessions.length})</div>
        {#each sidecarSessions as s (s.session_id)}
          <button
            class="session-item sidecar"
            class:active={selectedId === s.session_id}
            onclick={() => selectSession(s.session_id)}
          >
            <span class="sid">#{s.session_id}</span>
            <span class="tag purpose">{purposeLabel(s.audit_purpose)}</span>
            <span class="meta">{s.fact_count} 事实 · {formatBytes(s.wal_bytes)}</span>
            {#if activeIds.has(s.session_id)}
              <span class="tag live">活跃</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}

    {#if normalSessions.length > 0}
      <div class="group">
        <div class="group-title">📋 业务会话({normalSessions.length})</div>
        {#each normalSessions as s (s.session_id)}
          <button
            class="session-item"
            class:active={selectedId === s.session_id}
            onclick={() => selectSession(s.session_id)}
          >
            <span class="sid">#{s.session_id}</span>
            <span class="meta"
              >{s.fact_count} 事实 · 末条 {s.last_fact_type} · {formatBytes(s.wal_bytes)}</span
            >
            {#if activeIds.has(s.session_id)}
              <span class="tag live">活跃</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}

    {#if selectedId !== null}
      <div class="audit-detail">
        <div class="detail-header">
          <h3>会话 #{selectedId} 档案审计链</h3>
          {#if auditLoading}
            <span class="loading-text">⏳ 重建审计链中…</span>
          {:else if auditError}
            <span class="error-text">⚠️ {auditError}</span>
          {:else if audit}
            {#if audit.verified}
              <span class="tag verified-ok">✓ BLAKE3 链验证通过</span>
            {:else}
              <span class="tag verified-bad">⚠ 链验证失败(疑似篡改/损坏)</span>
            {/if}
            {#if audit.unhashed_records > 0}
              <span class="tag warn" title="旧格式记录无哈希字段,不参与验证">未哈希记录 {audit.unhashed_records}</span>
            {/if}
            <span class="meta">共 {audit.fact_count} 条</span>
          {/if}
        </div>

        {#if audit}
          <div class="entries">
            {#each audit.entries as entry (entry.fact_id)}
              <div class="entry">
                <button
                  class="entry-row"
                  onclick={() => toggleExpand(entry.fact_id)}
                  title={extractLlmDetail(entry) ? "点击展开 LLM 审计详情" : "点击展开原始内容"}
                >
                  <span class="lt">t={entry.logical_time}</span>
                  <span class="ftype">{entry.fact_type}</span>
                  <span class="fid">fact #{entry.fact_id}</span>
                  {#if extractLlmDetail(entry)}
                    <span class="tag purpose">LLM</span>
                  {/if}
                  {#if entry.content_json}
                    <span class="expand-mark">{expanded.has(entry.fact_id) ? "▾" : "▸"}</span>
                  {/if}
                </button>
                <div class="hash-line">
                  <span title="前一条哈希">prev {entry.prev_hash.slice(0, 12)}…</span>
                  <span title="内容哈希">hash {entry.content_hash.slice(0, 12)}…</span>
                </div>
                {#if expanded.has(entry.fact_id) && entry.content_json}
                  {@const detail = extractLlmDetail(entry)}
                  <div class="content-detail">
                    {#if detail}
                      <div class="llm-detail">
                        {#if detail.purpose}
                          <div class="detail-label">审计用途:<b>{purposeLabel(detail.purpose)}</b></div>
                        {/if}
                        {#if detail.messages !== null && detail.messages !== undefined}
                          <div class="detail-label">Prompt 消息:</div>
                          <pre class="json-block">{prettyJson(detail.messages)}</pre>
                        {/if}
                        {#if detail.result !== null && detail.result !== undefined}
                          <div class="detail-label">LLM 返回结果:</div>
                          <pre class="json-block">{typeof detail.result === "string" ? detail.result : prettyJson(detail.result)}</pre>
                        {/if}
                        {#if detail.error}
                          <div class="detail-label error-text">调用错误:{detail.error}</div>
                        {/if}
                      </div>
                    {:else}
                      <pre class="json-block">{prettyJson(entry.content_json)}</pre>
                    {/if}
                  </div>
                {:else if expanded.has(entry.fact_id)}
                  <div class="content-detail">
                    <div class="hint-box">该条目无完整内容(需 include_content 或为旧格式记录)。</div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .archive-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--bg-card);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    padding: 12px;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .panel-header h2 {
    font-size: 15px;
    font-weight: 700;
    margin: 0;
    color: var(--text-primary, #1f2937);
  }
  .refresh-btn {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 5px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card);
    color: var(--text-secondary, #4b5563);
    cursor: pointer;
    font-family: inherit;
    font-weight: 600;
  }
  .refresh-btn:hover:not(:disabled) {
    background: var(--bg-page, #f9fafb);
  }
  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .group-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-secondary, #4b5563);
    margin-bottom: 2px;
  }
  .session-item {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    text-align: left;
    padding: 6px 10px;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 6px;
    background: var(--bg-page, #f9fafb);
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    color: var(--text-primary, #1f2937);
  }
  .session-item:hover {
    border-color: var(--brand, #2563eb);
  }
  .session-item.active {
    border-color: var(--brand, #2563eb);
    background: var(--brand-bg, #eff6ff);
  }
  .session-item.sidecar {
    border-left: 3px solid var(--warning, #f59e0b);
  }
  .sid {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .meta {
    font-size: 11px;
    color: var(--text-secondary, #6b7280);
  }
  .tag {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 999px;
    font-weight: 600;
    white-space: nowrap;
  }
  .tag.purpose {
    background: var(--warning-bg, #fef3c7);
    color: var(--warning, #92400e);
  }
  .tag.live {
    background: var(--success-bg, #dcfce7);
    color: var(--success, #166534);
  }
  .tag.verified-ok {
    background: var(--success-bg, #dcfce7);
    color: var(--success, #166534);
  }
  .tag.verified-bad {
    background: var(--danger-bg, #fef2f2);
    color: var(--danger, #991b1b);
  }
  .tag.warn {
    background: var(--warning-bg, #fef3c7);
    color: var(--warning, #92400e);
  }

  .hint-box {
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
    padding: 8px 10px;
    background: var(--bg-page, #f9fafb);
    border-radius: 6px;
  }
  .error-box {
    font-size: 12px;
    padding: 8px 10px;
    background: var(--danger-bg, #fef2f2);
    border: 1px solid var(--danger, #fca5a5);
    border-radius: 6px;
    color: var(--danger, #991b1b);
  }

  .audit-detail {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-top: 1px solid var(--border, #e5e7eb);
    padding-top: 10px;
  }
  .detail-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .detail-header h3 {
    font-size: 13px;
    font-weight: 700;
    margin: 0;
    color: var(--text-primary, #1f2937);
  }
  .loading-text {
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
  }
  .error-text {
    font-size: 12px;
    color: var(--danger, #991b1b);
  }

  .entries {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 420px;
    overflow: auto;
  }
  .entry {
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 6px;
    overflow: hidden;
  }
  .entry-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 4px 8px;
    background: var(--bg-page, #f9fafb);
    border: none;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    color: var(--text-primary, #1f2937);
    text-align: left;
  }
  .entry-row:hover {
    background: var(--brand-bg, #eff6ff);
  }
  .lt {
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary, #6b7280);
    min-width: 44px;
  }
  .ftype {
    font-weight: 700;
  }
  .fid {
    font-size: 11px;
    color: var(--text-secondary, #6b7280);
  }
  .expand-mark {
    margin-left: auto;
    color: var(--text-secondary, #6b7280);
  }
  .hash-line {
    display: flex;
    gap: 12px;
    padding: 2px 8px 4px;
    font-size: 10px;
    color: var(--text-secondary, #9ca3af);
    font-family: monospace;
    background: var(--bg-page, #f9fafb);
  }

  .content-detail {
    padding: 6px 8px;
    border-top: 1px dashed var(--border, #e5e7eb);
  }
  .llm-detail {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .detail-label {
    font-size: 11px;
    color: var(--text-secondary, #4b5563);
  }
  .json-block {
    margin: 0;
    padding: 6px 8px;
    background: var(--bg-page, #f8fafc);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 4px;
    font-size: 11px;
    font-family: monospace;
    max-height: 220px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-primary, #1f2937);
  }
</style>
