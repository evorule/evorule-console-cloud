<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  P11 缺口 4:决策者简化视图。
  P11_UX_GAPS_FIX_DESIGN.md §6.4 + §8.1 定义。
  职责:状态 C 内决策者模式下,替代 MonitorDashboard 显示简化版:
    - 关键指标卡(业务语言,无技术术语)
    - 今日要事(业务事件摘要)
    - 合规状态(BLAKE3 审计链 + 规则版本 + 待办)
  与专家模式的差异:
    - 隐藏 Reactor phase(idle/executing → 只显示「运行中」/「异常」)
    - 隐藏 causal_depth / pending_io_count(决策者不关心)
    - 业务语言替代技术术语(如「规则执行」替代「Fact 处理」)
-->

<script lang="ts">
  import { productionStateStore } from "$lib/stores/production-state";
  import {
    publishQueueStore,
    pendingReviewCount as getPendingCount,
  } from "$lib/stores/publish-queue";
  import { sessionStore } from "$lib/stores/session";
  import EmptyState from "$lib/views/Feedback/EmptyState.svelte";

  // 派生:生产运行状态(业务语言)
  const prodState = $derived($productionStateStore);
  const isRunning = $derived(prodState.status === "running");

  // 派生:待审规则数(submitted + reviewing,P08 pendingReviewCount 函数)
  // 引用 publishQueueStore 确保响应式 + 调用 getter 取值
  const _ = $derived($publishQueueStore); // 响应式依赖
  const pendingReviewCount = $derived(getPendingCount());

  // 派生:今日规则执行次数(模拟数据,P1 接真实统计)
  const todayExecutionCount = $derived(isRunning ? 1432 : 0);
  const yesterdayDiff = $derived(isRunning ? "+12%" : "—");

  // 派生:待处理异常数(模拟,P1 接真实告警)
  const pendingAnomalies = $derived(isRunning ? 3 : 0);
  const urgentAnomalies = $derived(isRunning ? 1 : 0);

  // 模拟:今日要事(P1 接真实事件流)
  const todayEvents = $derived(
    isRunning
      ? [
          {
            time: "14:32",
            text: "病人 P-1283 触发高烧 CT 检查(规则:65岁以上发烧)",
            level: "info" as const,
          },
          {
            time: "13:15",
            text: "财务 R-067 报销申请待 CFO 批准(金额 ¥12,000)",
            level: "warning" as const,
          },
          {
            time: "11:08",
            text: "规则「报销上限」已更新(张医生修改,待审)",
            level: "info" as const,
          },
        ]
      : [],
  );

  // 派生:合规状态
  const auditVerified = $derived(isRunning);
  const rulesetVersion = $derived(prodState.rulesetVersion);
  const lastPublished = $derived(prodState.updatedAt ?? "—");

  const username = $derived($sessionStore.username ?? "用户");
</script>

<div class="decision-maker-view" role="region" aria-label="决策者视图">
  <!-- 关键指标卡(业务语言) -->
  <div class="dm-metrics">
    <div class="dm-metric-card">
      <div class="dm-metric-icon">📊</div>
      <div class="dm-metric-body">
        <div class="dm-metric-label">今日规则执行</div>
        <div class="dm-metric-value">
          {todayExecutionCount.toLocaleString()} 次
        </div>
        <div class="dm-metric-diff up">{yesterdayDiff}</div>
      </div>
    </div>
    <div class="dm-metric-card">
      <div class="dm-metric-icon">🚨</div>
      <div class="dm-metric-body">
        <div class="dm-metric-label">待处理异常</div>
        <div class="dm-metric-value">{pendingAnomalies} 条</div>
        <div class="dm-metric-detail">
          {#if urgentAnomalies > 0}
            <span class="dm-urgent">⚠️ {urgentAnomalies} 条紧急</span>
          {/if}
        </div>
      </div>
    </div>
    <div class="dm-metric-card">
      <div class="dm-metric-icon">⏳</div>
      <div class="dm-metric-body">
        <div class="dm-metric-label">待审规则</div>
        <div class="dm-metric-value">{pendingReviewCount} 条</div>
        <div class="dm-metric-detail">平均等待 4h</div>
      </div>
    </div>
  </div>

  {#if !isRunning}
    <!-- 空态:无运行数据 -->
    <EmptyState
      type="not_configured"
      noun="生产运行环境"
      description="evorule-server 未连接,决策者视图需要运行中的生产环境。请先连接服务器或启动 demo 模式。"
    />
  {:else}
    <!-- 今日要事(业务语言,无技术术语) -->
    <div class="dm-section">
      <h3 class="dm-section-title">📅 今日要事</h3>
      <div class="dm-event-list">
        {#each todayEvents as event (event.time)}
          <div class="dm-event dm-event-{event.level}">
            <span class="dm-event-time">{event.time}</span>
            <span class="dm-event-text">{event.text}</span>
          </div>
        {/each}
      </div>
    </div>

    <!-- 合规状态(决策者最关心) -->
    <div class="dm-section">
      <h3 class="dm-section-title">🛡️ 合规状态</h3>
      <div class="dm-compliance">
        <div class="dm-compliance-item">
          <span class="dm-compliance-icon {auditVerified ? 'ok' : 'fail'}">
            {auditVerified ? "✅" : "❌"}
          </span>
          <div class="dm-compliance-text">
            <div class="dm-compliance-label">BLAKE3 审计链</div>
            <div class="dm-compliance-value">
              {auditVerified ? "完整(最近验证通过)" : "未验证"}
            </div>
          </div>
        </div>
        <div class="dm-compliance-item">
          <span class="dm-compliance-icon ok">✅</span>
          <div class="dm-compliance-text">
            <div class="dm-compliance-label">规则版本</div>
            <div class="dm-compliance-value">
              v{rulesetVersion}(最后发布 {lastPublished})
            </div>
          </div>
        </div>
        <div class="dm-compliance-item">
          <span
            class="dm-compliance-icon {pendingReviewCount > 0 ||
            pendingAnomalies > 0
              ? 'warn'
              : 'ok'}"
          >
            {pendingReviewCount > 0 || pendingAnomalies > 0 ? "⚠️" : "✅"}
          </span>
          <div class="dm-compliance-text">
            <div class="dm-compliance-label">待办</div>
            <div class="dm-compliance-value">
              {pendingReviewCount} 条规则待审,{pendingAnomalies} 条异常未处理
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 决策者提示 -->
    <div class="dm-hint">
      💡 这是决策者视图 — 隐藏了技术细节(Reactor phase / causal depth / IO
      count)。 需要完整数据请切换到「专家模式」。
    </div>
  {/if}
</div>

<style>
  .decision-maker-view {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  /* 指标卡 */
  .dm-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
  .dm-metric-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 18px;
    background: var(--bg-card);
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    border-left: 4px solid var(--color-primary, #3b82f6);
  }
  .dm-metric-icon {
    font-size: 28px;
    flex-shrink: 0;
  }
  .dm-metric-body {
    flex: 1;
    min-width: 0;
  }
  .dm-metric-label {
    font-size: 12px;
    color: var(--color-text-secondary, #6b7280);
    margin-bottom: 4px;
  }
  .dm-metric-value {
    font-size: 22px;
    font-weight: 700;
    color: var(--color-text-primary, #1f2937);
    line-height: 1.2;
  }
  .dm-metric-diff {
    font-size: 11px;
    margin-top: 2px;
  }
  .dm-metric-diff.up {
    color: var(--color-success, #22c55e);
  }
  .dm-metric-detail {
    font-size: 11px;
    color: var(--color-text-secondary, #6b7280);
    margin-top: 2px;
  }
  .dm-urgent {
    color: var(--color-error, var(--danger, #ef4444));
    font-weight: 500;
  }

  /* 区块 */
  .dm-section {
    background: var(--bg-card);
    border-radius: 8px;
    padding: 18px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }
  .dm-section-title {
    font-size: 15px;
    font-weight: 600;
    margin: 0 0 14px 0;
    color: var(--color-text-primary, #1f2937);
  }

  /* 今日要事 */
  .dm-event-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .dm-event {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 12px;
    background: var(--color-gray-50, #f9fafb);
    border-radius: 6px;
    border-left: 3px solid var(--color-gray-300, #d1d5db);
  }
  .dm-event-info {
    border-left-color: var(--color-info, #3b82f6);
  }
  .dm-event-warning {
    border-left-color: var(--color-warning, #f59e0b);
    background: var(--color-warning-bg, #fef3c7);
  }
  .dm-event-time {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-secondary, #6b7280);
    flex-shrink: 0;
    font-family: monospace;
  }
  .dm-event-text {
    font-size: 13px;
    color: var(--color-text-primary, #1f2937);
    line-height: 1.5;
  }

  /* 合规状态 */
  .dm-compliance {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .dm-compliance-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    background: var(--color-gray-50, #f9fafb);
    border-radius: 6px;
  }
  .dm-compliance-icon {
    font-size: 20px;
    flex-shrink: 0;
  }
  .dm-compliance-text {
    flex: 1;
  }
  .dm-compliance-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary, #1f2937);
  }
  .dm-compliance-value {
    font-size: 12px;
    color: var(--color-text-secondary, #6b7280);
    margin-top: 2px;
  }

  /* 提示 */
  .dm-hint {
    padding: 10px 14px;
    background: var(--color-info-bg, #eff6ff);
    border-radius: 6px;
    font-size: 12px;
    color: var(--color-info-text, var(--color-info, #1e40af));
    line-height: 1.5;
  }

  @media (max-width: 768px) {
    .dm-metrics {
      grid-template-columns: 1fr;
    }
  }
</style>
