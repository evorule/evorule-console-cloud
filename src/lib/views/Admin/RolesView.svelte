<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:平台角色管理页(UV-017 W4c)
    - 角色列表(内置 4 + 自定义;GET /api/platform/roles 登录可读)
    - 创建自定义角色 / 编辑权限矩阵(权限点勾选)/ 删除(manage_roles)
  规则(与 server platform_auth 对齐,前端预检 + server 强制):
    - 内置角色不可删除、不可停用
    - administrator 权限集锁定(计划 D4);其余内置角色权限集可调整
    - 自定义角色删除前 server 校验引用(仍有用户挂靠则 409)
-->

<script lang="ts">
  import { onMount } from "svelte";
  import {
    listRoles,
    createRole,
    updateRole,
    deleteRole,
    listPermissionRegistry,
    PlatformAuthError,
    type PlatformRoleView,
  } from "$lib/backend/platform-auth-api";
  import { netConfig } from "$lib/config/net-config";
  import { PLATFORM_ROLE_LABELS } from "$lib/stores/auth";
  import { toastSuccess, toastError } from "$lib/stores/toast";

  /** 权限点中文标签(与 server PLATFORM_ACTIONS 一一对应) */
  const ACTION_LABELS: Record<string, string> = {
    view_monitor: "查看监控大屏",
    view_audit_chain: "查看审计链",
    intervene_runtime: "干预运行时",
    rollback_ruleset: "紧急回滚",
    create_workspace: "创建工作区",
    edit_draft: "编辑草稿",
    review_in_workspace: "工作区内审核",
    submit_to_publish: "提交发布",
    start_sandbox: "启动沙盒",
    approve_publish: "审批发布",
    view_publish_queue: "查看发布队列",
    view_test_report: "查看测试报告",
    manage_users: "用户管理",
    manage_roles: "角色管理",
    view_users: "查看用户列表",
  };

  /** 权限点分组(编辑器矩阵按组渲染) */
  const ACTION_GROUPS: { label: string; actions: string[] }[] = [
    {
      label: "查看与执行",
      actions: ["view_monitor", "view_audit_chain", "view_publish_queue", "view_test_report", "view_users"],
    },
    {
      label: "规则工程",
      actions: ["create_workspace", "edit_draft", "review_in_workspace", "start_sandbox", "submit_to_publish"],
    },
    {
      label: "运行时干预与发布",
      actions: ["intervene_runtime", "rollback_ruleset", "approve_publish"],
    },
    {
      label: "平台管理",
      actions: ["manage_users", "manage_roles"],
    },
  ];

  let roles = $state<PlatformRoleView[]>([]);
  let registryActions = $state<string[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let busy = $state(false);

  // === 弹窗状态 ===
  let showCreate = $state(false);
  let editTarget = $state<PlatformRoleView | null>(null);
  let deleteTarget = $state<PlatformRoleView | null>(null);

  // === 表单 ===
  let cName = $state("");
  let cDescription = $state("");
  let cPerms = $state<Set<string>>(new Set());
  let eDescription = $state("");
  let ePerms = $state<Set<string>>(new Set());

  function roleLabel(name: string): string {
    return PLATFORM_ROLE_LABELS[name] ?? name;
  }

  function actionLabel(a: string): string {
    return ACTION_LABELS[a] ?? a;
  }

  function authErrMsg(e: unknown, fallback: string): string {
    if (e instanceof PlatformAuthError) {
      return e.status === 0 ? "无法连接 evorule-server,请确认 server 已启动" : e.message;
    }
    return fallback;
  }

  function toggle(set: Set<string>, action: string): Set<string> {
    const next = new Set(set);
    if (next.has(action)) next.delete(action);
    else next.add(action);
    return next;
  }

  async function reload(): Promise<void> {
    const { remoteBaseUrl, authToken } = $netConfig;
    try {
      const [r, reg] = await Promise.all([
        listRoles(remoteBaseUrl, authToken),
        listPermissionRegistry(remoteBaseUrl, authToken),
      ]);
      roles = r.roles;
      registryActions = reg.actions;
      error = null;
    } catch (e) {
      error = authErrMsg(e, "加载角色列表失败");
    }
  }

  onMount(async () => {
    await reload();
    loading = false;
  });

  async function handleCreate(): Promise<void> {
    if (!cName.trim() || cPerms.size === 0) return;
    busy = true;
    try {
      await createRole($netConfig.remoteBaseUrl, $netConfig.authToken, {
        name: cName.trim(),
        description: cDescription.trim(),
        permissions: [...cPerms],
      });
      toastSuccess(`角色 ${cName.trim()} 已创建`, "角色管理");
      showCreate = false;
      cName = ""; cDescription = ""; cPerms = new Set();
      await reload();
    } catch (e) {
      toastError(authErrMsg(e, "创建角色失败"), "角色管理");
    } finally {
      busy = false;
    }
  }

  function openEdit(r: PlatformRoleView): void {
    editTarget = r;
    eDescription = r.description;
    ePerms = new Set(r.permissions);
  }

  /** administrator 权限集锁定(D4);其余角色均可调整权限集 */
  function permsLocked(r: PlatformRoleView): boolean {
    return r.builtin && r.name === "administrator";
  }

  async function handleSaveEdit(): Promise<void> {
    if (!editTarget) return;
    busy = true;
    try {
      await updateRole($netConfig.remoteBaseUrl, $netConfig.authToken, editTarget.name, {
        description: eDescription.trim(),
        permissions: [...ePerms],
      });
      toastSuccess(`角色 ${editTarget.name} 已更新(在线用户权限即时生效)`, "角色管理");
      editTarget = null;
      await reload();
    } catch (e) {
      toastError(authErrMsg(e, "更新角色失败"), "角色管理");
    } finally {
      busy = false;
    }
  }

  async function handleDeleteConfirm(): Promise<void> {
    if (!deleteTarget) return;
    const name = deleteTarget.name;
    busy = true;
    try {
      await deleteRole($netConfig.remoteBaseUrl, $netConfig.authToken, name);
      toastSuccess(`角色 ${name} 已删除`, "角色管理");
      deleteTarget = null;
      await reload();
    } catch (e) {
      toastError(authErrMsg(e, "删除角色失败"), "角色管理");
    } finally {
      busy = false;
    }
  }
</script>

<section class="roles-page">
  <header class="page-header">
    <h2>🛡️ 角色管理</h2>
    <span class="page-count">{roles.length} 个角色(内置 {roles.filter((r) => r.builtin).length} + 自定义 {roles.filter((r) => !r.builtin).length})</span>
    <button class="btn btn-primary" onclick={() => (showCreate = true)} disabled={busy}>
      + 创建自定义角色
    </button>
  </header>

  {#if loading}
    <div class="page-empty">⏳ 加载角色列表...</div>
  {:else if error}
    <div class="page-error">⚠️ {error}</div>
  {:else}
    <div class="role-grid">
      {#each roles as r (r.name)}
        <div class="role-card" class:disabled={r.status === 'DISABLED'}>
          <div class="card-header">
            <span class="role-name">{roleLabel(r.name)}</span>
            <span class="builtin-chip" class:custom={!r.builtin}>{r.builtin ? '内置' : '自定义'}</span>
            {#if r.status === 'DISABLED'}
              <span class="off-chip">已停用</span>
            {/if}
          </div>
          <p class="role-desc">{r.description || '暂无描述'}</p>
          <div class="perm-chips">
            {#each r.permissions as p (p)}
              <span class="perm-chip">{actionLabel(p)}</span>
            {/each}
            {#if r.permissions.length === 0}
              <span class="perm-empty">无权限点</span>
            {/if}
          </div>
          <div class="card-actions">
            {#if !permsLocked(r)}
              <button class="btn btn-sm" onclick={() => openEdit(r)} disabled={busy}>
                编辑权限
              </button>
            {:else}
              <span class="lock-note" title="计划 D4:内置管理员权限集不可修改">🔒 权限集锁定</span>
            {/if}
            {#if !r.builtin}
              <button class="btn btn-sm btn-danger" onclick={() => (deleteTarget = r)} disabled={busy}>
                删除
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
    <p class="page-hint">
      内置角色不可删除/停用;administrator 权限集锁定。权限变更后,持有该角色的在线用户在下一次
      权限刷新(≤30 秒或下次导航)即按新矩阵执行。
    </p>
  {/if}
</section>

<!-- 创建角色弹窗(含权限矩阵编辑器) -->
{#if showCreate}
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="创建自定义角色">
    <div class="modal">
      <h3>创建自定义角色</h3>
      <div class="field-row">
        <label class="field">
          <span>角色名(字母/数字/_-.,1-64 位,创建后不可改)</span>
          <input type="text" bind:value={cName} placeholder="如 data_steward" required />
        </label>
      </div>
      <label class="field">
        <span>描述</span>
        <input type="text" bind:value={cDescription} placeholder="该角色的职责说明" />
      </label>
      <div class="matrix">
        <div class="matrix-title">权限矩阵(至少勾选 1 项)</div>
        {#each ACTION_GROUPS as g (g.label)}
          <div class="matrix-group">
            <div class="group-label">{g.label}</div>
            <div class="group-items">
              {#each g.actions as a (a)}
                <label class="check-item">
                  <input
                    type="checkbox"
                    checked={cPerms.has(a)}
                    onchange={() => (cPerms = toggle(cPerms, a))}
                  />
                  {actionLabel(a)}
                </label>
              {/each}
            </div>
          </div>
        {/each}
      </div>
      <div class="modal-actions">
        <button class="btn" onclick={() => (showCreate = false)} disabled={busy}>取消</button>
        <button class="btn btn-primary" onclick={handleCreate} disabled={busy || !cName.trim() || cPerms.size === 0}>
          {busy ? '创建中…' : '创建'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- 编辑角色弹窗 -->
{#if editTarget}
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="编辑角色">
    <div class="modal">
      <h3>编辑:{roleLabel(editTarget.name)}{editTarget.builtin ? '(内置)' : ''}</h3>
      <label class="field">
        <span>描述</span>
        <input type="text" bind:value={eDescription} />
      </label>
      <div class="matrix">
        <div class="matrix-title">
          权限矩阵
          {#if permsLocked(editTarget)}
            <span class="lock-note">🔒 内置管理员权限集不可修改</span>
          {/if}
        </div>
        {#each ACTION_GROUPS as g (g.label)}
          <div class="matrix-group">
            <div class="group-label">{g.label}</div>
            <div class="group-items">
              {#each g.actions as a (a)}
                <label class="check-item">
                  <input
                    type="checkbox"
                    checked={ePerms.has(a)}
                    disabled={permsLocked(editTarget)}
                    onchange={() => (ePerms = toggle(ePerms, a))}
                  />
                  {actionLabel(a)}
                </label>
              {/each}
            </div>
          </div>
        {/each}
      </div>
      <div class="modal-actions">
        <button class="btn" onclick={() => (editTarget = null)} disabled={busy}>取消</button>
        <button class="btn btn-primary" onclick={handleSaveEdit} disabled={busy || permsLocked(editTarget)}>
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- 删除确认弹窗 -->
{#if deleteTarget}
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="删除角色">
    <div class="modal">
      <h3>删除角色 {roleLabel(deleteTarget.name)}?</h3>
      <p class="danger-note">
        删除为墓碑操作。若仍有用户挂靠该角色,server 将拒绝(409)——请先在「用户管理」中转移这些用户。
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
  .roles-page {
    max-width: 1080px;
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
  .role-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 12px;
  }
  .role-card {
    background: var(--bg-card);
    border-radius: 8px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .role-card.disabled {
    opacity: 0.55;
  }
  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .role-name {
    font-size: 15px;
    font-weight: 600;
  }
  .builtin-chip {
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 11px;
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
  .builtin-chip.custom {
    background: var(--bg-active);
    color: var(--text-primary);
  }
  .off-chip {
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 11px;
    background: var(--warning-bg);
    color: var(--warning);
  }
  .role-desc {
    margin: 0;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .perm-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .perm-chip {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .perm-empty {
    font-size: 12px;
    color: var(--text-muted);
  }
  .card-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: auto;
  }
  .lock-note {
    font-size: 12px;
    color: var(--text-muted);
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
    max-width: 560px;
    max-height: 88vh;
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
  .field input {
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
  .matrix {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 8px;
  }
  .matrix-title {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .matrix-group {
    margin-bottom: 10px;
  }
  .matrix-group:last-child {
    margin-bottom: 0;
  }
  .group-label {
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }
  .group-items {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 6px;
  }
  .check-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    cursor: pointer;
  }
  .check-item input {
    accent-color: var(--brand, #2563eb);
  }
  .modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 8px;
  }
</style>
