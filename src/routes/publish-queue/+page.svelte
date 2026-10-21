<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- /publish-queue 路由 — P08 PublishQueueList 入口(lead/it/exec 守卫见 +layout.ts) -->

<script lang="ts">
  import PublishQueueList from '$lib/views/PublishQueue/PublishQueueList.svelte';
  import { can } from '$lib/stores/auth';
  import { isLoggedIn } from '$lib/stores/auth';
  import { goto } from '$app/navigation';
import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import { latestCheckup } from '$lib/rules-checkup/checkup';

  onMount(() => {
    if (!$isLoggedIn) {
      goto(`${base}/login`);
      return;
    }
    if (!can('view_publish_queue')) {
      goto(`${base}/`);
    }
  });
</script>

{#if $isLoggedIn && can('view_publish_queue')}
  <!-- 本机最近体检快照(客户端提示,非提交时刻服务端存证) -->
  {#if $latestCheckup}
    <div class="pq-checkup" role="note">
      本机最近体检:
      {#if $latestCheckup.overall === 'green'}✅ 绿{:else if $latestCheckup.overall === 'yellow'}🟡 黄{:else}🔴 红{/if}
      · {$latestCheckup.ruleCount} 条规则 · 指纹 <code>{$latestCheckup.fingerprint}</code>
      — 规则变动后请到规则库重跑「🩺 静态体检」
    </div>
  {/if}
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

  .pq-checkup {
    max-width: 1200px;
    margin: 0 auto;
    padding: 8px 24px 0 24px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .pq-checkup code {
    font-size: 11px;
  }
</style>


