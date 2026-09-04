<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  PermissionsView — A-流权限策略管理(UV-084 W3,UV-065 实化)
  数据面:执行域 :18080 /api/permissions 端点族(SharedFactsLog 持久化,
  每次写操作追加新版本,可审计回放)。

  三段式:
    1. 权限条目表(全量 + 生命周期操作:Draft→提交审批 / Candidate→批准·拒绝 / 删除墓碑)
    2. 新建/编辑表单(subject/resource/action/effect/scope)
    3. 判定测试台(POST /api/permissions/evaluate,只读,verdict: allow/deny/candidate)

  错误纪律:一切失败显式呈现(inline error + toast),拒绝静默。
  生命周期状态机与 server 同口径:仅 Draft 可提交,仅 Candidate 可裁决,仅 Active 参与判定。
-->

<script lang="ts">
  import { onMount } from "svelte";
  import {
    useBackend,
    type PermissionEntryRecord,
    type PermissionEvaluateResult,
    type PermissionVersionResult,
    type PermissionSubjectType,
    type PermissionResourceType,
    type PermissionEffect,
  } from "$lib/kernel";
  import { toastError, toastSuccess } from "$lib/stores/toast";
  import ConfirmDialog from "../Home/Monitor/ConfirmDialog.svelte";

  const backend = useBackend();

  // === 列表态 ===
  let entries = $state<PermissionEntryRecord[]>([]);
  let versionInfo = $state<PermissionVersionResult | null>(null);
  let loading = $state(false);
  let listError = $state<string | null>(null);

  // === 表单态(新建/编辑共用) ===
  let formOpen = $state(false);
  let editingId = $state<string | null>(null);
  let formId = $state("");
  let formSubjectType = $state<PermissionSubjectType>("any");
  let formSubjectId = $state("");
  let formResourceType = $state<PermissionResourceType>("shared");
  let formResourcePath = $state("");
  let formAction = $state("*");
  let formEffect = $state<PermissionEffect>("allow");
  let formTenantId = $state("");
  let formUpdatedBy = $state("");
  let formSubmitting = $state(false);
  let formError = $state<string | null>(null);

  // === 删除确认 ===
  let deleteTarget = $state<PermissionEntryRecord | null>(null);

  // === 生命周期操作进行中标记(按 id,防重复提交) ===
  let actingId = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  // === 判定测试台 ===
  let evalResource = $state("shared.platform.last_login.username");
  let evalAction = $state("*");
  let evalCallerRole = $state("human");
  let evalTenantId = $state("");
  let evalRunning = $state(false);
  let evalResult = $state<PermissionEvaluateResult | null>(null);
  let evalError = $state<string | null>(null);

  const SUBJECT_TYPES: PermissionSubjectType[] = [
    "any",
    "user",
    "role",
    "rule",
    "llm_agent",
  ];
  const RESOURCE_TYPES: PermissionResourceType[] = [
    "shared",
    "fact",
    "io_action",
    "api",
  ];

  // === 数据加载 ===
  async function reload(): Promise<void> {
    loading = true;
    listError = null;
    try {
      const [list, ver] = await Promise.all([
        backend.listPermissions(),
        backend.getPermissionsVersion(),
      ]);
      entries = list.entries;
      versionInfo = ver;
    } catch (e) {
      entries = [];
      versionInfo = null;
      listError = `读取失败: ${(e as Error).message}`;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void reload();
  });

  // === 表单:新建/编辑 ===
  function openCreate(): void {
    editingId = null;
    formId = "";
    formSubjectType = "any";
    formSubjectId = "";
    formResourceType = "shared";
    formResourcePath = "";
    formAction = "*";
    formEffect = "allow";
    formTenantId = "";
    formUpdatedBy = "";
    formError = null;
    formOpen = true;
  }

  function openEdit(entry: PermissionEntryRecord): void {
    editingId = entry.id;
    formId = entry.id;
    formSubjectType = entry.subject.subject_type;
    formSubjectId = entry.subject.id;
    formResourceType = entry.resource.resource_type;
    formResourcePath = entry.resource.path;
    formAction = entry.action;
    formEffect = entry.effect;
    formTenantId = entry.scope.tenant_id ?? "";
    formUpdatedBy = entry.updated_by;
    formError = null;
    formOpen = true;
  }

  /** 构造请求体(conditions 不在表单编辑范围,编辑时保留原值) */
  function buildEntry(): PermissionEntryRecord {
    const original = editingId
      ? entries.find((e) => e.id === editingId)
      : undefined;
    return {
      id: formId.trim(),
      version: 0,
      state: "draft",
      subject: {
        subject_type: formSubjectType,
        id: formSubjectType === "any" ? "" : formSubjectId.trim(),
      },
      resource: {
        resource_type: formResourceType,
        path: formResourcePath.trim(),
      },
      action: formAction.trim() || "*",
      effect: formEffect,
      conditions: original?.conditions,
      scope: formTenantId.trim() ? { tenant_id: formTenantId.trim() } : {},
      cause: original?.cause,
      updated_by: formUpdatedBy.trim() || "console",
    };
  }

  function validateForm(): string | null {
    if (!formId.trim()) return "条目 ID 不能为空";
    if (formSubjectType !== "any" && !formSubjectId.trim()) {
      return "非 any 主体必须填写主体标识";
    }
    if (!formResourcePath.trim()) return "资源路径不能为空";
    return null;
  }

  async function submitForm(): Promise<void> {
    const invalid = validateForm();
    if (invalid) {
      formError = invalid;
      return;
    }
    formSubmitting = true;
    formError = null;
    try {
      const entry = buildEntry();
      if (editingId) {
        await backend.updatePermission(editingId, entry);
        toastSuccess(`权限条目 ${editingId} 已更新(幂等替换)`);
      } else {
        await backend.createPermission(entry);
        toastSuccess(`权限条目 ${entry.id} 已创建(草稿态,提交审批后激活)`);
      }
      formOpen = false;
      await reload();
    } catch (e) {
      formError = `保存失败: ${(e as Error).message}`;
    } finally {
      formSubmitting = false;
    }
  }

  // === 生命周期操作 ===
  async function submitForReview(id: string): Promise<void> {
    actingId = id;
    actionError = null;
    try {
      await backend.submitPermission(id);
      toastSuccess(`权限条目 ${id} 已提交审批(Draft → Candidate)`);
      await reload();
    } catch (e) {
      actionError = `提交审批失败(${id}): ${(e as Error).message}`;
      toastError(actionError);
    } finally {
      actingId = null;
    }
  }

  async function reviewEntry(id: string, approve: boolean): Promise<void> {
    actingId = id;
    actionError = null;
    try {
      const r = await backend.reviewPermission(id, approve);
      toastSuccess(
        `权限条目 ${id} 已${approve ? "批准(→ Active,进入判定集合)" : "拒绝(→ Rejected)"}`
      );
      if (!r.success) {
        actionError = `server 返回 success=false(${id})`;
      }
      await reload();
    } catch (e) {
      actionError = `审批失败(${id}): ${(e as Error).message}`;
      toastError(actionError);
    } finally {
      actingId = null;
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    actingId = id;
    actionError = null;
    try {
      await backend.deletePermission(id);
      toastSuccess(`权限条目 ${id} 已删除(写墓碑,历史保留可审计)`);
      deleteTarget = null;
      await reload();
    } catch (e) {
      actionError = `删除失败(${id}): ${(e as Error).message}`;
      toastError(actionError);
    } finally {
      actingId = null;
    }
  }

  // === 判定测试台 ===
  async function runEvaluate(): Promise<void> {
    evalRunning = true;
    evalError = null;
    evalResult = null;
    try {
      evalResult = await backend.evaluatePermission({
        resource: evalResource.trim(),
        action: evalAction.trim() || "*",
        caller_role: evalCallerRole,
        ...(evalTenantId.trim() ? { tenant_id: evalTenantId.trim() } : {}),
      });
    } catch (e) {
      evalError = `判定失败: ${(e as Error).message}`;
    } finally {
      evalRunning = false;
    }
  }

  // === 展示辅助 ===
  const stateLabel: Record<string, string> = {
    draft: "草稿",
    candidate: "待审批",
    active: "已激活",
    rejected: "已拒绝",
  };

  function subjectLabel(e: PermissionEntryRecord): string {
    if (e.subject.subject_type === "any") return "任意主体";
    return `${e.subject.subject_type}:${e.subject.id}`;
  }

  const verdictLabel: Record<string, string> = {
    allow: "允许 (allow)",
    deny: "拒绝 (deny)",
    candidate: "待审批 (candidate)",
  };
</script>

<div class="permissions-view">
  <header class="page-header">
    <div>
      <h1>🔐 权限策略</h1>
      <p class="subtitle">
        A-流权限条目 — subject → resource → action 的授权/拒绝声明,
        生命周期:草稿 → 提交审批 → 激活(仅 Active 参与运行时判定);
        写操作追加共享事实日志新版本,全程可审计回放。
      </p>
    </div>
    <div class="header-meta">
      {#if versionInfo}
        <span class="meta-chip">快照版本 v{versionInfo.version}</span>
        <span class="meta-chip">{versionInfo.count} 条</span>
      {/if}
      <button class="btn" onclick={() => void reload()} disabled={loading}>
        {loading ? "加载中…" : "↻ 刷新"}
      </button>
    </div>
  </header>

  {#if listError}
    <div class="err-box">
      {listError}
      <div class="err-hint">
        无法连接 evorule-server(:18080)。请确认 server 已启动,且执行域连接已配置。
      </div>
    </div>
  {/if}

  <!-- ============ 1. 权限条目表 ============ -->
  <section class="card">
    <div class="card-head">
      <h2>权限条目</h2>
      <button class="btn btn-primary" onclick={openCreate}>＋ 新建条目</button>
    </div>

    {#if actionError}
      <div class="err-box">{actionError}</div>
    {/if}

    {#if loading && entries.length === 0}
      <div class="empty">加载中…</div>
    {:else if entries.length === 0}
      <div class="empty">
        暂无权限条目{listError ? "(读取失败)" : ""}。点击"新建条目"创建第一条权限声明。
      </div>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>主体</th>
              <th>资源</th>
              <th>动作</th>
              <th>效果</th>
              <th>状态</th>
              <th>修改者</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {#each entries as entry (entry.id)}
              <tr>
                <td class="mono" title={entry.id}>{entry.id}</td>
                <td>{subjectLabel(entry)}</td>
                <td class="mono" title={`${entry.resource.resource_type} · ${entry.resource.path}`}>
                  <span class="res-type">{entry.resource.resource_type}</span>
                  {entry.resource.path}
                </td>
                <td class="mono">{entry.action}</td>
                <td>
                  <span class="badge" class:badge-allow={entry.effect === "allow"} class:badge-deny={entry.effect === "deny"}>
                    {entry.effect}
                  </span>
                </td>
                <td>
                  <span
                    class="badge"
                    class:badge-active={entry.state === "active"}
                    class:badge-candidate={entry.state === "candidate"}
                    class:badge-draft={entry.state === "draft"}
                    class:badge-rejected={entry.state === "rejected"}
                  >
                    {stateLabel[entry.state] ?? entry.state}
                  </span>
                </td>
                <td class="mono">{entry.updated_by}</td>
                <td class="actions">
                  <button class="btn btn-sm" onclick={() => openEdit(entry)}>✎ 编辑</button>
                  {#if entry.state === "draft"}
                    <button
                      class="btn btn-sm"
                      onclick={() => void submitForReview(entry.id)}
                      disabled={actingId === entry.id}
                    >
                      {actingId === entry.id ? "…" : "📤 提交审批"}
                    </button>
                  {/if}
                  {#if entry.state === "candidate"}
                    <button
                      class="btn btn-sm btn-approve"
                      onclick={() => void reviewEntry(entry.id, true)}
                      disabled={actingId === entry.id}
                    >
                      {actingId === entry.id ? "…" : "✓ 批准"}
                    </button>
                    <button
                      class="btn btn-sm btn-reject"
                      onclick={() => void reviewEntry(entry.id, false)}
                      disabled={actingId === entry.id}
                    >
                      {actingId === entry.id ? "…" : "✗ 拒绝"}
                    </button>
                  {/if}
                  <button class="btn btn-sm btn-danger" onclick={() => (deleteTarget = entry)}>
                    🗑 删除
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="table-note">
        仅 Active 条目参与运行时判定;Draft/Candidate/Rejected 不生效。
        删除写墓碑(历史保留,审计可回放)。
      </p>
    {/if}
  </section>

  <!-- ============ 2. 新建/编辑表单 ============ -->
  {#if formOpen}
    <section class="card">
      <div class="card-head">
        <h2>{editingId ? `编辑:${editingId}` : "新建权限条目"}</h2>
        <button class="btn" onclick={() => (formOpen = false)}>✕ 关闭</button>
      </div>

      {#if formError}
        <div class="err-box">{formError}</div>
      {/if}

      <div class="form-grid">
        <label class="field">
          <span>条目 ID *</span>
          <input
            type="text"
            bind:value={formId}
            placeholder="如 allow-human-read-shared"
            disabled={editingId !== null}
          />
        </label>
        <label class="field">
          <span>主体类型</span>
          <select bind:value={formSubjectType}>
            {#each SUBJECT_TYPES as t}
              <option value={t}>{t}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>主体标识 {formSubjectType !== "any" ? "*" : "(any 时留空)"}</span>
          <input
            type="text"
            bind:value={formSubjectId}
            placeholder={formSubjectType === "any" ? "(任意主体)" : "如 human / llm / 角色名"}
            disabled={formSubjectType === "any"}
          />
        </label>
        <label class="field">
          <span>资源类型</span>
          <select bind:value={formResourceType}>
            {#each RESOURCE_TYPES as t}
              <option value={t}>{t}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>资源路径 *</span>
          <input
            type="text"
            bind:value={formResourcePath}
            placeholder="如 shared.platform.*(尾部 * 为前缀通配)"
          />
        </label>
        <label class="field">
          <span>动作("* = 任意)</span>
          <input type="text" bind:value={formAction} placeholder="*" />
        </label>
        <label class="field">
          <span>效果</span>
          <select bind:value={formEffect}>
            <option value="allow">allow(允许)</option>
            <option value="deny">deny(拒绝)</option>
          </select>
        </label>
        <label class="field">
          <span>租户 ID(可选,空 = 全局)</span>
          <input type="text" bind:value={formTenantId} placeholder="(全局生效)" />
        </label>
        <label class="field">
          <span>修改者</span>
          <input type="text" bind:value={formUpdatedBy} placeholder="console" />
        </label>
      </div>

      <div class="form-actions">
        <button class="btn btn-primary" onclick={() => void submitForm()} disabled={formSubmitting}>
          {formSubmitting ? "保存中…" : editingId ? "保存替换(幂等)" : "创建(草稿态)"}
        </button>
        {#if !editingId}
          <span class="form-hint">新建后为草稿态,需提交审批并批准后才生效。</span>
        {:else}
          <span class="form-hint">已激活条目替换后保持激活状态。</span>
        {/if}
      </div>
    </section>
  {/if}

  <!-- ============ 3. 判定测试台 ============ -->
  <section class="card">
    <div class="card-head">
      <h2>判定测试台</h2>
    </div>
    <p class="section-note">
      按给定上下文跑一次权限判定(只读,不落库)。判定语义:deny 即胜 → allow →
      candidate(命中待审批条目)→ 默认策略(人类允许 / LLM·未知拒绝)。
    </p>
    <div class="form-grid">
      <label class="field">
        <span>资源 *</span>
        <input type="text" bind:value={evalResource} placeholder="如 shared.platform.last_login.username" />
      </label>
      <label class="field">
        <span>动作("* = 任意)</span>
        <input type="text" bind:value={evalAction} placeholder="*" />
      </label>
      <label class="field">
        <span>调用者角色</span>
        <select bind:value={evalCallerRole}>
          <option value="human">human(人类)</option>
          <option value="llm">llm(LLM 智能体)</option>
          <option value="unknown">unknown(未知)</option>
        </select>
      </label>
      <label class="field">
        <span>租户 ID(可选)</span>
        <input type="text" bind:value={evalTenantId} placeholder="(不限)" />
      </label>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" onclick={() => void runEvaluate()} disabled={evalRunning}>
        {evalRunning ? "判定中…" : "▶ 执行判定"}
      </button>
    </div>

    {#if evalError}
      <div class="err-box">{evalError}</div>
    {/if}

    {#if evalResult}
      <div class="eval-result" class:eval-allow={evalResult.verdict === "allow"} class:eval-deny={evalResult.verdict === "deny"} class:eval-candidate={evalResult.verdict === "candidate"}>
        <div class="eval-verdict">{verdictLabel[evalResult.verdict]}</div>
        <div class="eval-meta">
          caller_role={evalResult.caller_role} · resource={evalResult.resource} ·
          action={evalResult.action} · v_trigger={evalResult.v_trigger}
        </div>
      </div>
    {/if}
  </section>
</div>

<ConfirmDialog
  open={deleteTarget !== null}
  title="删除权限条目"
  message={`确定删除「${deleteTarget?.id ?? ""}」?该操作写墓碑(历史保留,审计可回放),不可撤销。`}
  confirmLabel="删除"
  level="danger"
  onConfirm={() => void confirmDelete()}
  onCancel={() => (deleteTarget = null)}
/>

<style>
  .permissions-view {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
    max-width: 1200px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
  }
  .page-header h1 {
    margin: 0 0 4px;
    font-size: 20px;
  }
  .subtitle {
    margin: 0;
    color: var(--text-secondary, #6b7280);
    font-size: 13px;
    max-width: 640px;
  }
  .header-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .meta-chip {
    font-size: 12px;
    padding: 2px 10px;
    border-radius: 10px;
    background: var(--bg-card, #f3f4f6);
    border: 1px solid var(--border, #e5e7eb);
    color: var(--text-secondary, #6b7280);
    white-space: nowrap;
  }

  .card {
    background: var(--bg-card, #fff);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 10px;
    padding: 16px;
  }
  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  .card-head h2 {
    margin: 0;
    font-size: 15px;
  }
  .section-note,
  .table-note {
    color: var(--text-secondary, #6b7280);
    font-size: 12px;
    margin: 8px 0;
  }

  .btn {
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid var(--border, #e5e7eb);
    background: var(--bg-card, #fff);
    cursor: pointer;
    font-size: 13px;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-primary {
    background: var(--accent, #2563eb);
    color: #fff;
    border-color: var(--accent, #2563eb);
  }
  .btn-sm {
    padding: 3px 8px;
    font-size: 12px;
  }
  .btn-approve {
    background: var(--success-bg, #dcfce7);
    border-color: var(--success, #86efac);
    color: var(--success-text, #166534);
  }
  .btn-reject,
  .btn-danger {
    background: var(--danger-bg, #fef2f2);
    border-color: var(--danger, #fca5a5);
    color: var(--danger-text, #991b1b);
  }

  .err-box {
    background: var(--danger-bg, #fef2f2);
    border: 1px solid var(--danger, #fca5a5);
    color: var(--danger-text, #991b1b);
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 13px;
    margin-bottom: 12px;
    word-break: break-all;
  }
  .err-hint {
    margin-top: 4px;
    font-size: 12px;
    opacity: 0.85;
  }

  .empty {
    padding: 32px;
    text-align: center;
    color: var(--text-secondary, #6b7280);
    font-size: 13px;
  }

  .table-wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th,
  td {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border, #e5e7eb);
    vertical-align: top;
  }
  th {
    color: var(--text-secondary, #6b7280);
    font-weight: 600;
    font-size: 12px;
    white-space: nowrap;
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
  }
  .res-type {
    display: inline-block;
    font-size: 11px;
    padding: 0 6px;
    border-radius: 8px;
    background: var(--bg-card, #f3f4f6);
    border: 1px solid var(--border, #e5e7eb);
    margin-right: 4px;
    color: var(--text-secondary, #6b7280);
  }
  .actions {
    white-space: nowrap;
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .badge {
    display: inline-block;
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 9px;
    border: 1px solid var(--border, #e5e7eb);
    color: var(--text-secondary, #6b7280);
    white-space: nowrap;
  }
  .badge-allow {
    background: var(--success-bg, #dcfce7);
    border-color: var(--success, #86efac);
    color: var(--success-text, #166534);
  }
  .badge-deny {
    background: var(--danger-bg, #fef2f2);
    border-color: var(--danger, #fca5a5);
    color: var(--danger-text, #991b1b);
  }
  .badge-active {
    background: var(--success-bg, #dcfce7);
    border-color: var(--success, #86efac);
    color: var(--success-text, #166534);
  }
  .badge-candidate {
    background: #fef9c3;
    border-color: #fde047;
    color: #854d0e;
  }
  .badge-draft {
    background: var(--bg-card, #f3f4f6);
    border-color: var(--border, #e5e7eb);
  }
  .badge-rejected {
    background: var(--danger-bg, #fef2f2);
    border-color: var(--danger, #fca5a5);
    color: var(--danger-text, #991b1b);
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
    margin-bottom: 12px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
  }
  .field input,
  .field select {
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid var(--border, #e5e7eb);
    background: var(--bg-card, #fff);
    font-size: 13px;
  }
  .field input:disabled {
    opacity: 0.6;
  }
  .form-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .form-hint {
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
  }

  .eval-result {
    margin-top: 12px;
    border-radius: 8px;
    padding: 14px 16px;
    border: 1px solid var(--border, #e5e7eb);
  }
  .eval-allow {
    background: var(--success-bg, #dcfce7);
    border-color: var(--success, #86efac);
  }
  .eval-deny {
    background: var(--danger-bg, #fef2f2);
    border-color: var(--danger, #fca5a5);
  }
  .eval-candidate {
    background: #fef9c3;
    border-color: #fde047;
  }
  .eval-verdict {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .eval-meta {
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    opacity: 0.8;
    word-break: break-all;
  }
</style>
