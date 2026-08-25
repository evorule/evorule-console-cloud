<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:评论线程 + @提及高亮 + resolve
  依赖:comments.ts / auth.ts / notifications.ts / toast.ts
  关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §7.7(CommentThread)
-->

<script lang="ts">
  import {
    getCommentsByTarget,
    addComment,
    resolveComment,
    reopenComment,
  } from '$lib/stores/comments';
  import { getCurrentUser } from '$lib/stores/auth';
  import { pushNotification } from '$lib/stores/notifications';
  import { toastSuccess } from '$lib/stores/toast';

  interface Props {
    targetId: string;
    targetType: 'rule' | 'workspace' | 'publish_request';
  }
  let { targetId, targetType }: Props = $props();

  let newComment = $state('');

  const comments = $derived(getCommentsByTarget(targetId));

  function handleSubmit(): void {
    if (!newComment.trim()) return;
    const user = getCurrentUser();
    if (!user) {
      toastSuccess('请先登录', '评论');
      return;
    }
    addComment({
      targetId,
      targetType,
      authorId: user.id,
      authorName: user.displayName,
      content: newComment.trim(),
    });
    // 如果有 @提及,推送通知
    const mentions = newComment.match(/@(\w+)/g) ?? [];
    for (const m of mentions) {
      const username = m.slice(1);
      pushNotification({
        type: 'mention',
        title: `${user.displayName} 提到了你`,
        body: newComment.trim().slice(0, 100),
        link: `/view/${targetType === 'rule' ? 'rules' : 'audit'}`,
      });
    }
    newComment = '';
    toastSuccess('评论已发布', '评论');
  }

  function handleResolve(id: string): void {
    resolveComment(id);
    toastSuccess('评论已标记为已解决', '评论');
  }

  function handleReopen(id: string): void {
    reopenComment(id);
    toastSuccess('评论已重新打开', '评论');
  }

  // 高亮 @提及
  function highlightMentions(content: string): string {
    return content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/@(\w+)/g, '<span class="mention">@$1</span>');
  }
</script>

<section class="comment-thread">
  <header class="thread-header">
    <h3>💬 评论 ({comments.length})</h3>
  </header>

  <div class="comment-list">
    {#if comments.length === 0}
      <div class="empty-comments">暂无评论,开始第一条讨论吧</div>
    {:else}
      {#each comments as c (c.id)}
        <div class="comment-item" class:resolved={c.resolved}>
          <div class="comment-avatar">{c.authorName.charAt(0)}</div>
          <div class="comment-body">
            <div class="comment-meta">
              <span class="comment-author">{c.authorName}</span>
              <span class="comment-time">{new Date(c.createdAt).toLocaleString('zh-CN')}</span>
              {#if c.mentions.length > 0}
                <span class="mention-tags">
                  {#each c.mentions as m}
                    <span class="mention-tag">@{m}</span>
                  {/each}
                </span>
              {/if}
            </div>
            <div class="comment-content">{@html highlightMentions(c.content)}</div>
            <div class="comment-actions">
              {#if c.resolved}
                <button class="action-btn" onclick={() => handleReopen(c.id)}>
                  重新打开
                </button>
              {:else}
                <button class="action-btn" onclick={() => handleResolve(c.id)}>
                  ✓ 标记已解决
                </button>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <div class="comment-input-area">
    <textarea
      bind:value={newComment}
      placeholder="输入评论(@username 提及他人)..."
      rows="2"
      onkeydown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit();
      }}
    ></textarea>
    <button class="submit-btn" onclick={handleSubmit} disabled={!newComment.trim()}>
      发送 (Ctrl+Enter)
    </button>
  </div>
</section>

<style>
  .comment-thread {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .thread-header h3 {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    color: var(--color-text-primary, #1e293b);
  }
  .empty-comments {
    padding: 24px;
    text-align: center;
    color: var(--color-text-secondary, #64748b);
    font-size: 13px;
    background: var(--color-gray-50, #f8fafc);
    border-radius: 6px;
  }
  .comment-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .comment-item {
    display: flex;
    gap: 12px;
    padding: 12px;
    background: white;
    border-radius: 6px;
    border: 1px solid var(--color-gray-200, #e2e8f0);
  }
  .comment-item.resolved {
    opacity: 0.6;
    background: var(--color-gray-50, #f8fafc);
  }
  .comment-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--color-primary, #2563eb);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .comment-body {
    flex: 1;
    min-width: 0;
  }
  .comment-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    flex-wrap: wrap;
  }
  .comment-author {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary, #1e293b);
  }
  .comment-time {
    font-size: 11px;
    color: var(--color-gray-400, #94a3b8);
  }
  .mention-tags {
    display: flex;
    gap: 4px;
  }
  .mention-tag {
    padding: 1px 6px;
    background: var(--color-info-bg, #dbeafe);
    color: var(--color-info-text, var(--color-info, #1e40af));
    border-radius: 8px;
    font-size: 10px;
    font-weight: 500;
  }
  .comment-content {
    font-size: 13px;
    color: var(--color-text-primary, #1e293b);
    line-height: 1.5;
    margin-bottom: 8px;
  }
  .comment-content :global(.mention) {
    color: var(--color-primary, #2563eb);
    font-weight: 600;
    background: var(--color-info-bg, #eff6ff);
    padding: 0 4px;
    border-radius: 3px;
  }
  .comment-actions {
    display: flex;
    gap: 8px;
  }
  .action-btn {
    padding: 2px 8px;
    background: transparent;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    color: var(--color-text-secondary, #64748b);
  }
  .action-btn:hover {
    background: var(--color-gray-50, #f8fafc);
  }
  .comment-input-area {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--color-gray-50, #f8fafc);
    border-radius: 6px;
  }
  .comment-input-area textarea {
    width: 100%;
    padding: 8px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 4px;
    font-size: 13px;
    resize: vertical;
    font-family: inherit;
  }
  .submit-btn {
    align-self: flex-end;
    padding: 6px 16px;
    background: var(--color-primary, #2563eb);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }
  .submit-btn:disabled {
    background: var(--color-gray-300, #cbd5e1);
    cursor: not-allowed;
  }
</style>
