<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:操作日志表格(分页 20 条)
  依赖:activity-log.ts
  关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §7.9(ActivityLogTable)
-->

<script lang="ts">
  import { activityLogStore, recentActivity } from '$lib/stores/activity-log';

  let pageSize = $state(20);
  let currentPage = $state(1);

  const allLog = $derived([...$activityLogStore].reverse());
  const totalPages = $derived(Math.max(1, Math.ceil(allLog.length / pageSize)));
  const pageItems = $derived(
    allLog.slice((currentPage - 1) * pageSize, currentPage * pageSize),
  );

  function actionIcon(action: string): string {
    switch (action) {
      case 'login':
        return '🔐';
      case 'logout':
        return '🚪';
      case 'create_rule':
        return '📜';
      case 'edit_rule':
        return '✏️';
      case 'delete_rule':
        return '🗑️';
      case 'submit_publish':
        return '📤';
      case 'approve_publish':
        return '✅';
      case 'reject_publish':
        return '❌';
      case 'rollback':
        return '⏮️';
      default:
        return '📋';
    }
  }

  function goPrev(): void {
    if (currentPage > 1) currentPage -= 1;
  }
  function goNext(): void {
    if (currentPage < totalPages) currentPage += 1;
  }
</script>

<section class="activity-log">
  <header class="log-header">
    <h2>📋 操作日志</h2>
    <span class="log-count">共 {allLog.length} 条</span>
  </header>

  {#if allLog.length === 0}
    <div class="log-empty">📭 暂无操作记录</div>
  {:else}
    <table class="log-table">
      <thead>
        <tr>
          <th>动作</th>
          <th>用户</th>
          <th>目标</th>
          <th>详情</th>
          <th>时间</th>
        </tr>
      </thead>
      <tbody>
        {#each pageItems as entry (entry.id)}
          <tr>
            <td class="col-action">
              <span class="action-icon">{actionIcon(entry.action)}</span>
              <span class="action-text">{entry.action}</span>
            </td>
            <td>{entry.username}</td>
            <td class="col-target">{entry.target ?? '-'}</td>
            <td class="col-detail">{entry.detail ?? '-'}</td>
            <td class="col-time">
              {new Date(entry.timestamp).toLocaleString('zh-CN')}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>

    <div class="log-pagination">
      <button class="page-btn" onclick={goPrev} disabled={currentPage <= 1}>
        ← 上一页
      </button>
      <span class="page-info">第 {currentPage} / {totalPages} 页</span>
      <button class="page-btn" onclick={goNext} disabled={currentPage >= totalPages}>
        下一页 →
      </button>
    </div>
  {/if}
</section>

<style>
  .activity-log {
    max-width: 1000px;
    margin: 0 auto;
    padding: 24px;
  }
  .log-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }
  .log-header h2 {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
    color: var(--text-primary, #1e293b);
  }
  .log-count {
    font-size: 13px;
    color: var(--text-secondary, #64748b);
  }
  .log-empty {
    padding: 48px 24px;
    text-align: center;
    color: var(--text-secondary, #64748b);
    background: var(--bg-card);
    border-radius: 8px;
  }
  .log-table {
    width: 100%;
    border-collapse: collapse;
    background: var(--bg-card);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.1));
  }
  .log-table th {
    padding: 12px 16px;
    background: var(--bg-page, #f8fafc);
    text-align: left;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary, #64748b);
    text-transform: uppercase;
    border-bottom: 1px solid var(--border, #e2e8f0);
  }
  .log-table td {
    padding: 10px 16px;
    font-size: 13px;
    color: var(--text-primary, #1e293b);
    border-bottom: 1px solid var(--bg-hover, #f1f5f9);
  }
  .log-table tr:last-child td {
    border-bottom: none;
  }
  .col-action {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .action-icon {
    font-size: 14px;
  }
  .action-text {
    font-family: monospace;
    font-size: 12px;
  }
  .col-target {
    font-family: monospace;
    font-size: 12px;
    color: var(--text-secondary, #64748b);
  }
  .col-detail {
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary, #64748b);
  }
  .col-time {
    font-family: monospace;
    font-size: 12px;
    color: var(--text-secondary, #64748b);
    white-space: nowrap;
  }
  .log-pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin-top: 20px;
  }
  .page-btn {
    padding: 6px 14px;
    background: var(--bg-card);
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-primary, #1e293b);
  }
  .page-btn:disabled {
    background: var(--bg-hover, #f1f5f9);
    color: var(--text-secondary, #94a3b8);
    cursor: not-allowed;
  }
  .page-btn:not(:disabled):hover {
    background: var(--bg-page, #f8fafc);
  }
  .page-info {
    font-size: 13px;
    color: var(--text-secondary, #64748b);
  }
</style>
