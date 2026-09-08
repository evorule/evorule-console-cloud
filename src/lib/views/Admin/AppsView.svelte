<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:平台应用凭据管理页(58 号专项 W3)
    - 应用列表(server GET /api/platform/apps,manage_apps 可读)
    - 签发应用凭据 / 吊销(manage_apps;server 端二次校验)
  设计:
    - 数据唯一来源是 evorule-server;demo 登录无服务端 → 页面不可达(路由守卫拦截)
    - key 明文仅签发响应返回一次(遗失只能吊销后换新 app_id 重签,身份不复用),
      前端在签发成功弹窗一次性展示 + 复制,不落任何持久状态
    - 错误如实提示(403 权限不足 / 409 冲突 / 网络不可达),不静默降级
-->

<script lang="ts">
  import { onMount } from "svelte";
  import {
    listApps,
    issueApp,
    revokeApp,
    PlatformAuthError,
    type PlatformAppView,
  } from "$lib/backend/platform-auth-api";
  import { netConfig } from "$lib/config/net-config";
  import { currentUser, hasPermission } from "$lib/stores/auth";
  import { toastSuccess, toastError } from "$lib/stores/toast";

  /** 页面动作全部需要 manage_apps(server 列表端点本身即该权限点门控) */
  const canManage = $derived(hasPermission($currentUser, "manage_apps"));

  let apps = $state<PlatformAppView[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let busy = $state(false);

  // === 弹窗状态 ===
  let showCreate = $state(false);
  let revokeTarget = $state<PlatformAppView | null>(null);
  /** 签发成功结果(key 明文仅此一次展示;关闭即不可再取) */
  let issuedKey = $state<{ appId: string; key: string } | null>(null);
  let keyCopied = $state(false);

  // === 签发表单 ===
  let cAppId = $state("");
  let cDescription = $state("");

  function statusLabel(s: string): string {
    return s === "ACTIVE" ? "启用" : s === "REVOKED" ? "已吊销" : s;
  }

  function fmtDate(ms: number): string {
    if (!ms) return "—";
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return "—";
    }
  }

  function authErrMsg(e: unknown, fallback: string): string {
    if (e instanceof PlatformAuthError) {
      return e.status === 0 ? `无法连接 evorule-server,请确认 server 已启动` : e.message;
    }
    return fallback;
  }

  async function reload(): Promise<void> {
    const { remoteBaseUrl, authToken } = $netConfig;
    try {
      const r = await listApps(remoteBaseUrl, authToken);
      apps = r.apps;
      error = null;
    } catch (e) {
      error = authErrMsg(e, "加载应用列表失败");
    }
  }

  onMount(async () => {
    await reload();
    loading = false;
  });

  async function handleIssue(): Promise<void> {
    if (!cAppId.trim()) return;
    busy = true;
    try {
      const r = await issueApp($netConfig.remoteBaseUrl, $netConfig.authToken, {
        appId: cAppId.trim(),
        description: cDescription.trim(),
      });
      toastSuccess(`应用凭据 ${r.appId} 已签发`, "应用管理");
      showCreate = false;
      cAppId = "";
      cDescription = "";
      keyCopied = false;
      issuedKey = { appId: r.appId, key: r.key };
      await reload();
    } catch (e) {
      toastError(authErrMsg(e, "签发应用凭据失败"), "应用管理");
    } finally {
      busy = false;
    }
  }

  async function handleRevokeConfirm(): Promise<void> {
    if (!revokeTarget) return;
    const id = revokeTarget.appId;
    busy = true;
    try {
      await revokeApp($netConfig.remoteBaseUrl, $netConfig.authToken, id);
      toastSuccess(`应用 ${id} 已吊销(下一请求即 401)`, "应用管理");
      revokeTarget = null;
      await reload();
    } catch (e) {
      toastError(authErrMsg(e, "吊销应用凭据失败"), "应用管理");
    } finally {
      busy = false;
    }
  }

  async function copyKey(): Promise<void> {
    if (!issuedKey) return;
    try {
      await navigator.clipboard.writeText(issuedKey.key);
      keyCopied = true;
    } catch {
      toastError("复制失败,请手动选中复制", "应用管理");
    }
  }
</script>

<section class="apps-page">
  <header class="page-header">
    <h2>🔑 应用管理</h2>
    <span class="page-count">{apps.length} 个应用</span>
    {#if canManage}
      <button class="btn btn-primary" onclick={() => (showCreate = true)} disabled={busy}>
        + 签发应用凭据
      </button>
    {:else}
      <span class="readonly-note">管理需 manage_apps 权限</span>
    {/if}
  </header>

  {#if loading}
    <div class="page-empty">⏳ 加载应用列表...</div>
  {:else if error}
    <div class="page-error">⚠️ {error}</div>
  {:else}
    <div class="app-table-wrap">
      <table class="app-table">
        <thead>
          <tr>
            <th>应用 ID</th>
            <th>描述</th>
            <th>状态</th>
            <th>签发时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {#each apps as a (a.appId)}
            <tr class:disabled-row={a.status === 'REVOKED'}>
              <td class="mono">{a.appId}</td>
              <td class="dim">{a.description || '—'}</td>
              <td>
                <span class="status-chip" class:off={a.status !== 'ACTIVE'}>
                  {statusLabel(a.status)}
                </span>
              </td>
              <td class="dim">{fmtDate(a.createdAtMs)}</td>
              <td class="row-actions">
                {#if canManage}
                  {#if a.status === 'ACTIVE'}
                    <button class="btn btn-sm btn-danger" onclick={() => (revokeTarget = a)} disabled={busy}>
                      吊销
                    </button>
                  {:else}
                    <span class="dim">—</span>
                  {/if}
                {:else}
                  <span class="dim">—</span>
                {/if}
              </td>
            </tr>
          {/each}
          {#if apps.length === 0}
            <tr>
              <td colspan="5" class="empty-row">尚无应用凭据,点击右上角签发。</td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
    <p class="page-hint">
      应用 key 明文仅签发时返回一次,服务端只存哈希;遗失只能吊销后换新 app_id 重签(身份不复用,保审计归因连续)。
      外部应用以 `Authorization: Bearer &lt;key&gt;` 调用 evorule-server,请求按 app_id 归因入审计链。
    </p>
  {/if}
</section>

<!-- 签发应用凭据弹窗 -->
{#if showCreate}
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="签发应用凭据">
    <div class="modal">
      <h3>签发应用凭据</h3>
      <label class="field">
        <span>应用 ID(字母/数字/_-.,1-64 位,全局唯一且不可复用)</span>
        <input type="text" bind:value={cAppId} placeholder="如 evo-agent" required />
      </label>
      <label class="field">
        <span>描述(用途/负责人等,便于审计回溯)</span>
        <input type="text" bind:value={cDescription} placeholder="如 财务助手接入" />
      </label>
      <div class="modal-actions">
        <button class="btn" onclick={() => (showCreate = false)} disabled={busy}>取消</button>
        <button class="btn btn-primary" onclick={handleIssue} disabled={busy || !cAppId.trim()}>
          {busy ? '签发中…' : '签发'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- 签发成功:key 仅此一次展示 -->
{#if issuedKey}
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="应用凭据已签发">
    <div class="modal">
      <h3>已签发:{issuedKey.appId}</h3>
      <p class="warn-note">
        ⚠️ 应用 key 明文<b>仅此一次</b>展示,关闭后不可再取(服务端只存哈希)。请立即复制并妥善保存。
      </p>
      <pre class="key-box">{issuedKey.key}</pre>
      <div class="modal-actions">
        <button class="btn" onclick={copyKey} disabled={keyCopied}>
          {keyCopied ? '已复制' : '复制 key'}
        </button>
        <button class="btn btn-primary" onclick={() => (issuedKey = null)}>我已保存,关闭</button>
      </div>
    </div>
  </div>
{/if}

<!-- 吊销确认弹窗 -->
{#if revokeTarget}
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="吊销应用凭据">
    <div class="modal">
      <h3>吊销应用 {revokeTarget.appId}?</h3>
      <p class="danger-note">
        吊销即时生效:该应用下一请求即 401。此操作记入审计链(app_revoked 事件)。
      </p>
      <div class="modal-actions">
        <button class="btn" onclick={() => (revokeTarget = null)} disabled={busy}>取消</button>
        <button class="btn btn-danger" onclick={handleRevokeConfirm} disabled={busy}>
          {busy ? '吊销中…' : '确认吊销'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .apps-page {
    max-width: 960px;
    margin: 0 auto;
    padding: 24px;
  }
  .page-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }
  .page-header h2 {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
  }
  .page-count {
    font-size: 13px;
    color: var(--text-secondary);
  }
  .page-header .btn-primary {
    margin-left: auto;
  }
  .readonly-note {
    margin-left: auto;
    font-size: 12px;
    color: var(--text-muted);
  }
  .page-empty {
    padding: 48px;
    text-align: center;
    color: var(--text-secondary);
    background: var(--bg-card);
    border-radius: 8px;
  }
  .page-error {
    padding: 48px;
    text-align: center;
    color: var(--danger);
    background: var(--bg-card);
    border-radius: 8px;
  }
  .page-hint {
    margin-top: 12px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .app-table-wrap {
    background: var(--bg-card);
    border-radius: 8px;
    overflow-x: auto;
  }
  .app-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .app-table th {
    text-align: left;
    padding: 10px 12px;
    color: var(--text-secondary);
    font-weight: 500;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .app-table td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .app-table tr:last-child td {
    border-bottom: none;
  }
  .empty-row {
    text-align: center;
    color: var(--text-secondary);
    padding: 32px 12px;
  }
  .disabled-row {
    opacity: 0.55;
  }
  .mono {
    font-family: monospace;
  }
  .dim {
    color: var(--text-secondary);
  }
  .status-chip {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
    background: var(--success-bg);
    color: var(--success);
    white-space: nowrap;
  }
  .status-chip.off {
    background: var(--warning-bg);
    color: var(--warning);
  }
  .row-actions {
    display: flex;
    gap: 6px;
    white-space: nowrap;
  }
  .btn {
    padding: 6px 14px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-primary {
    background: var(--brand, #2563eb);
    color: #fff;
  }
  .btn-danger {
    background: var(--danger);
    color: #fff;
  }
  .modal-mask {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }
  .modal {
    background: var(--bg-card);
    padding: 24px;
    border-radius: 8px;
    width: 90%;
    max-width: 520px;
    max-height: 86vh;
    overflow-y: auto;
  }
  .modal h3 {
    margin: 0 0 16px;
    font-size: 16px;
  }
  .warn-note {
    font-size: 13px;
    color: var(--warning);
    background: var(--warning-bg);
    border-radius: 6px;
    padding: 10px 12px;
  }
  .danger-note {
    font-size: 13px;
    color: var(--danger);
    background: var(--danger-bg);
    border-radius: 6px;
    padding: 10px 12px;
  }
  .key-box {
    font-family: monospace;
    font-size: 13px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
    word-break: break-all;
    white-space: pre-wrap;
    margin: 12px 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  .field span {
    font-size: 12px;
    color: var(--text-secondary);
  }
  .field input {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 13px;
    background: var(--bg-input);
    color: var(--text-primary);
  }
  .modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 8px;
  }
</style>
