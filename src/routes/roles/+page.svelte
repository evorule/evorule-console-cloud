<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- /roles 路由 — 平台角色管理 + 权限矩阵编辑器(UV-017 W4c) -->
<!--
  守卫(双层,+layout.ts 为第一层):
    - 未登录 → /login
    - 需 manage_roles(demo 用户权限矩阵不含该点,自然被拒)
-->

<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import RolesView from '$lib/views/Admin/RolesView.svelte';
  import { can, isLoggedIn, getCurrentUser } from '$lib/stores/auth';
  import { toastInfo } from '$lib/stores/toast';

  const allowed = $derived($isLoggedIn && can('manage_roles'));

  onMount(() => {
    if (!$isLoggedIn) {
      goto('/login');
      return;
    }
    if (!allowed) {
      const u = getCurrentUser();
      toastInfo(
        u?.authKind === 'demo'
          ? '角色管理属平台功能,需平台账号登录(演示模式无服务端用户体系)。'
          : '当前账号无 manage_roles 权限,请联系管理员。',
        '权限不足'
      );
      goto('/');
    }
  });
</script>

{#if allowed}
  <RolesView />
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
