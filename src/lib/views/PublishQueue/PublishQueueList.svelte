<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:发布队列列表 + 状态徽标 + approve/reject 按钮(权限守卫)
  依赖:publish-queue.ts / auth.ts / production-audit.ts / activity-log.ts / toast.ts
  关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §7.5(PublishQueueList)
-->

<script lang="ts">
  import {
    publishQueueStore,
    startReview,
    approvePublish,
    rejectPublish,
    emergencyRollback,
  } from "$lib/stores/publish-queue";
  import { can, getCurrentUser } from "$lib/stores/auth";
  import { appendVersion } from "$lib/stores/production-audit";
  import { logActivity } from "$lib/stores/activity-log";
  import { pushNotification } from "$lib/stores/notifications";
  import { toastSuccess, toastError } from "$lib/stores/toast";

  let reviewComment = $state<Record<string, string>>({});
  let rejectingId = $state<string | null>(null);
  let rejectComment = $state("");

  const canApprove = $derived(can("approve_publish"));
  const canRollback = $derived(can("rollback_ruleset"));

  function statusLabel(s: string): string {
    const labels: Record<string, string> = {
      draft: "草稿",
      submitted: "待审核",
      reviewing: "审核中",
      approved: "已批准",
      rejected: "已驳回",
      published: "已发布",
      rolled_back: "已回滚",
    };
    return labels[s] ?? s;
  }

  function statusClass(s: string): string {
    return `status-${s}`;
  }

  function handleStartReview(id: string): void {
    const user = getCurrentUser();
    if (!user) return;
    startReview(id, user.id);
    logActivity({
      userId: user.id,
      username: user.displayName,
      action: "start_review",
      target: id,
    });
    toastSuccess("已开始审核", "发布队列");
  }

  function handleApprove(id: string): void {
    const user = getCurrentUser();
    if (!user) return;
    const comment = reviewComment[id] ?? "通过";
    approvePublish(id, user.id, comment);
    // 同步 production-audit 历史
    const req = $publishQueueStore.find((r) => r.id === id);
    if (req) {
      const version = appendVersion({
        rulesetHash: `hash_v${req.rulesetVersion}_${Date.now()}`,
        publishedAt: new Date().toISOString(),
        publishedBy: user.id,
        publishRequestId: id,
        notes: comment,
      });
      logActivity({
        userId: user.id,
        username: user.displayName,
        action: "approve_publish",
        target: id,
        detail: `v${version} 已发布`,
      });
      pushNotification({
        type: "publish_status",
        title: "规则集已发布",
        body: `版本 v${version} 已批准发布`,
        link: "/version-history",
      });
    }
    toastSuccess("已批准发布", "发布队列");
  }

  function handleRejectConfirm(): void {
    if (!rejectingId) return;
    const user = getCurrentUser();
    if (!user) return;
    rejectPublish(rejectingId, user.id, rejectComment || "驳回");
    logActivity({
      userId: user.id,
      username: user.displayName,
      action: "reject_publish",
      target: rejectingId,
      detail: rejectComment,
    });
    toastSuccess("已驳回发布请求", "发布队列");
    rejectingId = null;
    rejectComment = "";
  }

  function handleRollback(id: string): void {
    const user = getCurrentUser();
    if (!user) return;
    if (!confirm("确认紧急回滚?此操作将立即生效。")) return;
    emergencyRollback(id, user.id);
    logActivity({
      userId: user.id,
      username: user.displayName,
      action: "rollback",
      target: id,
    });
    pushNotification({
      type: "publish_status",
      title: "⚠️ 紧急回滚",
      body: `发布请求 ${id} 已紧急回滚`,
      link: "/version-history",
    });
    toastSuccess("已紧急回滚", "发布队列");
  }
</script>

<section class="publish-queue">
  <header class="queue-header">
    <h2>📤 发布队列</h2>
    <span class="queue-count">{$publishQueueStore.length} 条请求</span>
  </header>

  {#if $publishQueueStore.length === 0}
    <div class="queue-empty">📭 暂无发布请求</div>
  {:else}
    <div class="queue-list">
      {#each $publishQueueStore as req (req.id)}
        <div class="queue-item {statusClass(req.status)}">
          <div class="item-header">
            <span class="item-version">v{req.rulesetVersion}</span>
            <span class="item-status {statusClass(req.status)}">
              {statusLabel(req.status)}
            </span>
            <span class="item-id">{req.id}</span>
          </div>
          <div class="item-meta">
            <span>提交人:{req.submittedBy}</span>
            <span
              >提交时间:{new Date(req.submittedAt).toLocaleString(
                "zh-CN",
              )}</span
            >
            {#if req.reviewedBy}
              <span>审核人:{req.reviewedBy}</span>
            {/if}
            {#if req.reviewComment}
              <span class="item-comment">备注:{req.reviewComment}</span>
            {/if}
          </div>

          {#if req.status === "submitted" && canApprove}
            <div class="item-actions">
              <input
                class="comment-input"
                placeholder="审核备注..."
                bind:value={reviewComment[req.id]}
              />
              <button
                class="btn btn-primary"
                onclick={() => handleStartReview(req.id)}
              >
                开始审核
              </button>
            </div>
          {/if}

          {#if req.status === "reviewing" && canApprove}
            <div class="item-actions">
              <input
                class="comment-input"
                placeholder="审核备注..."
                bind:value={reviewComment[req.id]}
              />
              <button
                class="btn btn-success"
                onclick={() => handleApprove(req.id)}
              >
                ✅ 批准
              </button>
              <button
                class="btn btn-danger"
                onclick={() => (rejectingId = req.id)}
              >
                ❌ 驳回
              </button>
            </div>
          {/if}

          {#if req.status === "published" && canRollback}
            <div class="item-actions">
              <button
                class="btn btn-warning"
                onclick={() => handleRollback(req.id)}
              >
                ⏮️ 紧急回滚
              </button>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if rejectingId}
    <div class="reject-modal" role="dialog" aria-modal="true">
      <div class="modal-content">
        <h3>驳回发布请求</h3>
        <textarea
          bind:value={rejectComment}
          placeholder="请输入驳回原因..."
          rows="3"
        ></textarea>
        <div class="modal-actions">
          <button class="btn btn-ghost" onclick={() => (rejectingId = null)}>
            取消
          </button>
          <button class="btn btn-danger" onclick={handleRejectConfirm}>
            确认驳回
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .publish-queue {
    max-width: 900px;
    margin: 0 auto;
    padding: 24px;
  }
  .queue-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }
  .queue-header h2 {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
  }
  .queue-count {
    font-size: 13px;
    color: var(--color-text-secondary, #64748b);
  }
  .queue-empty {
    padding: 48px;
    text-align: center;
    color: var(--color-text-secondary, #64748b);
    background: white;
    border-radius: 8px;
  }
  .queue-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .queue-item {
    padding: 16px;
    background: white;
    border-radius: 8px;
    border-left: 4px solid var(--color-gray-300, #cbd5e1);
    box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.1));
  }
  .queue-item.status-submitted {
    border-left-color: var(--color-warning, #f59e0b);
  }
  .queue-item.status-reviewing {
    border-left-color: var(--color-info, #3b82f6);
  }
  .queue-item.status-published {
    border-left-color: var(--color-success, #22c55e);
  }
  .queue-item.status-rejected {
    border-left-color: var(--color-error, #dc2626);
  }
  .queue-item.status-rolled_back {
    border-left-color: var(--color-gray-500, #64748b);
  }
  .item-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }
  .item-version {
    font-size: 16px;
    font-weight: 700;
    color: var(--color-primary, #2563eb);
  }
  .item-status {
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
    background: var(--color-gray-100, #f1f5f9);
    color: var(--color-text-secondary, #64748b);
  }
  .item-status.status-submitted {
    background: #fef3c7;
    color: #92400e;
  }
  .item-status.status-reviewing {
    background: #dbeafe;
    color: #1e40af;
  }
  .item-status.status-published {
    background: #dcfce7;
    color: #166534;
  }
  .item-status.status-rejected {
    background: #fee2e2;
    color: #991b1b;
  }
  .item-status.status-rolled_back {
    background: var(--color-gray-100, #f1f5f9);
    color: var(--color-gray-600, #475569);
  }
  .item-id {
    font-family: monospace;
    font-size: 11px;
    color: var(--color-gray-400, #94a3b8);
    margin-left: auto;
  }
  .item-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    font-size: 12px;
    color: var(--color-text-secondary, #64748b);
    margin-bottom: 12px;
  }
  .item-comment {
    color: var(--color-text-primary, #1e293b);
  }
  .item-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    padding-top: 12px;
    border-top: 1px solid var(--color-gray-100, #f1f5f9);
  }
  .comment-input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 4px;
    font-size: 13px;
  }
  .btn {
    padding: 6px 14px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }
  .btn-primary {
    background: var(--color-primary, #2563eb);
    color: white;
  }
  .btn-success {
    background: var(--color-success, #22c55e);
    color: white;
  }
  .btn-danger {
    background: var(--color-error, #dc2626);
    color: white;
  }
  .btn-warning {
    background: var(--color-warning, #f59e0b);
    color: white;
  }
  .btn-ghost {
    background: transparent;
    color: var(--color-text-secondary, #64748b);
    border: 1px solid var(--color-gray-300, #cbd5e1);
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
    background: white;
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
    border: 1px solid var(--color-gray-300, #cbd5e1);
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
