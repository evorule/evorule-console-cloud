<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:Workspace 切换下拉(P0 占位:单 workspace)
  依赖:db.ts / workspace-members.ts
  关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §7.4(WorkspaceSwitcher)
  注:P0 单 Workspace,此组件仅展示当前 workspace + 成员数,P1+ 多 workspace 时扩展切换
-->

<script lang="ts">
  import { dbStore } from '$lib/stores/db';
  import { workspaceMembersStore } from '$lib/stores/workspace-members';
  import { toastInfo } from '$lib/stores/toast';

  let open = $state(false);

  function toggle(): void {
    open = !open;
  }

  function handleSelect(wsName: string): void {
    open = false;
    toastInfo(`P0 单 workspace:${wsName}`, 'Workspace');
  }
</script>

<div class="workspace-switcher">
  <button class="switcher-trigger" onclick={toggle} aria-expanded={open}>
    <span class="ws-icon">💼</span>
    <span class="ws-name">{$dbStore.dbName || '未命名库'}</span>
    <span class="caret" class:open>▾</span>
  </button>

  {#if open}
    <div class="switcher-dropdown" role="menu">
      <div class="dropdown-header">当前 Workspace</div>
      <button class="dropdown-item active" onclick={() => handleSelect($dbStore.dbName || '默认')} role="menuitem">
        <span>💼 {$dbStore.dbName || '默认 Workspace'}</span>
        <span class="member-count">{$workspaceMembersStore.length} 成员</span>
      </button>
      <div class="dropdown-divider"></div>
      <div class="dropdown-hint">P0 单 Workspace;P1+ 支持多 workspace 切换</div>
    </div>
  {/if}
</div>

<style>
  .workspace-switcher {
    position: relative;
  }
  .switcher-trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: transparent;
    border: 1px solid var(--color-gray-700, #334155);
    border-radius: 6px;
    cursor: pointer;
    color: var(--color-gray-200, #e2e8f0);
    font-size: 13px;
  }
  .switcher-trigger:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .ws-icon {
    font-size: 14px;
  }
  .caret {
    font-size: 10px;
    transition: transform 0.15s ease;
  }
  .caret.open {
    transform: rotate(180deg);
  }
  .switcher-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    min-width: 240px;
    background: white;
    border: 1px solid var(--color-gray-200, #e2e8f0);
    border-radius: 8px;
    box-shadow: var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.1));
    z-index: 100;
    overflow: hidden;
  }
  .dropdown-header {
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text-secondary, #64748b);
    text-transform: uppercase;
    background: var(--color-gray-50, #f8fafc);
  }
  .dropdown-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 10px 12px;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    color: var(--color-text-primary, #1e293b);
  }
  .dropdown-item:hover {
    background: var(--color-gray-50, #f8fafc);
  }
  .dropdown-item.active {
    background: var(--color-info-bg, #eff6ff);
    color: var(--color-primary, #2563eb);
    font-weight: 600;
  }
  .member-count {
    font-size: 11px;
    color: var(--color-text-secondary, #64748b);
  }
  .dropdown-divider {
    height: 1px;
    background: var(--color-gray-200, #e2e8f0);
  }
  .dropdown-hint {
    padding: 8px 12px;
    font-size: 11px;
    color: var(--color-gray-400, #94a3b8);
    font-style: italic;
  }
</style>
