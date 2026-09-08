<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- /apps 路由 — 平台应用凭据管理(58 号专项 W3) -->
<!--
  守卫(双层,+layout.ts 为第一层):
    - 未登录 → /login
    - demo 登录 → 权限矩阵不含平台管理点,自然被拒 → / + 提示
    - platform 登录:需 manage_apps(列表/签发/吊销全走该权限点,与 server 一致)
-->

<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import AppsView from '$lib/views/Admin/AppsView.svelte';
  import { can, isLoggedIn, getCurrentUser } from '$lib/stores/auth';
  import { toastInfo } from '$lib/stores/toast';

  const allowed = $derived($isLoggedIn && can('manage_apps'));

  onMount(() => {
    if (!$isLoggedIn) {
      goto('/login');
      return;
    }
    if (!allowed) {
      const u = getCurrentUser();
      toastInfo(
        u?.authKind === 'demo'
          ? '应用管理属平台功能,需平台账号登录(演示模式无服务端用户体系)。'
          : '当前账号无 manage_apps 权限,请联系管理员。',
        '权限不足'
      );
      goto('/');
    }
  });
</script>

{#if allowed}
  <AppsView />
{:else}
  <div class="loading">检查权限中...</div>
{/if}

<style>
  .loading {
    padding: 48px;
    text-align: center;
    color: var(--text-secondary);
  }
</style>
