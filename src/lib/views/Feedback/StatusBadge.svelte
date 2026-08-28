<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:统一状态徽标
    - 规则状态:draft / final
    - 数据集状态:draft / testing / ready / published
    - 任务状态:running / completed / cancelled
    - 协作状态:pending / approved / rejected
-->

<script lang="ts">
  type StatusKind =
    | "draft"
    | "final"
    | "testing"
    | "ready"
    | "published"
    | "running"
    | "completed"
    | "cancelled"
    | "pending"
    | "approved"
    | "rejected";

  interface Props {
    status: StatusKind;
    size?: "sm" | "md";
  }

  let { status, size = "md" }: Props = $props();

  const config: Record<StatusKind, { label: string; color: string }> = {
    draft: { label: "草稿", color: "gray" },
    final: { label: "已发布", color: "green" },
    testing: { label: "测试中", color: "yellow" },
    ready: { label: "就绪", color: "blue" },
    published: { label: "已发布", color: "green" },
    running: { label: "运行中", color: "blue" },
    completed: { label: "已完成", color: "green" },
    cancelled: { label: "已取消", color: "gray" },
    pending: { label: "待审", color: "yellow" },
    approved: { label: "已批准", color: "green" },
    rejected: { label: "已驳回", color: "red" },
  };

  const current = $derived(config[status]);
</script>

<span class={`status-badge status-${current.color} size-${size}`}>
  {current.label}
</span>

<style>
  .status-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.4;
    white-space: nowrap;
  }
  .size-sm {
    font-size: 11px;
    padding: 1px 6px;
  }
  .size-md {
    font-size: 12px;
    padding: 2px 8px;
  }
  .status-gray {
    background: var(--bg-hover, #f3f4f6);
    color: var(--text-secondary, #4b5563);
  }
  .status-green {
    background: var(--success-bg, #f0fdf4);
    color: var(--success, #16a34a);
  }
  .status-yellow {
    background: var(--warning-bg, #fffbeb);
    color: var(--warning, #d97706);
  }
  .status-blue {
    background: var(--info-bg, #f0f9ff);
    color: var(--info, #2563eb);
  }
  .status-red {
    background: var(--danger-bg, #fef2f2);
    color: var(--danger, #dc2626);
  }
</style>
