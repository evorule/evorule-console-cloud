<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- /audit 路由 — P06 审计员工作台入口(auditor/it/exec 守卫见 +layout.ts) -->

<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
import { base } from '$app/paths';
  import BackendUnreachableBanner from '$lib/views/Feedback/BackendUnreachableBanner.svelte';
  import { page } from '$app/stores';
  import { isLoggedIn, can } from '$lib/stores/auth';
  import { currentSessionId } from '$lib/kernel/stores/session';
  import { useBackend } from '$lib/kernel';
  import { CloudHttpBackend } from '$lib/backend/cloud-http-backend';
  import { toastSuccess, toastError } from '$lib/stores/toast';
  import BusinessAuditView from '$lib/views/Audit/BusinessAuditView.svelte';
  import AnchorClockPanel from '$lib/views/Audit/AnchorClockPanel.svelte';
  import ArchiveSessionsPanel from '$lib/views/Audit/ArchiveSessionsPanel.svelte';
  import PlatformEventsPanel from '$lib/views/Audit/PlatformEventsPanel.svelte';
  import BundleImportsPanel from '$lib/views/Audit/BundleImportsPanel.svelte';
  import GuidedHint from '$lib/views/Feedback/GuidedHint.svelte';
  import Term from '$lib/views/Help/Term.svelte';

  // 登录墙前置说明在 +layout.ts 守卫(toast + redirect);此处 onMount 仅作双保险跳转
  onMount(() => {
    if (!$isLoggedIn) {
      goto(`${base}/login`);
      return;
    }
    if (!can('view_audit_chain')) {
      goto(`${base}/`);
      return;
    }
    // 深链(Agent 会话台「在审计页查看」):?session=<id> 定位同链会话 Fact;
    // 非法/缺省参数忽略,维持审计页既有选择
    const sid = Number(get(page).url.searchParams.get('session'));
    if (Number.isInteger(sid) && sid > 0) {
      currentSessionId.set(sid);
    }
  });

  // 回滚真实接线(P0 修复:此前页面未传回调,组件空转 toast 假反馈)
  let auditBackend: CloudHttpBackend;
  onMount(() => {
    if (!$isLoggedIn || !can('view_audit_chain')) return;
    const b = useBackend();
    auditBackend = b as CloudHttpBackend;
  });

  // 双向联动回链:被 IDE 中栏 iframe 嵌入时(serve 同源托管形态)显示「在工作台
  // 打开」——新标签打开 IDE 并定位到当前审计会话;独立打开/本地 dev 不显示
  const inIframe = typeof window !== 'undefined' && window.self !== window.top;

  async function handleRollbackRequest(targetVersion: number): Promise<void> {
    const res = await auditBackend.emergencyRollbackRequest(
      targetVersion,
      '审计工作台紧急回滚',
    );
    if (res.ok) {
      toastSuccess(`已回滚到 ruleset v${targetVersion}(新版本号递增)`);
    } else {
      toastError(res.error ?? '回滚失败');
    }
  }
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
    <BackendUnreachableBanner />
        <header class="audit-header">
      <h1>🔍 审计员工作台</h1>
      <p><Term id="blake3" /> 不可篡改审计链 · 因果链回溯 · <Term id="timetravel" /> 回放</p>
      {#if inIframe && $currentSessionId}
        <a
          class="workbench-link"
          href={`/?session=${$currentSessionId}`}
          target="_blank"
          rel="noopener noreferrer"
          title="在 IDE 工作台打开会话 {$currentSessionId}"
        >在工作台打开 →</a>
      {/if}
    </header>
    <BusinessAuditView onRollbackRequest={handleRollbackRequest} />
    <!-- :锚点链与时钟面板(G-A2 接线) -->
    <AnchorClockPanel />
    <!-- :历史会话审计档案(只读,服务器重启后 WAL 重建回看) -->
    <ArchiveSessionsPanel />
    <!-- :平台认证事件报表(登录/用户/角色管理事件,prev_hash 链) -->
    <PlatformEventsPanel />
    <!-- ④:部署历史(bundle 导入溯源,GET /api/bundles/imports) -->
    <BundleImportsPanel />
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
  .workbench-link {
    display: inline-block;
    margin-top: 8px;
    font-size: 13px;
    color: var(--brand, #2563eb);
    text-decoration: none;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 6px;
    padding: 4px 10px;
  }
  .workbench-link:hover {
    background: var(--bg-secondary, #f1f5f9);
  }
  .loading {
    padding: 48px;
    text-align: center;
    color: var(--text-secondary, #64748b);
  }
</style>
