<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- /knowledge 路由 — 执行侧知识数据面浏览(UV-084 W5) -->
<!--
  守卫(双层,+layout.ts 为第一层):
    - 未登录 → /login
    - 登录即可见(只读数据面由 evorule-server Bearer 认证把关,
      平台权限点不门控此页 —— 与权限管理/审计记录同口径)
-->

<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import KnowledgeView from '$lib/views/Knowledge/KnowledgeView.svelte';
  import { isLoggedIn } from '$lib/stores/auth';

  const allowed = $derived($isLoggedIn);

  onMount(() => {
    if (!$isLoggedIn) {
      goto('/login');
    }
  });
</script>

{#if allowed}
  <KnowledgeView />
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
