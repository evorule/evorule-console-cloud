<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  /market 兼容重定向(信息级体验建议:直接访问 /market 曾白屏)。
  官方路由为 /marketplace(NAV_REGISTRY),此页仅兜底兼容旧书签/手工输入。
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";

  onMount(() => {
    goto("/marketplace", { replaceState: true });
  });
</script>

<div class="market-redirect">
  <p>正在跳转到市场…</p>
  <a href="/marketplace">立即前往市场 →</a>
</div>

<style>
  .market-redirect {
    padding: 48px 24px;
    text-align: center;
    color: var(--text-secondary, #64748b);
    font-size: 14px;
  }
  .market-redirect a {
    display: inline-block;
    margin-top: 8px;
    color: var(--brand, #2563eb);
    font-weight: 600;
  }
</style>
