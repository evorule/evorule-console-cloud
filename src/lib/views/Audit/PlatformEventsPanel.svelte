<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:平台认证事件报表面板(UV-018)
    - 消费 GET /api/audit/platform-events(SharedFactsLog platform.event.* 只读派生)
    - 12 类认证事件:登录(成功/失败/停用拒绝)/改密/用户增删改/角色增删改
    - kind 服务端筛选 + 失败类事件红色标记 + JSON/CSV 导出(客户端 Blob)
    - 只读:事件随共享事实 WAL 入 prev_hash 链,本面板不提供任何写操作
  说明:仅 CloudHttpBackend(联网模式)提供端点;其他 backend 显示不可用提示
-->

<script lang="ts">
  import { onMount } from "svelte";
  import {
    CloudHttpBackend,
    type PlatformEventEntry,
  } from "$lib/backend/cloud-http-backend";
  import { useBackend } from "$lib/kernel";

  const backend = useBackend();
  const cloud = backend instanceof CloudHttpBackend ? backend : null;

  // === 状态 ===
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let events = $state<PlatformEventEntry[]>([]);
  let total = $state(0);
  let kindFilter = $state<string>("");

  // === 事件语义(12 类,对齐 platform_auth::append_auth_event 写入侧) ===
  const KIND_LABELS: Record<string, string> = {
    bootstrap_admin: "初始化管理员",
    login_success: "登录成功",
    login_failed: "登录失败",
    login_rejected_disabled: "登录拒绝(账号停用)",
    change_password: "修改密码",
    change_password_failed: "修改密码失败",
    user_created: "创建用户",
    user_updated: "更新用户",
    user_deleted: "删除用户",
    role_created: "创建角色",
    role_updated: "更新角色",
    role_deleted: "删除角色",
  };
  /** 失败/拒绝类事件(红色标记) */
  const FAIL_KINDS = new Set([
    "login_failed",
    "login_rejected_disabled",
    "change_password_failed",
  ]);
  /** 筛选下拉项(按语义分组排序) */
  const KIND_OPTIONS = Object.keys(KIND_LABELS);

  function kindLabel(kind: string): string {
    return KIND_LABELS[kind] ?? kind;
  }

  onMount(() => {
    if (cloud) void refresh();
  });

  async function refresh(): Promise<void> {
    if (!cloud) return;
    loading = true;
    loadError = null;
    try {
      const resp = await cloud.listPlatformEvents(
        kindFilter || undefined,
      );
      events = resp.events;
      total = resp.total;
    } catch (e) {
      loadError = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  function onKindChange(): void {
    void refresh();
  }

  // === 展示辅助 ===

  function subjectOf(e: PlatformEventEntry): string {
    const d = e.detail;
    if (!d) return "-";
    if (typeof d.username === "string") return d.username;
    if (typeof d.name === "string") return d.name;
    return "-";
  }

  function actorOf(e: PlatformEventEntry): string {
    const d = e.detail;
    return d && typeof d.by === "string" ? d.by : "-";
  }

  function timeOf(e: PlatformEventEntry): string {
    if (e.ts_ms === null) return "-";
    return new Date(e.ts_ms).toLocaleString();
  }

  // === 导出(客户端 Blob;JSON 全字段取证 / CSV 表格) ===

  function download(filename: string, content: string, mime: string): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function stamp(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }

  function exportJson(): void {
    download(
      `platform-events-${stamp()}.json`,
      JSON.stringify({ total, events }, null, 2),
      "application/json",
    );
  }

  function csvEscape(v: string): string {
    return `"${v.replace(/"/g, '""')}"`;
  }

  function exportCsv(): void {
    const rows = [
      ["时间", "事件", "事件类型", "主体", "操作者", "事实ID"],
      ...events.map((e) => [
        timeOf(e),
        kindLabel(e.kind),
        e.kind,
        subjectOf(e),
        actorOf(e),
        String(e.fact_id),
      ]),
    ];
    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
    download(
      `platform-events-${stamp()}.csv`,
      `\uFEFF${csv}`,
      "text/csv;charset=utf-8",
    );
  }
</script>

<div class="platform-events-panel">
  <div class="panel-header">
    <h2>🛡️ 平台认证事件</h2>
    {#if cloud}
      <div class="header-actions">
        <select
          class="kind-select"
          bind:value={kindFilter}
          onchange={onKindChange}
          title="按事件类型筛选"
          aria-label="按事件类型筛选"
        >
          <option value="">全部事件</option>
          {#each KIND_OPTIONS as k (k)}
            <option value={k}>{kindLabel(k)}</option>
          {/each}
        </select>
        <button class="tool-btn" onclick={exportJson} disabled={events.length === 0} title="导出 JSON(全字段取证)">
          ⬇ JSON
        </button>
        <button class="tool-btn" onclick={exportCsv} disabled={events.length === 0} title="导出 CSV(表格)">
          ⬇ CSV
        </button>
        <button class="tool-btn" onclick={refresh} disabled={loading} title="重新拉取平台认证事件">
          {loading ? "⏳ 拉取中…" : "↻ 刷新"}
        </button>
      </div>
    {/if}
  </div>

  {#if !cloud}
    <div class="hint-box">
      平台认证事件仅在联网模式(连接 evorule-server)下可用;当前 backend 不提供该端点。
    </div>
  {:else if loadError}
    <div class="error-box" role="alert">平台认证事件拉取失败:{loadError}</div>
  {:else if events.length === 0 && !loading}
    <div class="hint-box">
      暂无认证事件{kindFilter ? "(当前筛选类型)" : ""}。登录、用户与角色管理操作会自动入审计链并出现在这里。
    </div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>事件</th>
            <th>主体</th>
            <th>操作者</th>
            <th>事实 ID</th>
          </tr>
        </thead>
        <tbody>
          {#each events as e (e.fact_id)}
            <tr class:fail={FAIL_KINDS.has(e.kind)}>
              <td class="time">{timeOf(e)}</td>
              <td>
                <span class="kind" class:fail-tag={FAIL_KINDS.has(e.kind)}
                  >{kindLabel(e.kind)}</span
                >
              </td>
              <td>{subjectOf(e)}</td>
              <td>{actorOf(e)}</td>
              <td class="fid">#{e.fact_id}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if total > events.length}
      <div class="hint-box">共 {total} 条,当前显示前 {events.length} 条。</div>
    {/if}
  {/if}
</div>

<style>
  .platform-events-panel {
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
    flex-wrap: wrap;
  }
  .panel-header h2 {
    font-size: 15px;
    font-weight: 700;
    margin: 0;
    color: var(--text-primary, #1f2937);
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .kind-select {
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 5px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card);
    color: var(--text-primary, #1f2937);
    font-family: inherit;
  }
  .tool-btn {
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
  .tool-btn:hover:not(:disabled) {
    background: var(--bg-page, #f9fafb);
  }
  .tool-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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

  .table-wrap {
    overflow: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th {
    text-align: left;
    font-size: 11px;
    color: var(--text-secondary, #6b7280);
    font-weight: 700;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border, #e5e7eb);
    white-space: nowrap;
  }
  td {
    padding: 5px 8px;
    border-bottom: 1px solid var(--border, #f1f5f9);
    color: var(--text-primary, #1f2937);
  }
  tr.fail td {
    background: var(--danger-bg, #fef2f2);
  }
  .time {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--text-secondary, #4b5563);
  }
  .kind {
    font-weight: 700;
  }
  .fail-tag {
    color: var(--danger, #b91c1c);
  }
  .fid {
    font-size: 11px;
    color: var(--text-secondary, #9ca3af);
    font-variant-numeric: tabular-nums;
  }
</style>
