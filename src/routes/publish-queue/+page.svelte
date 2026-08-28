<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- /publish-queue 路由 — P08 PublishQueueList 入口(lead/it/exec 守卫见 +layout.ts) -->

<script lang="ts">
  import PublishQueueList from '$lib/views/PublishQueue/PublishQueueList.svelte';
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
  <PublishQueueList />
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
