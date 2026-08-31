<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  身份卡 widget(UV-021 W2 新增):
    - platform 登录:显示名/用户名/平台角色/权限点数(服务端下发)
    - demo 登录:显示名/本地角色/「演示」徽标
  数据自取:订阅 currentUser(双轨响应式,UV-017 范式)
-->

<script lang="ts">
  import { currentUser, PLATFORM_ROLE_LABELS } from "$lib/stores/auth";
  import { ROLE_LABELS } from "$lib/stores/permission-matrix";

  const u = $derived($currentUser);
  const roleLabel = $derived(
    u?.authKind === "platform"
      ? (PLATFORM_ROLE_LABELS[u.role] ?? u.role)
      : (ROLE_LABELS[u?.role as keyof typeof ROLE_LABELS] ?? (u?.role ?? "—"))
  );
  const initial = $derived((u?.displayName || u?.username || "?").charAt(0));
</script>

<div class="region-identity">
  <h2 class="region-title"><span class="icon">🧭</span>我的工作区</h2>
  <div class="identity-row">
    <div class="avatar">{initial}</div>
    <div class="info">
      <div class="name-line">
        <span class="name">{u?.displayName || u?.username || "未登录"}</span>
        <span class="kind-chip" class:demo={u?.authKind === "demo"}>
          {u?.authKind === "platform" ? "平台账号" : "演示模式"}
        </span>
      </div>
      <div class="meta-line">
        <span class="role">{roleLabel}</span>
        {#if u?.authKind === "platform"}
          <span class="perms">{u.permissions?.length ?? 0} 项权限(服务端下发)</span>
        {/if}
      </div>
      {#if u?.department || u?.email}
        <div class="extra-line">
          {#if u.department}<span>{u.department}</span>{/if}
          {#if u.email}<span class="dim">{u.email}</span>{/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .region-identity {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
  }
  .region-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 12px;
  }
  .icon {
    margin-right: 4px;
  }
  .identity-row {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--bg-active);
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .info {
    min-width: 0;
  }
  .name-line {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .name {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .kind-chip {
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 11px;
    background: var(--bg-active);
    color: var(--text-primary);
  }
  .kind-chip.demo {
    background: var(--warning-bg);
    color: var(--warning);
  }
  .meta-line {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .role {
    color: var(--text-primary);
  }
  .extra-line {
    display: flex;
    gap: 10px;
    margin-top: 2px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .dim {
    color: var(--text-muted);
  }
</style>
