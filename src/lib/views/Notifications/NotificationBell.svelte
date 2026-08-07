<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:通知铃铛 + 未读徽标 + 下拉通知列表 + 标记已读
  依赖:notifications.ts / auth.ts
  关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §7.3(NotificationBell)
-->

<script lang="ts">
  import {
    notificationsStore,
    unreadCount,
    markAsRead,
    markAllAsRead,
  } from '$lib/stores/notifications';

  let open = $state(false);

  function toggleBell(): void {
    open = !open;
  }

  function handleClick(id: string): void {
    markAsRead(id);
  }

  function handleMarkAll(): void {
    markAllAsRead();
  }

  function typeIcon(type: string): string {
    switch (type) {
      case 'mention':
        return '💬';
      case 'review_request':
        return '🔍';
      case 'publish_status':
        return '📤';
      case 'system':
        return '⚙️';
      default:
        return '🔔';
    }
  }
</script>

<div class="notification-bell">
  <button
    class="bell-trigger"
    onclick={toggleBell}
    aria-expanded={open}
    aria-label={`通知(${$unreadCount} 条未读)`}
  >
    <span class="bell-icon">🔔</span>
    {#if $unreadCount > 0}
      <span class="unread-badge">{$unreadCount > 99 ? '99+' : $unreadCount}</span>
    {/if}
  </button>

  {#if open}
    <div class="bell-dropdown" role="menu">
      <div class="bell-header">
        <span class="bell-title">通知</span>
        {#if $unreadCount > 0}
          <button class="mark-all-btn" onclick={handleMarkAll}>
            全部标记已读
          </button>
        {/if}
      </div>
      <div class="bell-list">
        {#if $notificationsStore.length === 0}
          <div class="bell-empty">📭 暂无通知</div>
        {:else}
          {#each $notificationsStore.slice(0, 10) as n (n.id)}
            <button
              class="bell-item"
              class:unread={!n.read}
              onclick={() => handleClick(n.id)}
              role="menuitem"
            >
              <span class="item-icon">{typeIcon(n.type)}</span>
              <div class="item-content">
                <div class="item-title">{n.title}</div>
                <div class="item-body">{n.body}</div>
                <div class="item-time">{new Date(n.createdAt).toLocaleString('zh-CN')}</div>
              </div>
              {#if !n.read}
                <span class="unread-dot"></span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .notification-bell {
    position: relative;
  }
  .bell-trigger {
    position: relative;
    padding: 6px 10px;
    background: transparent;
    border: 1px solid var(--color-gray-700, #334155);
    border-radius: 6px;
    cursor: pointer;
    color: var(--color-gray-200, #e2e8f0);
    font-size: 16px;
    line-height: 1;
  }
  .bell-trigger:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .unread-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    background: var(--color-error, #dc2626);
    color: white;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .bell-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    width: 360px;
    max-height: 480px;
    background: white;
    border: 1px solid var(--color-gray-200, #e2e8f0);
    border-radius: 8px;
    box-shadow: var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.1));
    z-index: 100;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .bell-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-gray-200, #e2e8f0);
  }
  .bell-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-primary, #1e293b);
  }
  .mark-all-btn {
    background: transparent;
    border: none;
    color: var(--color-primary, #2563eb);
    cursor: pointer;
    font-size: 12px;
  }
  .mark-all-btn:hover {
    text-decoration: underline;
  }
  .bell-list {
    overflow-y: auto;
    flex: 1;
  }
  .bell-empty {
    padding: 32px 16px;
    text-align: center;
    color: var(--color-text-secondary, #64748b);
    font-size: 13px;
  }
  .bell-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 12px 16px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--color-gray-100, #f1f5f9);
    text-align: left;
    cursor: pointer;
    transition: background 0.1s ease;
  }
  .bell-item:hover {
    background: var(--color-gray-50, #f8fafc);
  }
  .bell-item.unread {
    background: var(--color-info-bg, #eff6ff);
  }
  .bell-item.unread:hover {
    background: var(--color-info-bg, #dbeafe);
  }
  .item-icon {
    font-size: 18px;
    flex-shrink: 0;
  }
  .item-content {
    flex: 1;
    min-width: 0;
  }
  .item-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary, #1e293b);
    margin-bottom: 2px;
  }
  .item-body {
    font-size: 12px;
    color: var(--color-text-secondary, #64748b);
    line-height: 1.4;
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item-time {
    font-size: 11px;
    color: var(--color-gray-400, #94a3b8);
  }
  .unread-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-primary, #2563eb);
    flex-shrink: 0;
    margin-top: 6px;
  }
</style>
