<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:平台登录(UV-017 W3)+ bootstrap 引导 + 演示模式开关
  - 平台登录(默认):用户名 + 密码 → evorule-server /api/platform/auth/login
  - 引导:server 尚无任何用户时(status.needs_bootstrap)显示"创建平台管理员"表单
  - 演示模式(折叠):P08 预置用户一键登录,无密码,权限走本地矩阵
  依赖:auth.ts (loginPlatform/loginAs/logout) / platform-auth-api / toast.ts
-->

<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import {
    BUILTIN_USERS,
    loginAs,
    loginPlatform,
    logout,
  } from '$lib/stores/auth';
  import { ROLE_LABELS } from '$lib/stores/permission-matrix';
  import { netConfig } from '$lib/config/net-config';
  import { fetchAuthStatus, bootstrapAdmin, PlatformAuthError } from '$lib/backend/platform-auth-api';
  import { toastSuccess, toastError } from '$lib/stores/toast';
  import { autoMode } from '$lib/stores/home-mode';

  // === 登录模式:platform(默认)/ demo ===
  let mode = $state<'platform' | 'demo'>('platform');

  // === 平台登录表单 ===
  let username = $state('');
  let password = $state('');
  let platformBusy = $state(false);

  // === bootstrap 引导(server 无用户时) ===
  let needsBootstrap = $state(false);
  let bootUsername = $state('');
  let bootPassword = $state('');
  let bootBusy = $state(false);

  // === UV-020:演示登录入口开关(server 下发;不可达时保留,离线可用原则) ===
  let demoAuthAllowed = $state(true);

  onMount(() => {
    // 探测 server 状态:不可达时如实提示,不静默(离线场景仍可用演示模式)
    fetchAuthStatus($netConfig.remoteBaseUrl)
      .then((s) => {
        needsBootstrap = s.needsBootstrap;
        demoAuthAllowed = s.demoAuth;
      })
      .catch((e: unknown) => {
        if (e instanceof PlatformAuthError && e.status === 0) {
          toastError(e.message, '无法连接 evorule-server');
        }
        // 其他探测失败不弹窗,登录时错误会如实呈现
      });
  });

  async function handlePlatformLogin(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!username.trim() || !password || platformBusy) return;
    platformBusy = true;
    const result = await loginPlatform($netConfig.remoteBaseUrl, username.trim(), password);
    platformBusy = false;
    if (result.success) {
      toastSuccess(`已登录为 ${username.trim()}`, '登录成功');
      autoMode();
      goto('/');
    } else {
      toastError(result.error ?? '登录失败', '登录失败');
    }
  }

  async function handleBootstrap(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!bootUsername.trim() || bootPassword.length < 8 || bootBusy) return;
    bootBusy = true;
    try {
      await bootstrapAdmin($netConfig.remoteBaseUrl, bootUsername.trim(), bootPassword);
      toastSuccess(
        `管理员 ${bootUsername.trim()} 已创建,请使用该账号登录`,
        '平台初始化完成'
      );
      needsBootstrap = false;
      username = bootUsername.trim();
      password = '';
    } catch (err) {
      const msg = err instanceof PlatformAuthError ? err.message : (err as Error).message;
      toastError(msg, '创建管理员失败');
    } finally {
      bootBusy = false;
    }
  }

  // === 演示模式(保留 P08 流程) ===
  let selectedUser = $state('');

  function handleDemoLogin(name: string): void {
    const result = loginAs(name);
    if (result.success) {
      const user = BUILTIN_USERS.find((u) => u.username === name);
      toastSuccess(`已登录为 ${user?.displayName ?? name}`, '演示模式登录');
      autoMode();
      goto('/');
    } else {
      toastError(result.error ?? '登录失败', '登录失败');
    }
  }

  function handleLogout(): void {
    logout();
    toastSuccess('已登出', '再见');
  }
</script>

<section class="login-page">
  <header class="login-header">
    <h1>🔐 登录 evorule</h1>
    <!-- P3-02:登录前先用一句讲清 平台 vs 演示 之别,降低新人选择茫然 -->
    <!-- UV-078 W1-A1:明示能力差异——演示角色权限矩阵不含平台管理点(用户/角色管理),避免 demo 用户直连 /users /roles 被弹回时不知所以 -->
    <p>平台账号=权限由服务端实时下发,可进入用户/角色等平台管理面(生产/团队);演示模式=预置角色一键登录、不连 server,可体验规则库/执行台/审计等业务功能面,但不含平台管理入口,适合首次体验</p>
  </header>

  {#if mode === 'platform'}
    <!-- 平台登录(默认) -->
    {#if needsBootstrap}
      <form class="auth-form" onsubmit={handleBootstrap}>
        <div class="boot-hint">
          <strong>首次部署:</strong>server 上还没有任何用户。请创建第一个平台管理员,
          之后可在「个人中心 → 用户管理」为团队建立账号与角色。
        </div>
        <label class="field">
          <span>管理员用户名</span>
          <input
            type="text"
            bind:value={bootUsername}
            placeholder="如 admin(字母/数字/_-.,1-64 位)"
            autocomplete="username"
            required
          />
        </label>
        <label class="field">
          <span>密码(至少 8 位)</span>
          <input
            type="password"
            bind:value={bootPassword}
            minlength={8}
            autocomplete="new-password"
            required
          />
        </label>
        <button class="btn btn-primary" type="submit" disabled={bootBusy}>
          {bootBusy ? '创建中…' : '创建平台管理员 →'}
        </button>
      </form>
    {:else}
      <form class="auth-form" onsubmit={handlePlatformLogin}>
        <label class="field">
          <span>用户名</span>
          <input
            type="text"
            bind:value={username}
            placeholder="平台账号"
            autocomplete="username"
            required
          />
        </label>
        <label class="field">
          <span>密码</span>
          <input
            type="password"
            bind:value={password}
            autocomplete="current-password"
            required
          />
        </label>
        <button class="btn btn-primary" type="submit" disabled={platformBusy}>
          {platformBusy ? '登录中…' : '登录 →'}
        </button>
      </form>
    {/if}
  {:else}
    <!-- 演示模式(P08 预置用户) -->
    <div class="user-grid">
      {#each BUILTIN_USERS as user (user.id)}
        <button
          class="user-card"
          class:selected={selectedUser === user.username}
          onclick={() => (selectedUser = user.username)}
          aria-pressed={selectedUser === user.username}
        >
          <div class="user-avatar">{user.displayName.charAt(0)}</div>
          <div class="user-info">
            <span class="user-name">{user.displayName}</span>
            <span class="user-role">{ROLE_LABELS[user.role as keyof typeof ROLE_LABELS]}</span>
            <span class="user-dept">{user.department ?? '未分配科室'}</span>
          </div>
        </button>
      {/each}
    </div>
    <div class="login-actions">
      <button
        class="btn btn-primary"
        disabled={!selectedUser}
        onclick={() => selectedUser && handleDemoLogin(selectedUser)}
      >
        登录 →
      </button>
      <button class="btn btn-ghost" onclick={handleLogout}>登出</button>
    </div>
  {/if}

  <!-- 模式切换 -->
  <div class="mode-switch">
    {#if mode === 'platform'}
      {#if demoAuthAllowed}
        <button class="link-btn" onclick={() => (mode = 'demo')}>
          切换到演示模式(预置角色一键登录,不连 server)→
        </button>
      {:else}
        <span class="demo-disabled-hint">演示模式已被服务器管理员关闭</span>
      {/if}
    {:else}
      <button class="link-btn" onclick={() => (mode = 'platform')}>
        ← 返回平台账号登录
      </button>
    {/if}
  </div>
</section>

<style>
  .login-page {
    max-width: 720px;
    margin: 0 auto;
    padding: 32px 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .login-header {
    text-align: center;
  }
  .login-header h1 {
    font-size: 28px;
    font-weight: 700;
    margin: 0 0 8px 0;
    color: var(--brand, #2563eb);
  }
  .login-header p {
    font-size: 14px;
    color: var(--text-secondary, #64748b);
    margin: 0;
  }
  .auth-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 420px;
    width: 100%;
    margin: 0 auto;
  }
  .boot-hint {
    padding: 12px 16px;
    background: var(--info-bg, #eff6ff);
    border-radius: 6px;
    font-size: 13px;
    color: var(--text-primary, #1e293b);
    line-height: 1.6;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field span {
    font-size: 13px;
    color: var(--text-secondary, #64748b);
  }
  .field input {
    padding: 10px 12px;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 6px;
    background: var(--bg-card);
    color: var(--text-primary, #1e293b);
    font-size: 14px;
  }
  .field input:focus {
    outline: none;
    border-color: var(--brand, #2563eb);
  }
  .btn {
    padding: 10px 24px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 15px;
    font-weight: 500;
    transition: all 0.15s ease;
  }
  .btn-primary {
    background: var(--brand, #2563eb);
    color: white;
  }
  .btn-primary:disabled {
    background: var(--border, #cbd5e1);
    cursor: not-allowed;
  }
  .btn-primary:not(:disabled):hover {
    opacity: 0.9;
  }
  .btn-ghost {
    background: transparent;
    color: var(--text-secondary, #64748b);
    border: 1px solid var(--border, #cbd5e1);
  }
  .btn-ghost:hover {
    background: var(--bg-page, #f8fafc);
  }
  .user-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }
  .user-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    background: var(--bg-card);
    border: 2px solid var(--border, #e2e8f0);
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
  }
  .user-card:hover {
    border-color: var(--brand, #2563eb);
  }
  .user-card.selected {
    border-color: var(--brand, #2563eb);
    background: var(--info-bg, #eff6ff);
  }
  .user-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--brand, #2563eb);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .user-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .user-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary, #1e293b);
  }
  .user-role {
    font-size: 13px;
    color: var(--brand, #2563eb);
  }
  .user-dept {
    font-size: 12px;
    color: var(--text-secondary, #64748b);
  }
  .login-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
  }
  .mode-switch {
    text-align: center;
  }
  .demo-disabled-hint {
    font-size: 13px;
    color: var(--text-secondary, #64748b);
  }
  .link-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary, #64748b);
    font-size: 13px;
    cursor: pointer;
    text-decoration: underline;
  }
  .link-btn:hover {
    color: var(--brand, #2563eb);
  }
</style>
