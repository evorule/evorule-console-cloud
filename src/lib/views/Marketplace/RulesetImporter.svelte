<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:P09 官方规则集导入向导(§3.8 + §6.4)
    - 展示内置官方规则集(DJBH 2.0 Level 3)元信息 + 条款映射
    - 4 冲突策略选择(skip/overwrite/rename/merge,默认 rename)
    - 导入进度 + 结果摘要(导入数/跳过数/冲突列表)
    - 支持从文件导入自定义 ruleset.json
  关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §3.8 + §6.4
-->

<script lang="ts">
  import {
    buildDjbhRulesetPackage,
    importRuleset,
  } from "$lib/stores/ruleset-import";
  import {
    RISK_LEVEL_LABELS,
    type RulesetPackage,
  } from "$lib/stores/ruleset-types";
  import type { ConflictResolution } from "$lib/stores/import-export-types";
  import { toastSuccess, toastError, toastInfo } from "$lib/stores/toast";

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  let { open, onClose }: Props = $props();

  // === 状态 ===
  let loading = $state(false);
  let importing = $state(false);
  let packageData = $state<RulesetPackage | null>(null);
  let conflictResolution = $state<ConflictResolution>("rename");
  let importResult = $state<{
    imported: number;
    skipped: number;
    conflicts: string[];
    durationMs: number;
  } | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let customJson = $state<string | null>(null);
  let customName = $state<string>("自定义规则集");

  // === 加载内置规则集 ===
  async function loadBuiltinPackage() {
    loading = true;
    try {
      packageData = await buildDjbhRulesetPackage();
    } catch (e) {
      toastError(
        `加载内置规则集失败:${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (open && !packageData && !customJson) {
      loadBuiltinPackage();
    }
  });

  // === 执行导入 ===
  async function handleImport() {
    if (!packageData && !customJson) {
      toastError("无可导入的规则集");
      return;
    }
    importing = true;
    importResult = null;
    try {
      const jsonText = customJson ?? JSON.stringify(packageData, null, 2);
      const result = await importRuleset(jsonText, { conflictResolution });
      importResult = result;
      if (result.imported > 0) {
        toastSuccess(
          `规则集导入成功:${result.imported} 条规则${result.skipped > 0 ? `,跳过 ${result.skipped} 条` : ""}`,
        );
      } else if (result.skipped > 0) {
        toastInfo(`全部 ${result.skipped} 条规则已存在,已跳过`);
      } else {
        toastError("规则集导入失败:0 条规则被导入");
      }
    } catch (e) {
      toastError(`导入失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      importing = false;
    }
  }

  // === 文件上传 ===
  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      customJson = reader.result as string;
      customName = file.name;
      packageData = null;
      importResult = null;
      toastInfo(`已加载文件:${file.name}`);
    };
    reader.onerror = () => toastError("文件读取失败");
    reader.readAsText(file);
  }

  // === 重置为内置 ===
  function resetToBuiltin() {
    customJson = null;
    customName = "自定义规则集";
    importResult = null;
    loadBuiltinPackage();
  }

  const conflictOptions: {
    value: ConflictResolution;
    label: string;
    desc: string;
  }[] = [
    {
      value: "rename",
      label: "重命名(推荐)",
      desc: "冲突时加后缀导入为新规则",
    },
    { value: "skip", label: "跳过", desc: "已存在的规则直接跳过" },
    { value: "overwrite", label: "覆盖", desc: "导入为新版本,标记冲突" },
    { value: "merge", label: "合并", desc: "P0 降级为重命名" },
  ];

  function reset() {
    importResult = null;
  }
</script>

{#if open}
  <div
    class="ri-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="官方规则集导入向导"
    onclick={(e) => {
      if (e.currentTarget === e.target && !importing) onClose();
    }}
    onkeydown={(e) => {
      if (e.key === "Escape" && !importing) onClose();
    }}
    tabindex="-1"
  >
    <div class="ri-dialog">
      <header class="ri-header">
        <h2 class="ri-title">📥 官方规则集导入</h2>
        <button
          class="ri-close"
          onclick={onClose}
          disabled={importing}
          aria-label="关闭">✕</button
        >
      </header>

      <div class="ri-body">
        <!-- 数据源切换 -->
        <div class="ri-source-bar">
          <button
            class="ri-source-btn"
            class:active={!customJson}
            onclick={resetToBuiltin}
          >
            内置:等保 2.0 三级门禁
          </button>
          <button
            class="ri-source-btn"
            class:active={!!customJson}
            onclick={() => fileInput?.click()}
          >
            📂 从文件导入 ruleset.json
          </button>
          <input
            bind:this={fileInput}
            type="file"
            accept=".json,application/json"
            onchange={handleFileChange}
            style="display:none"
          />
        </div>

        {#if customJson}
          <!-- 自定义文件预览 -->
          <section class="ri-section">
            <div class="ri-section-title">已加载文件:{customName}</div>
            <div class="ri-custom-info">
              <span class="ri-badge info">自定义规则集</span>
              <span class="ri-hint">点击"导入"按钮执行</span>
            </div>
          </section>
        {:else if loading}
          <div class="ri-loading">⏳ 正在加载内置规则集...</div>
        {:else if packageData}
          <!-- 规则集元信息 -->
          <section class="ri-section">
            <div class="ri-meta">
              <h3 class="ri-meta-name">{packageData.meta.name}</h3>
              <p class="ri-meta-desc">{packageData.meta.description}</p>
              <div class="ri-meta-tags">
                <span class="ri-badge standard"
                  >{packageData.meta.standard}</span
                >
                <span class="ri-badge level">L{packageData.meta.level}</span>
                <span class="ri-badge version"
                  >v{packageData.meta.rulesetVersion}</span
                >
                {#each packageData.meta.tags as tag (tag)}
                  <span class="ri-badge tag">{tag}</span>
                {/each}
              </div>
              <div class="ri-meta-info">
                <span>作者:{packageData.meta.author}</span>
                <span>许可:{packageData.meta.license}</span>
                <span>规则数:{packageData.rules.length}</span>
              </div>
              <div class="ri-hash">
                contentHash(BLAKE3):{packageData.contentHash.slice(0, 24)}...
              </div>
            </div>
          </section>

          <!-- 规则列表 -->
          <section class="ri-section">
            <div class="ri-section-title">
              门禁规则清单({packageData.rules.length} 条)
            </div>
            <div class="ri-rule-list">
              {#each packageData.rules as rule, i (rule.id)}
                <div class="ri-rule-card">
                  <div class="ri-rule-header">
                    <span class="ri-rule-idx">#{i + 1}</span>
                    <span class="ri-rule-id">{rule.id}</span>
                    {#if rule.compliance}
                      <span class="ri-badge risk-{rule.compliance.riskLevel}">
                        {RISK_LEVEL_LABELS[rule.compliance.riskLevel]}
                      </span>
                    {/if}
                  </div>
                  <div class="ri-rule-desc">{rule.description}</div>
                  {#if rule.compliance}
                    <div class="ri-rule-compliance">
                      <span class="ri-clause"
                        >条款 {rule.compliance.clause}</span
                      >
                      <span class="ri-clause-title"
                        >{rule.compliance.clauseTitle}</span
                      >
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </section>

          <!-- 合规条款映射 -->
          {#if packageData.complianceMapping && packageData.complianceMapping.length > 0}
            <section class="ri-section">
              <div class="ri-section-title">合规条款映射</div>
              <div class="ri-mapping-list">
                {#each packageData.complianceMapping as m (m.clause)}
                  <div class="ri-mapping">
                    <span class="ri-mapping-clause">{m.clause}</span>
                    <span class="ri-mapping-title">{m.clauseTitle}</span>
                    <span class="ri-mapping-req">{m.requirement}</span>
                  </div>
                {/each}
              </div>
            </section>
          {/if}
        {/if}

        <!-- 冲突策略 -->
        <section class="ri-section">
          <div class="ri-section-title">冲突处理策略</div>
          <div class="ri-conflict-grid">
            {#each conflictOptions as opt (opt.value)}
              <label
                class="ri-conflict-card"
                class:selected={conflictResolution === opt.value}
              >
                <input
                  type="radio"
                  name="conflict"
                  value={opt.value}
                  checked={conflictResolution === opt.value}
                  onchange={() => (conflictResolution = opt.value)}
                />
                <span class="ri-conflict-label">{opt.label}</span>
                <span class="ri-conflict-desc">{opt.desc}</span>
              </label>
            {/each}
          </div>
        </section>

        <!-- 导入结果 -->
        {#if importResult}
          <section class="ri-section ri-result">
            <div class="ri-section-title">导入结果</div>
            <div class="ri-result-summary">
              <span class="ri-result-stat ok"
                >✅ 导入 {importResult.imported} 条</span
              >
              <span class="ri-result-stat skip"
                >⏭️ 跳过 {importResult.skipped} 条</span
              >
              <span class="ri-result-stat time"
                >⏱️ {importResult.durationMs}ms</span
              >
            </div>
            {#if importResult.conflicts.length > 0}
              <details class="ri-conflicts">
                <summary>冲突详情({importResult.conflicts.length} 条)</summary>
                <ul>
                  {#each importResult.conflicts as c (c)}
                    <li>{c}</li>
                  {/each}
                </ul>
              </details>
            {/if}
          </section>
        {/if}
      </div>

      <footer class="ri-footer">
        <button class="ri-btn" onclick={onClose} disabled={importing}
          >关闭</button
        >
        {#if importResult}
          <button class="ri-btn" onclick={reset} disabled={importing}
            >重新导入</button
          >
        {/if}
        <button
          class="ri-btn primary"
          onclick={handleImport}
          disabled={importing || (!packageData && !customJson)}
        >
          {importing ? "⏳ 导入中..." : "📥 导入规则集"}
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .ri-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .ri-dialog {
    background: var(--bg-card);
    border-radius: 8px;
    width: 720px;
    max-width: 92vw;
    max-height: 88vh;
    display: flex;
    flex-direction: column;
  }
  .ri-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 20px;
    border-bottom: 1px solid var(--color-gray-200, #e5e7eb);
  }
  .ri-title {
    margin: 0;
    font-size: 17px;
    color: var(--color-text-primary, #111827);
  }
  .ri-close {
    background: none;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: var(--color-gray-500, #6b7280);
    padding: 4px;
  }
  .ri-body {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
  }
  .ri-source-bar {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }
  .ri-source-btn {
    padding: 6px 12px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    background: var(--bg-card);
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    color: var(--color-text-secondary, #4b5563);
  }
  .ri-source-btn.active {
    background: var(--color-primary, #2563eb);
    border-color: var(--color-primary, #2563eb);
    color: white;
  }
  .ri-loading {
    padding: 40px;
    text-align: center;
    color: var(--color-gray-500, #6b7280);
    font-size: 14px;
  }
  .ri-section {
    margin-bottom: 16px;
  }
  .ri-section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary, #111827);
    margin-bottom: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--color-gray-100, #f3f4f6);
  }
  .ri-meta {
    padding: 12px;
    background: #f9fafb;
    border-radius: 6px;
  }
  .ri-meta-name {
    margin: 0 0 4px;
    font-size: 15px;
    color: var(--color-primary, #2563eb);
  }
  .ri-meta-desc {
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--color-text-secondary, #4b5563);
  }
  .ri-meta-tags {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .ri-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 600;
  }
  .ri-badge.standard {
    background: var(--color-info-bg, #dbeafe);
    color: var(--color-info, #1e40af);
  }
  .ri-badge.level {
    background: var(--color-warning-bg, #fef3c7);
    color: var(--color-warning, #92400e);
  }
  .ri-badge.version {
    background: #e0e7ff;
    color: #3730a3;
  }
  .ri-badge.tag {
    background: #f3f4f6;
    color: #4b5563;
  }
  .ri-badge.info {
    background: var(--color-info-bg, #dbeafe);
    color: var(--color-info, #1e40af);
  }
  .ri-badge.risk-low {
    background: var(--color-success-bg, #d1fae5);
    color: var(--color-success, #065f46);
  }
  .ri-badge.risk-medium {
    background: var(--color-warning-bg, #fef3c7);
    color: var(--color-warning, #92400e);
  }
  .ri-badge.risk-high {
    background: var(--color-error-bg, #fee2e2);
    color: var(--color-error, #991b1b);
  }
  .ri-badge.risk-critical {
    background: #fecaca;
    color: #7f1d1d;
  }
  .ri-meta-info {
    display: flex;
    gap: 16px;
    font-size: 11px;
    color: var(--color-gray-500, #6b7280);
    margin-bottom: 4px;
  }
  .ri-hash {
    font-size: 10px;
    color: var(--color-gray-400, #9ca3af);
    font-family: monospace;
  }
  .ri-rule-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ri-rule-card {
    padding: 8px 10px;
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 4px;
  }
  .ri-rule-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .ri-rule-idx {
    font-size: 10px;
    color: var(--color-gray-400, #9ca3af);
    font-weight: 600;
  }
  .ri-rule-id {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-primary, #111827);
    font-family: monospace;
  }
  .ri-rule-desc {
    font-size: 11px;
    color: var(--color-text-secondary, #4b5563);
  }
  .ri-rule-compliance {
    display: flex;
    gap: 8px;
    margin-top: 4px;
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
  }
  .ri-mapping-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ri-mapping {
    display: flex;
    gap: 8px;
    padding: 6px 8px;
    background: #f9fafb;
    border-radius: 4px;
    font-size: 11px;
  }
  .ri-mapping-clause {
    font-weight: 600;
    color: var(--color-primary, #2563eb);
    min-width: 80px;
  }
  .ri-mapping-title {
    color: var(--color-text-secondary, #4b5563);
    min-width: 140px;
  }
  .ri-mapping-req {
    color: var(--color-gray-500, #6b7280);
  }
  .ri-custom-info {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 10px;
    background: #f9fafb;
    border-radius: 6px;
  }
  .ri-hint {
    font-size: 11px;
    color: var(--color-gray-500, #6b7280);
  }
  .ri-conflict-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .ri-conflict-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 4px;
    cursor: pointer;
  }
  .ri-conflict-card.selected {
    border-color: var(--color-primary, #2563eb);
    background: var(--color-info-bg, #eff6ff);
  }
  .ri-conflict-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-primary, #111827);
  }
  .ri-conflict-desc {
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
  }
  .ri-result {
    padding: 12px;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 6px;
  }
  .ri-result-summary {
    display: flex;
    gap: 16px;
    margin-bottom: 8px;
  }
  .ri-result-stat {
    font-size: 13px;
    font-weight: 600;
  }
  .ri-result-stat.ok {
    color: #15803d;
  }
  .ri-result-stat.skip {
    color: #a16207;
  }
  .ri-result-stat.time {
    color: var(--color-gray-500, #6b7280);
    font-weight: 400;
  }
  .ri-conflicts {
    margin-top: 8px;
    font-size: 11px;
  }
  .ri-conflicts summary {
    cursor: pointer;
    color: var(--color-text-secondary, #4b5563);
  }
  .ri-conflicts ul {
    margin: 4px 0 0;
    padding-left: 20px;
    color: var(--color-gray-500, #6b7280);
  }
  .ri-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--color-gray-200, #e5e7eb);
  }
  .ri-btn {
    padding: 8px 16px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    background: var(--bg-card);
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-secondary, #4b5563);
  }
  .ri-btn.primary {
    background: var(--color-primary, #2563eb);
    border-color: var(--color-primary, #2563eb);
    color: white;
  }
  .ri-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
