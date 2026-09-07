<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- /plugin-approvals 路由 — 插件审批面入口(守卫同 publish-queue 范式) -->

<script lang="ts">
  import PluginApprovalView from '$lib/views/PluginApprovals/PluginApprovalView.svelte';
  import { can } from '$lib/stores/auth';
  import { isLoggedIn } from '$lib/stores/auth';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  onMount(() => {
    if (!$isLoggedIn) {
      goto('/login');
      return;
    }
    if (!can('view_publish_queue')) {
      goto('/');
    }
  });
</script>

{#if $isLoggedIn && can('view_publish_queue')}
  <PluginApprovalView />
{:else}
  <div class="loading">检查权限中...</div>
{/if}

<style>
  .loading {
    padding: 48px;
    text-align: center;
    color: var(--text-secondary, #64748b);
  }
</style>
