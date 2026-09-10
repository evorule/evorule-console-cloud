<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  /execution 兼容重定向(体验反馈:消费者凭直觉输入 /execution 得到 404)。
  执行台的正式路由为 /view/execution(VIEW_LIST),此页仅兜底兼容旧书签/手工输入
  (与 /market → /marketplace 同类)。
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";

  onMount(() => {
    goto("/view/execution", { replaceState: true });
  });
</script>

<div class="exec-redirect">
  <p>正在跳转到执行台…</p>
  <a href="/view/execution">立即前往执行台 →</a>
</div>

<style>
  .exec-redirect {
    padding: 48px 24px;
    text-align: center;
    color: var(--text-secondary, #64748b);
    font-size: 14px;
  }
  .exec-redirect a {
    display: inline-block;
    margin-top: 8px;
    color: var(--brand, #2563eb);
    font-weight: 600;
  }
</style>