<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:版本历史时间线 + 回滚入口
  依赖:production-audit.ts / auth.ts / toast.ts
  关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §7.6(VersionTimeline)
-->

<script lang="ts">
  import { productionAuditStore } from '$lib/stores/production-audit';
  import { can } from '$lib/stores/auth';
  import { toastSuccess, toastInfo } from '$lib/stores/toast';

  const canRollback = $derived(can('rollback_ruleset'));
  const history = $derived(
    [...$productionAuditStore].sort((a, b) => b.version - a.version),
  );

  function handleRollback(version: number): void {
    if (!confirm(`确认回滚到 v${version}?此操作将创建新版本(单调递增)。`)) return;
    // P0 mock:回滚由 publish-queue 紧急回滚 + appendVersion 完成
    // 此处仅提示(完整回滚流程在 PublishQueueList 触发)
    toastInfo(`回滚到 v${version} 需通过发布队列紧急回滚触发`, '版本历史');
  }
</script>

<section class="version-history">
  <header class="history-header">
    <h2>📜 版本历史</h2>
    <span class="history-count">{$productionAuditStore.length} 个版本</span>
  </header>

  {#if history.length === 0}
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
    background: white;
    border-radius: 8px;
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
    background: white;
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
    background: #fef3c7;
    color: #92400e;
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
    background: #fef3c7;
  }
</style>
