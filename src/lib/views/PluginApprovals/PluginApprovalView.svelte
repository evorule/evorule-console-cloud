<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:插件审批面 — 按 external 插件分组展示待批提案 + approve/reject 操作(权限守卫)
  依赖:cloud-http-backend.ts / auth.ts / toast.ts
  关联设计:治理审批面统一 — 与发布审批同一范式(approver 由 server 强制注入)

  数据通道(单通道,无本地旁路):
    - 插件清单:GET /api/health(plugins 节,过滤 external===true,随探活状态呈现)
    - 提案列表:GET /api/plugins/{id}/admin/proposals(server 代理 → 插件自持管理面)
    - 审批操作:POST .../approve | .../reject(server 代理强制注入 approver=平台登录身份)
  错误语义(与 server 对齐,区分展示不静默):
    404 未知/非 external 插件 · 502 插件管理面不可达 · 503 server 未配置该插件 admin token
-->

<script lang="ts">
  import { onMount } from 'svelte';
  import { useBackend } from '$lib/kernel';
  import { CloudHttpBackend } from '$lib/backend/cloud-http-backend';
  import type { ExternalPluginInfo, PluginProposal } from '$lib/backend/cloud-http-backend';
  import { can, currentUser } from '$lib/stores/auth';
  import { toastSuccess, toastError } from '$lib/stores/toast';
  import { fmtDateTime } from '$lib/locale';

  let plugins = $state<ExternalPluginInfo[]>([]);
  /** 插件 id → 待批提案(插件离线/不可达时为 null,与空列表区分) */
  let proposals = $state<Record<string, PluginProposal[] | null>>({});
  let loading = $state(true);
  let error = $state<string | null>(null);

  let rejectingPlugin = $state<string | null>(null);
  let rejectingProposal = $state<string | null>(null);
  let rejectReason = $state('');
  let actingProposal = $state<string | null>(null);

  const backend = useBackend() as CloudHttpBackend;
  const canApprove = $derived(can('approve_publish'));

  /** 探活状态徽标(与 /api/health external 插件节一致;undefined = 探活未运行) */
  function statusLabel(s?: string): string {
    if (s === 'online') return '在线';
    if (s === 'offline') return '离线';
    if (s === 'no_probe') return '未探测';
    return '—';
  }
  function statusClass(s?: string): string {
    return s ? `plugin-status-${s}` : 'plugin-status-unknown';
  }

  function fmtTime(raw: string): string {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? raw : fmtDateTime(d);
  }

  /** new_value 原文 → pretty JSON(解析失败时原样展示,不静默) */
  function prettyValue(v: unknown): string {
    if (v === null || v === undefined) return '(空)';
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }

  async function loadProposalsFor(id: string): Promise<void> {
    try {
      const res = await backend.listPluginProposals(id);
      proposals[id] = Array.isArray(res?.pending) ? res.pending : [];
    } catch (e) {
      // 插件级失败不整页报错:该插件节显示不可用原因,其余插件继续
      proposals[id] = null;
      console.warn(`插件 ${id} 提案拉取失败`, e);
    }
  }

  async function reload(): Promise<void> {
    error = null;
    try {
      plugins = await backend.listExternalPlugins();
    } catch (e) {
      plugins = [];
      error = `无法获取插件清单(${backend.baseUrl}):${e instanceof Error && e.message ? e.message : '网络错误'}`;
      loading = false;
      return;
    }
    await Promise.all(plugins.map((p) => loadProposalsFor(p.id)));
    loading = false;
  }

  onMount(reload);

  async function handleApprove(pluginId: string, p: PluginProposal): Promise<void> {
    if (!confirm(`确认批准插件「${pluginId}」的配置提案 ${p.key}?此操作将生效并入插件审计。`)) return;
    actingProposal = p.proposal_id;
    try {
      await backend.approvePluginProposal(pluginId, p.proposal_id);
      toastSuccess(`已批准 ${p.key}`, '插件审批');
      await loadProposalsFor(pluginId);
    } catch (e) {
      toastError(e instanceof Error ? e.message : '批准失败', '插件审批');
    } finally {
      actingProposal = null;
    }
  }

  function openReject(pluginId: string, p: PluginProposal): void {
    rejectingPlugin = pluginId;
    rejectingProposal = p.proposal_id;
    rejectReason = '';
  }

  async function handleRejectConfirm(): Promise<void> {
    if (!rejectingPlugin || !rejectingProposal) return;
    const pid = rejectingPlugin;
    const reason = rejectReason.trim() || '未填写原因';
    actingProposal = rejectingProposal;
    try {
      await backend.rejectPluginProposal(pid, rejectingProposal, reason);
      toastSuccess('已拒绝提案', '插件审批');
      rejectingPlugin = null;
      rejectingProposal = null;
      rejectReason = '';
      await loadProposalsFor(pid);
    } catch (e) {
      toastError(e instanceof Error ? e.message : '拒绝失败', '插件审批');
    } finally {
      actingProposal = null;
    }
  }
</script>

<section class="plugin-approvals">
  <header class="page-header">
    <h2>🔌 插件审批</h2>
    <span class="actor-badge">
      审批人:{$currentUser?.username ?? '(未登录)'}
    </span>
  </header>
  <p class="governance-hint">
    ⚖️ 审批 = 治理动作:经 server 代理插件管理面,操作者身份由 server 强制注入(前端展示仅供参考),
    全部操作入插件自持审计,审计归属不变。
  </p>

  {#if loading}
    <div class="empty">⏳ 加载插件清单...</div>
  {:else if error}
    <div class="page-error">⚠️ {error}</div>
  {:else if plugins.length === 0}
    <div class="empty">
      📭 当前无 external 插件
      <p class="empty-hint">
        外部插件包经 plugin.json 声明装载后(见部署指南),其配置提案会出现在这里等待审批。
      </p>
    </div>
  {:else}
    {#each plugins as plugin (plugin.id)}
      {@const list = proposals[plugin.id]}
      <div class="plugin-section">
        <div class="plugin-header">
          <h3>{plugin.id}</h3>
          <span class="plugin-status {statusClass(plugin.status)}">
            {statusLabel(plugin.status)}
          </span>
        </div>

        {#if list === null}
          <div class="plugin-error">
            ⚠️ 该插件提案不可用(插件管理面不可达 / server 未配置其 admin token)
          </div>
        {:else if list.length === 0}
          <div class="plugin-empty">✅ 暂无待批提案</div>
        {:else}
          <div class="proposal-list">
            {#each list as p (p.proposal_id)}
              <div class="proposal-item">
                <div class="proposal-main">
                  <span class="proposal-key">{p.key}</span>
                  <span class="proposal-meta">
                    提案人:{p.proposed_by} · {fmtTime(p.created_at)}
                  </span>
                </div>
                <div class="proposal-value">
                  <span class="value-label">新值</span>
                  <pre>{prettyValue(p.new_value)}</pre>
                </div>
                {#if p.reason}
                  <div class="proposal-reason">理由:{p.reason}</div>
                {/if}
                {#if canApprove}
                  <div class="proposal-actions">
                    <button
                      class="btn btn-success"
                      disabled={actingProposal === p.proposal_id}
                      onclick={() => handleApprove(plugin.id, p)}
                    >
                      ✅ 批准
                    </button>
                    <button
                      class="btn btn-danger"
                      disabled={actingProposal === p.proposal_id}
                      onclick={() => openReject(plugin.id, p)}
                    >
                      ❌ 拒绝
                    </button>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  {/if}

  {#if rejectingPlugin && rejectingProposal}
    <div class="reject-modal" role="dialog" aria-modal="true">
      <div class="modal-content">
        <h3>拒绝插件提案</h3>
        <textarea
          bind:value={rejectReason}
          placeholder="请输入拒绝原因(入插件审计留痕)..."
          rows="3"
        ></textarea>
        <div class="modal-actions">
          <button class="btn btn-ghost" onclick={() => (rejectingPlugin = rejectingProposal = null)}>
            取消
          </button>
          <button class="btn btn-danger" onclick={handleRejectConfirm}>确认拒绝</button>
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .plugin-approvals {
    max-width: 900px;
    margin: 0 auto;
    padding: 24px;
  }
  .page-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }
  .page-header h2 {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
  }
  .actor-badge {
    font-size: 12px;
    padding: 2px 10px;
    border-radius: 10px;
    background: var(--bg-hover, #f1f5f9);
    color: var(--text-secondary, #64748b);
  }
  .governance-hint {
    font-size: 12px;
    color: var(--text-secondary, #64748b);
    margin: 0 0 20px;
  }
  .empty {
    padding: 48px;
    text-align: center;
    color: var(--text-secondary, #64748b);
    background: var(--bg-card);
    border-radius: 8px;
  }
  .empty-hint {
    margin: 8px auto 0;
    max-width: 460px;
    font-size: 13px;
    opacity: 0.85;
  }
  .page-error,
  .plugin-error {
    padding: 16px;
    text-align: center;
    color: var(--danger, #dc2626);
    background: var(--bg-card);
    border-radius: 8px;
    font-size: 13px;
  }
  .plugin-section {
    padding: 16px;
    background: var(--bg-card);
    border-radius: 8px;
    border-left: 4px solid var(--border, #cbd5e1);
    box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.1));
    margin-bottom: 12px;
  }
  .plugin-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }
  .plugin-header h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    font-family: monospace;
  }
  .plugin-status {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--bg-hover, #f1f5f9);
    color: var(--text-secondary, #64748b);
  }
  .plugin-status.plugin-status-online {
    background: var(--success-bg, #dcfce7);
    color: var(--success, #166534);
  }
  .plugin-status.plugin-status-offline {
    background: var(--danger-bg, #fee2e2);
    color: var(--danger, #991b1b);
  }
  .plugin-empty {
    font-size: 13px;
    color: var(--text-secondary, #64748b);
  }
  .proposal-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .proposal-item {
    padding: 12px;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 6px;
    background: var(--bg-page, #f8fafc);
  }
  .proposal-main {
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .proposal-key {
    font-weight: 600;
    font-family: monospace;
    font-size: 13px;
  }
  .proposal-meta {
    font-size: 12px;
    color: var(--text-secondary, #64748b);
  }
  .proposal-value {
    margin-bottom: 6px;
  }
  .value-label {
    font-size: 11px;
    color: var(--text-secondary, #64748b);
  }
  .proposal-value pre {
    margin: 4px 0 0;
    padding: 8px;
    background: var(--bg-card, #fff);
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 4px;
    font-size: 12px;
    overflow: auto;
    max-height: 160px;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .proposal-reason {
    font-size: 12px;
    color: var(--text-primary, #1e293b);
    margin-bottom: 6px;
  }
  .proposal-actions {
    display: flex;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--border, #e2e8f0);
  }
  .btn {
    padding: 6px 14px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-success {
    background: var(--success, #22c55e);
    color: white;
  }
  .btn-danger {
    background: var(--danger, #dc2626);
    color: white;
  }
  .btn-ghost {
    background: transparent;
    color: var(--text-secondary, #64748b);
    border: 1px solid var(--border, #cbd5e1);
  }
  .reject-modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }
  .modal-content {
    background: var(--bg-card);
    padding: 24px;
    border-radius: 8px;
    width: 90%;
    max-width: 480px;
  }
  .modal-content h3 {
    margin: 0 0 16px 0;
    font-size: 16px;
  }
  .modal-content textarea {
    width: 100%;
    padding: 8px;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 4px;
    font-size: 13px;
    resize: vertical;
    margin-bottom: 16px;
  }
  .modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
</style>
