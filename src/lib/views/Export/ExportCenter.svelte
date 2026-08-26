<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:独立导出中心(P07 §3.6 决策 6 第 3 个入口)
    - 顶部:导出说明 + BLAKE3 完整性卖点
    - 中部:ExportDialog 嵌入式渲染(preset 为空,用户自选)
    - 底部:最近导出任务历史 + 模板管理快捷入口
  关联设计:P07_RESULT_EXPORT_DESIGN.md §3.6 + §6
-->

<script lang="ts">
  import { get } from "svelte/store";
  import { currentSessionId } from "@evorule/console";
  import ExportDialog from "./ExportDialog.svelte";
  import {
    exportJobsStore,
    exportTemplatesStore,
  } from "$lib/stores/export-store";

  interface Props {
    /** 关闭回调(嵌入式路由用) */
    onClose?: () => void;
  }

  let { onClose }: Props = $props();

  let dialogOpen = $state(true);

  let sessionId = $derived($currentSessionId);
  let jobs = $derived($exportJobsStore);
  let templates = $derived($exportTemplatesStore);

  function handleClose(): void {
    dialogOpen = false;
    onClose?.();
  }

  function handleReopen(): void {
    dialogOpen = true;
  }
</script>

<div class="export-center">
  <header class="ec-header">
    <div class="ec-title-group">
      <h2 class="ec-title">📤 导出中心</h2>
      <span class="ec-subtitle">
        6 种内容 × 4 种格式 · BLAKE3 完整性自证 · EU AI Act Article 12 合规证据
      </span>
    </div>
    {#if onClose}
      <button class="ec-close-btn" onclick={onClose}>← 返回</button>
    {/if}
  </header>

  <div class="ec-content">
    <div class="ec-features">
      <div class="ec-feature-card">
        <div class="ec-feature-icon">🔗</div>
        <div class="ec-feature-text">
          <strong>BLAKE3 不可篡改</strong>
          <p>导出文件含哈希校验段,脱离系统后可独立验证</p>
        </div>
      </div>
      <div class="ec-feature-card">
        <div class="ec-feature-icon">📋</div>
        <div class="ec-feature-text">
          <strong>合规报告一键生成</strong>
          <p>预置合规/汇总/监管 3 个模板,免重复配置</p>
        </div>
      </div>
      <div class="ec-feature-card">
        <div class="ec-feature-icon">🏷</div>
        <div class="ec-feature-text">
          <strong>业务化字段</strong>
          <p>CSV/PDF/XML 默认业务化字段名,业务专家可读</p>
        </div>
      </div>
      <div class="ec-feature-card">
        <div class="ec-feature-icon">📊</div>
        <div class="ec-feature-text">
          <strong>6 种导出内容</strong>
          <p>Fact 流/决策日志/审计链/状态/因果/综合报告</p>
        </div>
      </div>
    </div>

    {#if sessionId === null}
      <div class="ec-warning">
        ⚠️ 当前无活动 session。请先在执行台创建 session,或等待滚动 session
        切换完成,再进行导出。
      </div>
    {/if}

    {#if !dialogOpen}
      <div class="ec-reopen-bar">
        <span>导出对话框已关闭。</span>
        <button class="ec-reopen-btn" onclick={handleReopen}>
          📤 开始新导出
        </button>
      </div>
    {:else}
      <ExportDialog open={dialogOpen} onClose={handleClose} />
    {/if}
  </div>

  {#if jobs.length > 0}
    <section class="ec-history">
      <h3 class="ec-history-title">📜 最近导出任务</h3>
      <table class="ec-history-table">
        <thead>
          <tr>
            <th>任务 ID</th>
            <th>内容</th>
            <th>格式</th>
            <th>状态</th>
            <th>创建时间</th>
          </tr>
        </thead>
        <tbody>
          {#each jobs.slice().reverse() as job (job.jobId)}
            <tr>
              <td><code>{job.jobId}</code></td>
              <td>{job.contentType}</td>
              <td>{job.format.toUpperCase()}</td>
              <td
                class:ok={job.status === "completed"}
                class:err={job.status === "failed"}
              >
                {job.status}
              </td>
              <td>{new Date(job.createdAt).toLocaleString("zh-CN")}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

  {#if templates.length > 0}
    <section class="ec-templates">
      <h3 class="ec-templates-title">📂 可用模板({templates.length})</h3>
      <div class="ec-template-chips">
        {#each templates as tpl (tpl.id)}
          <span class="ec-template-chip" title={tpl.description}>
            {tpl.name}
            <span class="ec-chip-format">{tpl.format.toUpperCase()}</span>
          </span>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .export-center {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: auto;
    background: var(--color-gray-50, #f8fafc);
  }
  .ec-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    background: linear-gradient(135deg, var(--color-info, #1e40af) 0%, #2563eb 100%);
    color: white;
    flex-shrink: 0;
  }
  .ec-title-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ec-title {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
  }
  .ec-subtitle {
    font-size: 11px;
    opacity: 0.85;
  }
  .ec-close-btn {
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.3);
    color: white;
    border-radius: 5px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    font-weight: 600;
  }
  .ec-close-btn:hover {
    background: rgba(255, 255, 255, 0.25);
  }

  .ec-content {
    padding: 16px 18px;
    flex: 1;
  }
  .ec-features {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }
  .ec-feature-card {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--bg-card);
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 8px;
    padding: 10px 12px;
  }
  .ec-feature-icon {
    font-size: 24px;
    flex-shrink: 0;
  }
  .ec-feature-text strong {
    font-size: 12px;
    color: var(--color-text-primary, #111827);
    display: block;
  }
  .ec-feature-text p {
    margin: 2px 0 0;
    font-size: 10px;
    color: var(--color-gray-600, #4b5563);
    line-height: 1.4;
  }

  .ec-warning {
    padding: 10px 14px;
    background: var(--color-warning-bg, #fef3c7);
    border: 1px solid var(--color-warning, #fde68a);
    border-radius: 6px;
    color: var(--color-warning, #92400e);
    font-size: 12px;
    margin-bottom: 12px;
  }

  .ec-reopen-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    background: var(--bg-card);
    border: 1px dashed var(--color-gray-300, #d1d5db);
    border-radius: 8px;
    margin-bottom: 12px;
    font-size: 12px;
    color: var(--color-gray-600, #4b5563);
  }
  .ec-reopen-btn {
    background: var(--color-primary, #2563eb);
    border: 1px solid var(--color-primary, #2563eb);
    color: white;
    border-radius: 5px;
    padding: 7px 16px;
    font-size: 12px;
    cursor: pointer;
    font-weight: 600;
    font-family: inherit;
  }
  .ec-reopen-btn:hover {
    background: var(--brand, #1d4ed8);
    border-color: var(--brand, #1d4ed8);
  }

  .ec-history,
  .ec-templates {
    padding: 12px 18px;
    background: var(--bg-card);
    border-top: 1px solid var(--color-gray-200, #e5e7eb);
  }
  .ec-history-title,
  .ec-templates-title {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 700;
    color: var(--color-text-primary, #111827);
  }
  .ec-history-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  .ec-history-table th,
  .ec-history-table td {
    border: 1px solid var(--color-gray-200, #e5e7eb);
    padding: 4px 8px;
    text-align: left;
  }
  .ec-history-table th {
    background: var(--color-gray-50, #f9fafb);
    font-weight: 600;
  }
  .ec-history-table td code {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--color-gray-600, #4b5563);
  }
  .ec-history-table td.ok {
    color: var(--success, #10b981);
    font-weight: 600;
  }
  .ec-history-table td.err {
    color: var(--danger, #ef4444);
    font-weight: 600;
  }

  .ec-template-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ec-template-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--color-gray-50, #f9fafb);
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 12px;
    font-size: 11px;
    color: var(--color-text-primary, #111827);
  }
  .ec-chip-format {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--brand, #7c3aed);
    background: var(--color-info-bg, #f5f3ff);
    padding: 0 5px;
    border-radius: 3px;
  }
</style>
