<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:审核动作栏(approve / reject / request_changes)
  依赖:auth.ts / publish-queue.ts / toast.ts
  关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §7.8(ReviewActions)
-->

<script lang="ts">
  import { can, getCurrentUser } from '$lib/stores/auth';
  import { approvePublish, rejectPublish } from '$lib/stores/publish-queue';
  import { logActivity } from '$lib/stores/activity-log';
  import { toastSuccess, toastError } from '$lib/stores/toast';

  interface Props {
    publishRequestId: string;
    /** 当前状态(reviewing 状态显示完整动作栏) */
    status: string;
  }
  let { publishRequestId, status }: Props = $props();

  let reviewComment = $state('');

  const canReview = $derived(can('approve_publish'));

  function handleApprove(): void {
    const user = getCurrentUser();
    if (!user) return;
    approvePublish(publishRequestId, user.id, reviewComment || '通过');
    logActivity({
      userId: user.id,
      username: user.displayName,
      action: 'approve_publish',
      target: publishRequestId,
      detail: reviewComment,
    });
    toastSuccess('已批准发布', '审核');
    reviewComment = '';
  }

  function handleReject(): void {
    const user = getCurrentUser();
    if (!user) return;
    if (!reviewComment.trim()) {
      toastError('请填写驳回原因', '审核');
      return;
    }
    rejectPublish(publishRequestId, user.id, reviewComment);
    logActivity({
      userId: user.id,
      username: user.displayName,
      action: 'reject_publish',
      target: publishRequestId,
      detail: reviewComment,
    });
    toastSuccess('已驳回', '审核');
    reviewComment = '';
  }
</script>

{#if status === 'reviewing' && canReview}
  <div class="review-actions">
    <input
      class="review-input"
      bind:value={reviewComment}
      placeholder="审核备注(驳回必填)..."
    />
    <button class="btn btn-success" onclick={handleApprove}>
      ✅ 批准
    </button>
    <button class="btn btn-danger" onclick={handleReject}>
      ❌ 驳回
    </button>
  </div>
{:else if status === 'reviewing' && !canReview}
  <div class="no-permission">⚠️ 您无审核权限(需 it/exec 角色)</div>
{/if}

<style>
  .review-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 12px;
    background: var(--color-gray-50, #f8fafc);
    border-radius: 6px;
  }
  .review-input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 4px;
    font-size: 13px;
  }
  .btn {
    padding: 6px 16px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }
  .btn-success {
    background: var(--color-success, #22c55e);
    color: white;
  }
  .btn-danger {
    background: var(--color-error, #dc2626);
    color: white;
  }
  .no-permission {
    padding: 8px 12px;
    background: var(--color-warning-bg, #fef3c7);
    color: var(--color-warning, #92400e);
    border-radius: 4px;
    font-size: 12px;
  }
</style>
