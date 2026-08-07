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
    background: var(--color-gray-100, #f3f4f6);
    color: var(--color-gray-600, #4b5563);
  }
  .status-green {
    background: var(--color-success-bg, #f0fdf4);
    color: var(--color-success, #16a34a);
  }
  .status-yellow {
    background: var(--color-warning-bg, #fffbeb);
    color: var(--color-warning, #d97706);
  }
  .status-blue {
    background: var(--color-info-bg, #f0f9ff);
    color: var(--color-info, #2563eb);
  }
  .status-red {
    background: var(--color-error-bg, #fef2f2);
    color: var(--color-error, #dc2626);
  }
</style>
