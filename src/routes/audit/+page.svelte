<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- /audit 路由 — P06 审计员工作台入口(auditor/it/exec 守卫见 +layout.ts) -->

<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { isLoggedIn, can } from '$lib/stores/auth';
  import BusinessAuditView from '$lib/views/Audit/BusinessAuditView.svelte';
  import GuidedHint from '$lib/views/Feedback/GuidedHint.svelte';
  import Term from '$lib/views/Help/Term.svelte';

  onMount(() => {
    if (!$isLoggedIn) {
      goto('/login');
      return;
    }
    if (!can('view_audit_chain')) {
      goto('/');
    }
  });
</script>

{#if $isLoggedIn && can('view_audit_chain')}
  <div class="audit-page">
    <!-- PR7:审计工作台首访提示 -->
    <GuidedHint
      hintId="audit"
      variant="tip"
      title="审计员工作台 · 一切可追溯"
      body="这里呈现 BLAKE3 不可篡改审计链与因果链回溯。每步操作都可验证、可回放,是 evorule 治理闭环的「黑匣子」。"
    />
    <header class="audit-header">
      <h1>🔍 审计员工作台</h1>
      <p><Term id="blake3" /> 不可篡改审计链 · 因果链回溯 · <Term id="timetravel" /> 回放</p>
    </header>
    <BusinessAuditView />
  </div>
{:else}
  <div class="loading">检查权限中...</div>
{/if}

<style>
  .audit-page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px;
  }
  .audit-header {
    margin-bottom: 24px;
  }
  .audit-header h1 {
    font-size: 24px;
    font-weight: 700;
    margin: 0 0 8px 0;
    color: var(--brand, #2563eb);
  }
  .audit-header p {
    font-size: 14px;
    color: var(--text-secondary, #64748b);
    margin: 0;
  }
  .loading {
    padding: 48px;
    text-align: center;
    color: var(--text-secondary, #64748b);
  }
</style>
