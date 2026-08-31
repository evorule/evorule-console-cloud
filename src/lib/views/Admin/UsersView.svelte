<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:平台用户管理页(UV-017 W4b)
    - 用户列表(server /api/platform/users,view_users 或 manage_users 可读)
    - 创建用户 / 编辑档案与角色 / 启停 / 删除(manage_users;server 端二次校验)
  设计:
    - 数据唯一来源是 evorule-server;demo 登录无服务端 → 显示引导而非空表
    - 自我保护(不能停用/删除自己)由 server 强制,前端仅隐藏按钮减少误操作
    - 错误如实提示(403 权限不足 / 409 冲突 / 网络不可达),不静默降级
-->

<script lang="ts">
  import { onMount } from "svelte";
  import {
    listUsers,
    createUser,
    updateUser,
    deleteUser,
    listRoles,
    PlatformAuthError,
    type PlatformUserView,
    type PlatformRoleView,
  } from "$lib/backend/platform-auth-api";
  import { netConfig } from "$lib/config/net-config";
  import { currentUser, hasPermission, PLATFORM_ROLE_LABELS } from "$lib/stores/auth";
  import { toastSuccess, toastError } from "$lib/stores/toast";

  /** 是否可管理(manage_users);仅 view_users 时页面为只读视图(与 server 403 语义一致) */
  const canManage = $derived(hasPermission($currentUser, "manage_users"));

  let users = $state<PlatformUserView[]>([]);
  let roles = $state<PlatformRoleView[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let busy = $state(false);

  // 当前登录名(自我保护:不渲染对自己的 停用/删除 按钮)
  const myUsername = $derived($currentUser?.username ?? "");

  // === 弹窗状态 ===
  let showCreate = $state(false);
  let editTarget = $state<PlatformUserView | null>(null);
  let deleteTarget = $state<PlatformUserView | null>(null);

  // === 创建表单 ===
  let cUsername = $state("");
  let cPassword = $state("");
  let cDisplayName = $state("");
  let cEmail = $state("");
  let cDepartment = $state("");
  let cRole = $state("");

  // === 编辑表单 ===
  let eDisplayName = $state("");
  let eEmail = $state("");
  let eDepartment = $state("");
  let eRole = $state("");

  function roleLabel(name: string): string {
    return PLATFORM_ROLE_LABELS[name] ?? name;
  }

  function statusLabel(s: string): string {
    return s === "ACTIVE" ? "启用" : s === "DISABLED" ? "停用" : s;
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
      const [u, r] = await Promise.all([
        listUsers(remoteBaseUrl, authToken),
        listRoles(remoteBaseUrl, authToken),
      ]);
      users = u.users;
      roles = r.roles;
      if (!cRole && r.roles.length > 0) cRole = "viewer";
      error = null;
    } catch (e) {
      error = authErrMsg(e, "加载用户列表失败");
    }
  }

  onMount(async () => {
    await reload();
    loading = false;
  });

  async function handleCreate(): Promise<void> {
    if (!cUsername.trim() || cPassword.length < 8 || !cRole) return;
    busy = true;
    try {
      await createUser($netConfig.remoteBaseUrl, $netConfig.authToken, {
        username: cUsername.trim(),
        password: cPassword,
        displayName: cDisplayName.trim() || cUsername.trim(),
        email: cEmail.trim(),
        department: cDepartment.trim(),
        role: cRole,
      });
      toastSuccess(`用户 ${cUsername.trim()} 已创建`, "用户管理");
      showCreate = false;
      cUsername = ""; cPassword = ""; cDisplayName = ""; cEmail = ""; cDepartment = "";
      await reload();
    } catch (e) {
      toastError(authErrMsg(e, "创建用户失败"), "用户管理");
    } finally {
      busy = false;
    }
  }

  function openEdit(u: PlatformUserView): void {
    editTarget = u;
    eDisplayName = u.displayName;
    eEmail = u.email;
    eDepartment = u.department;
    eRole = u.role;
  }

  async function handleSaveEdit(): Promise<void> {
    if (!editTarget) return;
    busy = true;
    try {
      await updateUser($netConfig.remoteBaseUrl, $netConfig.authToken, editTarget.username, {
        displayName: eDisplayName.trim(),
        email: eEmail.trim(),
        department: eDepartment.trim(),
        role: eRole,
      });
      toastSuccess(`用户 ${editTarget.username} 已更新`, "用户管理");
      editTarget = null;
      await reload();
    } catch (e) {
      toastError(authErrMsg(e, "更新用户失败"), "用户管理");
    } finally {
      busy = false;
    }
  }

  async function toggleStatus(u: PlatformUserView): Promise<void> {
    const next = u.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    busy = true;
    try {
      await updateUser($netConfig.remoteBaseUrl, $netConfig.authToken, u.username, {
        status: next,
      });
      toastSuccess(
        next === "DISABLED" ? `用户 ${u.username} 已停用(会话立即失效)` : `用户 ${u.username} 已启用`,
        "用户管理"
      );
      await reload();
    } catch (e) {
      toastError(authErrMsg(e, "状态变更失败"), "用户管理");
    } finally {
      busy = false;
    }
  }

  async function handleDeleteConfirm(): Promise<void> {
    if (!deleteTarget) return;
    const name = deleteTarget.username;
    busy = true;
    try {
      await deleteUser($netConfig.remoteBaseUrl, $netConfig.authToken, name);
      toastSuccess(`用户 ${name} 已删除(全部会话立即失效)`, "用户管理");
      deleteTarget = null;
      await reload();
    } catch (e) {
      toastError(authErrMsg(e, "删除用户失败"), "用户管理");
    } finally {
      busy = false;
    }
  }
</script>

<section class="users-page">
  <header class="page-header">
    <h2>👥 用户管理</h2>
    <span class="page-count">{users.length} 个账号</span>
    {#if canManage}
      <button class="btn btn-primary" onclick={() => (showCreate = true)} disabled={busy}>
        + 创建用户
      </button>
    {:else}
      <span class="readonly-note">只读(view_users) · 管理需 manage_users</span>
    {/if}
  </header>

  {#if loading}
    <div class="page-empty">⏳ 加载用户列表...</div>
  {:else if error}
    <div class="page-error">⚠️ {error}</div>
  {:else}
    <div class="user-table-wrap">
      <table class="user-table">
        <thead>
          <tr>
            <th>用户名</th>
            <th>显示名</th>
            <th>邮箱</th>
            <th>部门</th>
            <th>角色</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {#each users as u (u.username)}
            <tr class:disabled-row={u.status === 'DISABLED'}>
              <td class="mono">{u.username}</td>
              <td>{u.displayName || '—'}</td>
              <td class="dim">{u.email || '—'}</td>
              <td class="dim">{u.department || '—'}</td>
              <td><span class="role-chip">{roleLabel(u.role)}</span></td>
              <td>
                <span class="status-chip" class:off={u.status === 'DISABLED'}>
                  {statusLabel(u.status)}
                </span>
              </td>
              <td class="row-actions">
                {#if canManage}
                  <button class="btn btn-sm" onclick={() => openEdit(u)} disabled={busy}>编辑</button>
                  {#if u.username !== myUsername}
                    <button class="btn btn-sm" onclick={() => toggleStatus(u)} disabled={busy}>
                      {u.status === 'ACTIVE' ? '停用' : '启用'}
                    </button>
                    <button class="btn btn-sm btn-danger" onclick={() => (deleteTarget = u)} disabled={busy}>
                      删除
                    </button>
                  {/if}
                {:else}
                  <span class="dim">—</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="page-hint">
      自我保护:不能停用/删除自己的账号;最后一名启用中的管理员受平台保护(server 强制校验)。
    </p>
  {/if}
</section>

<!-- 创建用户弹窗 -->
{#if showCreate}
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="创建用户">
    <div class="modal">
      <h3>创建用户</h3>
      <label class="field">
        <span>用户名(字母/数字/_-.,1-64 位)</span>
        <input type="text" bind:value={cUsername} placeholder="如 zhangwei" required />
      </label>
      <label class="field">
        <span>初始密码(至少 8 位,首次登录后可本人修改)</span>
        <input type="password" bind:value={cPassword} minlength={8} autocomplete="new-password" required />
      </label>
      <div class="field-row">
        <label class="field">
          <span>显示名</span>
          <input type="text" bind:value={cDisplayName} placeholder="如 张伟" />
        </label>
        <label class="field">
          <span>部门</span>
          <input type="text" bind:value={cDepartment} placeholder="如 信息科" />
        </label>
      </div>
      <label class="field">
        <span>邮箱</span>
        <input type="email" bind:value={cEmail} placeholder="name@example.com" />
      </label>
      <label class="field">
        <span>角色</span>
        <select bind:value={cRole}>
          {#each roles as r (r.name)}
            <option value={r.name}>{roleLabel(r.name)}{r.builtin ? '' : '(自定义)'}</option>
          {/each}
        </select>
      </label>
      <div class="modal-actions">
        <button class="btn" onclick={() => (showCreate = false)} disabled={busy}>取消</button>
        <button class="btn btn-primary" onclick={handleCreate} disabled={busy || !cUsername.trim() || cPassword.length < 8 || !cRole}>
          {busy ? '创建中…' : '创建'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- 编辑用户弹窗 -->
{#if editTarget}
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="编辑用户">
    <div class="modal">
      <h3>编辑:{editTarget.displayName || editTarget.username}</h3>
      <label class="field">
        <span>显示名</span>
        <input type="text" bind:value={eDisplayName} />
      </label>
      <div class="field-row">
        <label class="field">
          <span>部门</span>
          <input type="text" bind:value={eDepartment} />
        </label>
        <label class="field">
          <span>邮箱</span>
          <input type="email" bind:value={eEmail} />
        </label>
      </div>
      <label class="field">
        <span>角色(变更后立即影响该用户全部在线会话的权限)</span>
        <select bind:value={eRole}>
          {#each roles as r (r.name)}
            <option value={r.name}>{roleLabel(r.name)}{r.builtin ? '' : '(自定义)'}</option>
          {/each}
        </select>
      </label>
      <div class="modal-actions">
        <button class="btn" onclick={() => (editTarget = null)} disabled={busy}>取消</button>
        <button class="btn btn-primary" onclick={handleSaveEdit} disabled={busy}>
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- 删除确认弹窗 -->
{#if deleteTarget}
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="删除用户">
    <div class="modal">
      <h3>删除用户 {deleteTarget.username}?</h3>
      <p class="danger-note">
        删除为墓碑操作:该用户全部会话立即失效,无法再登录。此操作记入审计链。
      </p>
      <div class="modal-actions">
        <button class="btn" onclick={() => (deleteTarget = null)} disabled={busy}>取消</button>
        <button class="btn btn-danger" onclick={handleDeleteConfirm} disabled={busy}>
          {busy ? '删除中…' : '确认删除'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .users-page {
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
  .user-table-wrap {
    background: var(--bg-card);
    border-radius: 8px;
    overflow-x: auto;
  }
  .user-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .user-table th {
    text-align: left;
    padding: 10px 12px;
    color: var(--text-secondary);
    font-weight: 500;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .user-table td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .user-table tr:last-child td {
    border-bottom: none;
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
  .role-chip {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
    background: var(--bg-active);
    color: var(--text-primary);
    white-space: nowrap;
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
  .btn-sm {
    padding: 4px 10px;
    font-size: 12px;
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
  .danger-note {
    font-size: 13px;
    color: var(--danger);
    background: var(--danger-bg);
    border-radius: 6px;
    padding: 10px 12px;
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
  .field input,
  .field select {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 13px;
    background: var(--bg-input);
    color: var(--text-primary);
  }
  .field-row {
    display: flex;
    gap: 12px;
  }
  .field-row .field {
    flex: 1;
  }
  .modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 8px;
  }
</style>
