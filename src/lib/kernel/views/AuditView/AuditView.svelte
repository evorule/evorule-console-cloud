<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 EvoRule Project
  evorule-console 审计视图 — 模态化 (阶段 D.1.4 重写)
-->
<!--
  依据: 设计文档/01_界面升级.txt §三.4 + 04_时间旅行+审计链.txt
        实施文档_界面升级_v1.0.md §D.1.4
  职责 (模态结构):
    - 标题: 🔗 审计链 · Fact #{factId} (无 factId 时显示整链摘要)
    - 4 行哈希: prev_hash / content_hash / logical_time / 规则指纹(待立项占位)
    - 辅助墙钟: 标注"应用层时间"(来自 wall-clock 旁路,不进审计链)
    - 完整性徽章: VerdictBadge chain-verified/broken + 复制哈希按钮
    - 因果链列表: fact 非空时展示从根到本 fact 的因果链
  双模式渲染:
    - onclose 存在 (StateView 控制): 固定 overlay 模态, ESC/点击外部/关闭按钮 → onclose
    - onclose 缺失 (audit tab 独立渲染 <AuditView />): 内联全页, 无 overlay
  边界 (00 §六):
    - 哈希链验证 = evorule 确定性信号 (chain-verified/broken)
    - 墙钟 = 应用层旁路 (不进审计链哈希)
    - 规则指纹 = 待立项 (Fact 不记录 rule_id, 命中追溯独立立项)
-->

<script lang="ts">
  import {
    auditData,
    verifyResult,
    causalSelection,
    auditLoading,
    auditError,
    refreshAudit,
    verifyAuditChain,
    fetchCausalChain,
    clearCausalSelection,
  } from "$lib/kernel/stores/audit";
  import { currentSessionId } from "$lib/kernel/stores/session";
  import { useBackendOrNull } from "$lib/kernel/backend/backend-context";
  import type { CausalEntry } from "$lib/kernel/backend/types";
  import VerdictBadge from "$lib/kernel/components/VerdictBadge.svelte";

  interface Props {
    /** 是否展开 (默认 true, 兼容 audit tab 独立渲染) */
    open?: boolean;
    /** 模态展示的 fact id (null = 整链摘要) */
    factId?: number | null;
    /** 关闭回调 (存在时 = overlay 模态; 缺失时 = 内联全页) */
    onclose?: () => void;
  }

  let { open = true, factId = null, onclose }: Props = $props();

  const backend = useBackendOrNull();
  const isModal = $derived(typeof onclose === "function");

  /** 复制反馈 */
  let copied = $state<string | null>(null);

  // === 模态打开时确保审计数据已加载 ===
  $effect(() => {
    if (!open) return;
    const sid = $currentSessionId;
    if (backend && sid !== null && !$auditData) {
      refreshAudit(backend, sid);
    }
  });

  // === factId 变化时拉因果链 ===
  $effect(() => {
    if (!open) return;
    const fid = factId;
    const sid = $currentSessionId;
    if (backend && sid !== null && fid !== null) {
      fetchCausalChain(backend, sid, fid);
    }
  });

  /** 把 entries(unknown[]) 当作 CausalEntry[] */
  function asCausalEntries(entries: unknown[]): CausalEntry[] {
    return entries.filter((e): e is CausalEntry => {
      if (!e || typeof e !== "object") return false;
      const c = e as Record<string, unknown>;
      return typeof c.fact_id === "number" && typeof c.fact_type === "string";
    });
  }

  function truncateHash(hash: string | undefined | null): string {
    if (!hash) return "—";
    if (hash.length <= 16) return hash;
    return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
  }

  function typeShort(t: string): string {
    return t
      .replace("StateTransition", "迁移")
      .replace("PayloadUpdate", "更新")
      .replace("IoRequest", "IO请求")
      .replace("IoResponse", "IO响应")
      .replace("Command", "命令");
  }

  function entrySummary(entry: CausalEntry): string {
    const lt = entry.logical_time;
    return lt != null ? `${typeShort(entry.fact_type)} · t${lt}` : typeShort(entry.fact_type);
  }

  /** 当前聚焦的 fact (从 auditData 找 factId 对应条目) */
  let focusedFact = $derived<CausalEntry | null>(
    factId !== null && $auditData
      ? asCausalEntries($auditData.entries).find((e) => e.fact_id === factId) ?? null
      : null
  );

  let facts = $derived($auditData ? asCausalEntries($auditData.entries) : []);
  let chainVerified = $derived($auditData?.verified ?? false);

  async function handleVerify() {
    if (!backend) return;
    const sid = $currentSessionId;
    if (sid === null) return;
    await verifyAuditChain(backend, sid);
  }

  async function handleCopyHash(hash: string | undefined | null) {
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      copied = hash;
      setTimeout(() => (copied = null), 1500);
    } catch {
      // 剪贴板不可用, 忽略
    }
  }

  function handleClose() {
    onclose?.();
  }

  /** ESC 关闭 (仅模态) */
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && isModal) {
      handleClose();
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if (!isModal) return;
    if (e.target === e.currentTarget) handleClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- 模态: overlay; 内联: 全页容器 -->
  <div
    class={isModal ? "audit-overlay" : "audit-inline"}
    onclick={handleOverlayClick}
    role={isModal ? "dialog" : undefined}
    aria-modal={isModal ? "true" : undefined}
    aria-label="审计链详情"
  >
    <div class="audit-modal">
      <!-- === 标题栏 === -->
      <header class="modal-header">
        <h2>
          🔗 审计链
          {#if factId !== null}
            · Fact #{factId}
          {/if}
        </h2>
        {#if isModal}
          <button class="close-btn" onclick={handleClose} aria-label="关闭">✕</button>
        {/if}
      </header>

      <!-- === 主体 === -->
      <div class="modal-body">
        {#if !backend}
          <div class="empty-mini">backend 未注入</div>
        {:else if $currentSessionId === null}
          <div class="empty-mini">无当前 session</div>
        {:else if $auditError}
          <div class="inline-error">{$auditError}</div>
        {:else if !$auditData}
          <div class="empty-mini">{$auditLoading ? "加载审计链中…" : "无审计数据"}</div>
        {:else}
          <!-- === 摘要 === -->
          <section class="summary-row">
            <div class="summary-item">
              <span class="summary-label">session</span>
              <span class="summary-value mono">{$currentSessionId}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">fact_count</span>
              <span class="summary-value mono">{$auditData.fact_count}</span>
            </div>
            <div class="summary-item">
              <VerdictBadge
                kind={chainVerified ? "chain-verified" : "chain-broken"}
                value={chainVerified ? "链已验证" : "链未验证"}
              />
            </div>
            <button class="btn-secondary btn-verify" onclick={handleVerify} disabled={$auditLoading}>
              验证哈希链
            </button>
          </section>

          {#if $verifyResult}
            <section class="verify-detail" class:ok={$verifyResult.verified} class:bad={!$verifyResult.verified}>
              <span>{$verifyResult.verified ? "✅ 哈希链完整" : "❌ 哈希链断裂"}</span>
              {#if $verifyResult.detail}
                <pre class="verify-text">{$verifyResult.detail}</pre>
              {/if}
            </section>
          {/if}

          <!-- === 聚焦 Fact 的哈希详情 === -->
          {#if focusedFact}
            <section class="hash-panel">
              <h3>Fact #{focusedFact.fact_id} 哈希</h3>
              <dl class="hash-list">
                <div class="hash-row">
                  <dt>prev_hash</dt>
                  <dd class="mono" title={focusedFact.prev_hash ?? ""}>
                    {truncateHash(focusedFact.prev_hash)}
                  </dd>
                  <button
                    class="btn-copy"
                    onclick={() => handleCopyHash(focusedFact.prev_hash)}
                    disabled={!focusedFact.prev_hash}
                  >
                    {copied === focusedFact.prev_hash ? "✓" : "复制"}
                  </button>
                </div>
                <div class="hash-row">
                  <dt>content_hash</dt>
                  <dd class="mono" title={focusedFact.content_hash ?? ""}>
                    {truncateHash(focusedFact.content_hash)}
                  </dd>
                  <button
                    class="btn-copy"
                    onclick={() => handleCopyHash(focusedFact.content_hash)}
                    disabled={!focusedFact.content_hash}
                  >
                    {copied === focusedFact.content_hash ? "✓" : "复制"}
                  </button>
                </div>
                <div class="hash-row">
                  <dt>logical_time</dt>
                  <dd class="mono">t{focusedFact.logical_time}</dd>
                </div>
                <div class="hash-row">
                  <dt>规则指纹</dt>
                  <dd class="placeholder">待立项(Fact 不记录 rule_id)</dd>
                </div>
                <div class="hash-row">
                  <dt>辅助墙钟</dt>
                  <dd class="placeholder">
                    应用层时间(wall-clock 旁路,不进审计链哈希)
                  </dd>
                </div>
              </dl>
              <div class="integrity-row">
                <VerdictBadge
                  kind={chainVerified ? "chain-verified" : "chain-broken"}
                  value={chainVerified ? "完整性验证通过" : "完整性验证失败"}
                />
              </div>
            </section>
          {/if}

          <!-- === 因果链 (factId 非空时) === -->
          {#if factId !== null && $causalSelection}
            <section class="causal-section">
              <h3>因果链 (Fact #{$causalSelection.factId})</h3>
              <p class="section-hint">
                共 {$causalSelection.chain.length} 条前因(从根到本 fact)
              </p>
              {#if $causalSelection.chain.length === 0}
                <div class="empty-mini">无前因(可能是根 fact)</div>
              {:else}
                <ol class="causal-list">
                  {#each $causalSelection.chain as cf (cf.fact_id)}
                    <li class="causal-item">
                      <span class="mono causal-id">#{cf.fact_id}</span>
                      <span class="causal-type">{typeShort(cf.fact_type)}</span>
                      <span class="causal-summary">{entrySummary(cf)}</span>
                    </li>
                  {/each}
                </ol>
              {/if}
            </section>
          {/if}

          <!-- === 审计链条目列表 (无聚焦 fact 时展示整链) === -->
          {#if factId === null}
            <section class="entries-section">
              <h3>审计链 ({facts.length} 条 Fact)</h3>
              <p class="section-hint">点击 Fact 查看详情(在状态视图 Fact 流中点击)</p>
              {#if facts.length === 0}
                <div class="empty-mini">审计链为空</div>
              {:else}
                <ul class="entry-list">
                  {#each facts as f (f.fact_id)}
                    <li class="entry-item">
                      <span class="mono entry-id">#{f.fact_id}</span>
                      <span class="entry-type">{typeShort(f.fact_type)}</span>
                      <span class="entry-summary">{entrySummary(f)}</span>
                      <span class="mono entry-hash" title={f.content_hash ?? ""}>
                        {truncateHash(f.content_hash)}
                      </span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </section>
          {/if}

          <!-- === TCB 边界说明 === -->
          <section class="tcb-note">
            <h3>TCB 纯净 · 边界标注</h3>
            <ul>
              <li>哈希计算与验证在 evorule 核心(tier1)完成,前端仅展示结果。</li>
              <li>墙钟时间为应用层旁路,不进审计链哈希(00 §六/§七)。</li>
              <li>规则指纹待立项:Fact 不记录 rule_id,命中追溯独立立项。</li>
            </ul>
          </section>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* === 模态 overlay === */
  .audit-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: overlay-fade var(--transition-normal) ease-out;
  }

  @keyframes overlay-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* === 内联全页 (audit tab) === */
  .audit-inline {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    padding: var(--spacing-lg);
  }

  .audit-modal {
    background: var(--bg-card);
    border: var(--card-border);
    border-radius: var(--radius-md);
    width: 90vw;
    max-width: 880px;
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: modal-fade var(--transition-normal) ease-out;
  }

  .audit-inline .audit-modal {
    width: 100%;
    max-width: 100%;
    max-height: none;
    border: none;
    background: transparent;
    animation: none;
  }

  @keyframes modal-fade {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* === 标题栏 === */
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-sm) var(--spacing-md);
    border-bottom: 1px solid var(--border);
    background: var(--bg-primary);
  }

  .modal-header h2 {
    margin: 0;
    font-size: var(--text-base);
    color: var(--text-primary);
    font-weight: var(--font-semibold);
    font-family: var(--font-mono);
  }

  .close-btn {
    background: transparent;
    border: none;
    font-size: var(--text-lg);
    color: var(--text-secondary);
    cursor: pointer;
    padding: 2px var(--spacing-xs);
    border-radius: var(--radius-sm);
    line-height: 1;
  }

  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* === 主体 === */
  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--spacing-md);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  /* === 摘要行 === */
  .summary-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    flex-wrap: wrap;
  }

  .summary-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .summary-label {
    font-size: 10px;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .summary-value {
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .btn-verify {
    margin-left: auto;
  }

  /* === verify 详情 === */
  .verify-detail {
    padding: var(--spacing-sm) var(--spacing-md);
    border: 1px solid var(--border);
    border-left: 4px solid var(--text-secondary);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
  }

  .verify-detail.ok {
    border-left-color: var(--success);
    color: var(--success);
  }

  .verify-detail.bad {
    border-left-color: var(--danger);
    color: var(--danger);
  }

  .verify-text {
    margin: var(--spacing-xs) 0 0;
    padding: var(--spacing-xs);
    background: var(--bg-primary);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    white-space: pre-wrap;
    overflow-x: auto;
    color: var(--text-secondary);
  }

  /* === 哈希面板 === */
  .hash-panel h3,
  .causal-section h3,
  .entries-section h3,
  .tcb-note h3 {
    margin: 0 0 var(--spacing-sm) 0;
    font-size: var(--text-sm);
    color: var(--text-primary);
    font-weight: var(--font-semibold);
  }

  .hash-list {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .hash-row {
    display: grid;
    grid-template-columns: 110px 1fr auto;
    gap: var(--spacing-sm);
    align-items: center;
    padding: var(--spacing-xs) var(--spacing-sm);
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .hash-row dt {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    font-weight: var(--font-medium);
    font-family: var(--font-mono);
  }

  .hash-row dd {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hash-row dd.placeholder {
    color: var(--text-secondary);
    font-style: italic;
  }

  .btn-copy {
    padding: 1px var(--spacing-sm);
    font-size: 10px;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-family: var(--font-sans);
  }

  .btn-copy:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .btn-copy:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .integrity-row {
    margin-top: var(--spacing-sm);
  }

  /* === 因果链 === */
  .causal-list {
    list-style: decimal;
    margin: 0;
    padding: 0 var(--spacing-md) 0 var(--spacing-xl);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .causal-item {
    display: flex;
    gap: var(--spacing-sm);
    align-items: center;
    font-size: var(--text-xs);
    color: var(--text-primary);
    padding: var(--spacing-xs) 0;
    border-bottom: 1px solid var(--border);
  }

  .causal-item:last-child {
    border-bottom: none;
  }

  .causal-id {
    font-weight: var(--font-semibold);
    min-width: 56px;
  }

  .causal-type {
    padding: 1px var(--spacing-xs);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: 10px;
  }

  .causal-summary {
    flex: 1;
    color: var(--text-secondary);
  }

  /* === 条目列表 === */
  .entry-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .entry-item {
    display: flex;
    gap: var(--spacing-sm);
    align-items: center;
    padding: var(--spacing-xs) var(--spacing-sm);
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
  }

  .entry-id {
    font-weight: var(--font-semibold);
    min-width: 56px;
    color: var(--text-primary);
  }

  .entry-type {
    padding: 1px var(--spacing-xs);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: 10px;
  }

  .entry-summary {
    flex: 1;
    color: var(--text-secondary);
  }

  .entry-hash {
    color: var(--text-secondary);
    font-size: 10px;
  }

  /* === TCB 说明 === */
  .tcb-note {
    padding: var(--spacing-sm) var(--spacing-md);
    background: color-mix(in srgb, var(--warning) 6%, var(--bg-card));
    border: 1px solid var(--warning);
    border-radius: var(--radius-md);
  }

  .tcb-note ul {
    margin: 0;
    padding-left: var(--spacing-lg);
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .tcb-note li {
    padding: 2px 0;
  }

  /* === 通用 === */
  .section-hint {
    margin: 0 0 var(--spacing-sm) 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .empty-mini {
    padding: var(--spacing-md);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    text-align: center;
  }

  .inline-error {
    padding: var(--spacing-md);
    color: var(--danger);
    font-size: var(--text-sm);
  }

  .mono {
    font-family: var(--font-mono);
  }
</style>
