<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- /permissions 路由 — A-流权限策略管理(UV-084 W3) -->
<!--
  守卫(双层,+layout.ts 为第一层):
    - 未登录 → /login
    - 登录即可见(执行域数据面由 evorule-server Bearer 认证把关,
      平台权限点不门控此页 —— 与审计记录/版本历史同口径)
-->

<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PermissionsView from '$lib/views/Permissions/PermissionsView.svelte';
  import { isLoggedIn } from '$lib/stores/auth';

  const allowed = $derived($isLoggedIn);

  onMount(() => {
    if (!$isLoggedIn) {
      goto('/login');
    }
  });
</script>

{#if allowed}
  <PermissionsView />
{:else}
  <div class="loading">检查登录态…</div>
{/if}

<style>
  .loading {
    padding: 48px;
    text-align: center;
    color: var(--text-secondary);
  }
</style>
