<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:版本历史时间线 + 回滚入口
  依赖:production-audit.ts / auth.ts / toast.ts
  关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §7.6(VersionTimeline)
-->

<script lang="ts">
  import { onMount } from 'svelte';
  import { useBackend } from '$lib/kernel';
  import { CloudHttpBackend } from '$lib/backend/cloud-http-backend';
  import { type VersionHistoryEntry } from '$lib/stores/production-audit';
  import { roleToBackend } from '$lib/stores/publish-queue-api';
  import { can, getCurrentUser } from '$lib/stores/auth';
  import { toastSuccess, toastError } from '$lib/stores/toast';

  const canRollback = $derived(can('rollback_ruleset'));

  let history = $state<VersionHistoryEntry[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let backend: CloudHttpBackend;

  async function reloadHistory(): Promise<void> {
    try {
      history = await backend.getProductionAudit();
      error = null;
    } catch (e) {
      history = [];
      const detail = e instanceof Error && e.message ? e.message : '网络错误';
      error = `无法连接 evorule-server(${backend.baseUrl}):${detail}`;
    }
  }

  onMount(async () => {
    const b = useBackend();
    // cloud 版始终注入 CloudHttpBackend(在线/离线统一走 HTTP)
    backend = b as CloudHttpBackend;
    await reloadHistory();
    loading = false;
  });

  async function handleRollback(version: number): Promise<void> {
    if (!confirm(`确认回滚到 v${version}?此操作将创建新版本(单调递增)。`)) return;
    const user = getCurrentUser();
    if (!user) return;
    const res = await backend.emergencyRollbackRequest(
      version,
      `版本历史回滚到 v${version}`,
      user.id,
      roleToBackend(user.role),
    );
    if (!res.ok) {
      toastError(res.error ?? '回滚失败', '版本历史');
      return;
    }
    toastSuccess(`已回滚到 v${version} (新版本号递增)`, '版本历史');
    await reloadHistory();
  }
</script>

<section class="version-history">
  <header class="history-header">
    <h2>📜 版本历史</h2>
    <span class="history-count">{history.length} 个版本</span>
  </header>

  {#if loading}
    <div class="history-empty">⏳ 加载版本历史...</div>
  {:else if error}
    <div class="history-empty history-error">⚠️ {error}</div>
  {:else if history.length === 0}
    <div class="history-empty">📭 暂无发布版本</div>
  {:else}
    <div class="timeline">
      {#each history as entry, i (entry.version)}
        <div class="timeline-item" class:first={i === 0}>
          <div class="timeline-dot" class:rollback={!!entry.rollbackOf}></div>
          <div class="timeline-content">
            <div class="version-header">
              <span class="version-num">v{entry.version}</span>
              {#if entry.rollbackOf}
                <span class="rollback-badge">⏮️ 回滚自 v{entry.rollbackOf}</span>
              {/if}
              <span class="version-time">
                {new Date(entry.publishedAt).toLocaleString('zh-CN')}
              </span>
            </div>
            <div class="version-meta">
              <span>发布人:{entry.publishedBy}</span>
              <span class="version-hash" title={entry.rulesetHash}>
                hash:{entry.rulesetHash.slice(0, 12)}...
              </span>
            </div>
            {#if entry.notes}
              <div class="version-notes">{entry.notes}</div>
            {/if}
            {#if canRollback && i > 0}
              <button class="rollback-btn" onclick={() => handleRollback(entry.version)}>
                ⏮️ 回滚到此版本
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .version-history {
    max-width: 800px;
    margin: 0 auto;
    padding: 24px;
  }
  .history-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
  }
  .history-header h2 {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
  }
  .history-count {
    font-size: 13px;
    color: var(--color-text-secondary, #64748b);
  }
  .history-empty {
    padding: 48px;
    text-align: center;
    color: var(--color-text-secondary, #64748b);
    background: var(--bg-card);
    border-radius: 8px;
  }
  .history-error {
    color: var(--color-error, #dc2626);
  }
  .timeline {
    position: relative;
    padding-left: 24px;
  }
  .timeline::before {
    content: '';
    position: absolute;
    left: 7px;
    top: 8px;
    bottom: 8px;
    width: 2px;
    background: var(--color-gray-200, #e2e8f0);
  }
  .timeline-item {
    position: relative;
    padding-bottom: 24px;
  }
  .timeline-dot {
    position: absolute;
    left: -24px;
    top: 4px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--color-primary, #2563eb);
    border: 3px solid white;
    box-shadow: 0 0 0 2px var(--color-primary, #2563eb);
  }
  .timeline-dot.rollback {
    background: var(--color-warning, #f59e0b);
    box-shadow: 0 0 0 2px var(--color-warning, #f59e0b);
  }
  .timeline-content {
    background: var(--bg-card);
    padding: 16px;
    border-radius: 8px;
    box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.1));
  }
  .version-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .version-num {
    font-size: 18px;
    font-weight: 700;
    color: var(--color-primary, #2563eb);
  }
  .rollback-badge {
    padding: 2px 8px;
    background: var(--color-warning-bg, #fef3c7);
    color: var(--color-warning, #92400e);
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
  }
  .version-time {
    font-size: 12px;
    color: var(--color-text-secondary, #64748b);
    margin-left: auto;
  }
  .version-meta {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: var(--color-text-secondary, #64748b);
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .version-hash {
    font-family: monospace;
  }
  .version-notes {
    font-size: 13px;
    color: var(--color-text-primary, #1e293b);
    padding: 8px 12px;
    background: var(--color-gray-50, #f8fafc);
    border-radius: 4px;
    margin-bottom: 8px;
  }
  .rollback-btn {
    padding: 4px 12px;
    background: transparent;
    border: 1px solid var(--color-warning, #f59e0b);
    color: var(--color-warning, #f59e0b);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .rollback-btn:hover {
    background: var(--color-warning-bg, #fef3c7);
  }
</style>
