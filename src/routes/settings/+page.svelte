<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  /settings 兼容重定向(体验反馈:消费者凭直觉输入 /settings 得到 404)。
  设置是 in-page modal(非独立路由,由 +layout.svelte 的 ?openSettings 打开面板),
  此页落回首页并携带 openSettings 参数以弹出设置面板(与 /market /execution 同类兼容)。
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";

  onMount(() => {
    goto("/?openSettings=network", { replaceState: false });
  });
</script>

<div class="settings-redirect">
  <p>正在打开设置…</p>
  <a href="/?openSettings=network">立即打开设置 →</a>
</div>

<style>
  .settings-redirect {
    padding: 48px 24px;
    text-align: center;
    color: var(--text-secondary, #64748b);
    font-size: 14px;
  }
  .settings-redirect a {
    display: inline-block;
    margin-top: 8px;
    color: var(--brand, #2563eb);
    font-weight: 600;
  }
</style>