<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  Region 4 — 最近活动
    从 audit.entries 提取最近 8 条
    颜色:命令 green / 验证 blue / 其它 yellow
    "→ 完整审计链"跳 /view/audit
-->

<script lang="ts">
  interface ActivityItem {
    factTime: number | null;
    type: string;
    text: string;
    severity: "green" | "blue" | "yellow";
  }

  interface Props {
    activity: ActivityItem[];
    onOpenFull: () => void;
  }

  let { activity, onOpenFull }: Props = $props();

  function fmtFactTime(lt: number | null): string {
    if (lt === null) return "—";
    return `#${lt}`;
  }
</script>

<div class="region-activity">
  <h2 class="region-title"><span class="icon">📜</span>最近活动</h2>
  {#if activity.length === 0}
    <div class="empty">
      暂无审计活动 · 在执行台提交命令后这里会实时显示
    </div>
  {:else}
    <div class="activity-list">
      {#each activity as item, i (i)}
        <div class="activity-item">
          <span class="activity-time">{fmtFactTime(item.factTime)}</span>
          <span
            class="activity-dot"
            class:green={item.severity === "green"}
            class:blue={item.severity === "blue"}
            class:yellow={item.severity === "yellow"}
          ></span>
          <span class="activity-text">{item.text}</span>
        </div>
      {/each}
    </div>
  {/if}
  <div class="footer-link">
    <a onclick={onOpenFull}>→ 完整审计链</a>
  </div>
</div>

<style>
  .region-activity {
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
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .region-title .icon {
    font-size: 16px;
  }
  .empty {
    padding: 24px 8px;
    text-align: center;
    color: var(--text-muted);
    font-size: 12px;
  }
  .activity-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    max-height: 320px;
    overflow-y: auto;
  }
  .activity-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .activity-item:last-child {
    border-bottom: 0;
  }
  .activity-time {
    color: var(--text-muted);
    flex-shrink: 0;
    width: 48px;
    font-family: ui-monospace, monospace;
  }
  .activity-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-top: 6px;
    flex-shrink: 0;
  }
  .activity-dot.green { background: var(--success, #16a34a); }
  .activity-dot.blue { background: var(--primary, #2563eb); }
  .activity-dot.yellow { background: var(--warning, #ea580c); }
  .activity-text {
    color: var(--text-secondary);
    flex: 1;
  }
  .footer-link {
    text-align: right;
    margin-top: 8px;
  }
  .footer-link a {
    color: var(--primary, #2563eb);
    text-decoration: none;
    font-size: 12px;
    cursor: pointer;
  }
  .footer-link a:hover {
    text-decoration: underline;
  }
</style>
