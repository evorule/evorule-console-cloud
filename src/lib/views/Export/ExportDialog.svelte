<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:通用导出对话框(P07 §6 + §3.6 决策 6)
    - 内容选择器:6 种 ExportContentType(多选,至少 1 个)
    - 格式选择器:4 种 ExportFormat(单选)
    - 筛选面板:时间范围 / Fact 类型 / 版本范围 / 决策结果
    - 模板选择:3 个 builtin + 用户自定义(加载后填充全部字段)
    - 渲染选项:includeRaw / includeBusiness / includeIntegrity / includeMeta
    - 进度条:导出中状态
    - 预设(preset):由调用方传入,预填内容/筛选
  入口(P07 §3.6 决策 6):
    - P05 InterventionBar(preset: { contents: ['audit_chain'] })
    - P06 BusinessAuditView(preset: { contents: ['audit_chain', 'causal_chain'], filters: { timeRange: 'visible' } })
    - 独立 /export 路由(preset: {})
  关联设计:P07_RESULT_EXPORT_DESIGN.md §6 + §3.6
-->

<script lang="ts">
  import { get } from "svelte/store";
  import { currentSessionId, useBackend } from "@evorule/console";
  import {
    exportExecutionStore,
    exportTemplatesStore,
    executeExportAndDownload,
    executeTemplateExport,
    addUserTemplate,
    deleteUserTemplate,
  } from "$lib/stores/export-store";
  import {
    CONTENT_TYPE_LABELS,
    FORMAT_LABELS,
    type ExportContentType,
    type ExportFormat,
    type ExportFilters,
    type ExportRenderOptions,
    type ExportTemplate,
    type TimeRange,
  } from "$lib/stores/export-types";
  import { toastInfo, toastError } from "$lib/stores/toast";
  import { CloudHttpBackend } from "$lib/backend/cloud-http-backend";

  interface Props {
    /** 是否打开 */
    open: boolean;
    /** 预设(由调用方传入,预填内容/筛选) */
    preset?: {
      contents?: ExportContentType[];
      filters?: Partial<ExportFilters>;
    };
    /** 关闭回调 */
    onClose: () => void;
  }

  let { open, preset, onClose }: Props = $props();

  // === Context ===
  const backend = useBackend();

  // === 状态 ===
  let selectedContents = $state<Set<ExportContentType>>(new Set());
  let selectedFormat = $state<ExportFormat>("json");
  let filters = $state<ExportFilters>({});
  let renderOptions = $state<ExportRenderOptions>({
    includeRaw: true,
    includeBusiness: true,
    includeIntegrity: true,
    includeMeta: true,
  });
  let selectedTemplateId = $state<string>("");

  // 模板保存对话框
  let showSaveTemplate = $state(false);
  let newTemplateName = $state("");
  let newTemplateDescription = $state("");

  // === 派生 ===
  let sessionId = $derived($currentSessionId);
  let execState = $derived($exportExecutionStore);
  let templates = $derived($exportTemplatesStore);
  let canExport = $derived(
    sessionId !== null && selectedContents.size > 0 && !execState.exporting,
  );

  // === preset 变化时初始化 ===
  $effect(() => {
    if (!open) return;
    // 重置为 preset 或默认
    if (preset?.contents?.length) {
      selectedContents = new Set(preset.contents);
    } else {
      selectedContents = new Set(["audit_chain"]);
    }
    if (preset?.filters) {
      filters = { ...preset.filters } as ExportFilters;
    } else {
      filters = { timeRange: { kind: "all" } };
    }
    selectedFormat = "json";
    selectedTemplateId = "";
  });

  // === 内容类型切换 ===
  function toggleContent(type: ExportContentType): void {
    if (selectedContents.has(type)) {
      selectedContents.delete(type);
    } else {
      selectedContents.add(type);
    }
    selectedContents = new Set(selectedContents); // 触发响应式
  }

  // === 时间范围类型切换 ===
  let timeRangeKind = $state<"all" | "visible" | "last" | "absolute">("all");

  $effect(() => {
    const tr = filters.timeRange;
    if (!tr) {
      timeRangeKind = "all";
    } else {
      timeRangeKind = tr.kind;
    }
  });

  function setTimeRangeKind(kind: typeof timeRangeKind): void {
    timeRangeKind = kind;
    switch (kind) {
      case "all":
        filters = { ...filters, timeRange: { kind: "all" } };
        break;
      case "visible":
        filters = { ...filters, timeRange: { kind: "visible" } };
        break;
      case "last":
        filters = {
          ...filters,
          timeRange: { kind: "last", value: 24, unit: "hours" },
        };
        break;
      case "absolute":
        filters = {
          ...filters,
          timeRange: {
            kind: "absolute",
            from: new Date(Date.now() - 86400_000).toISOString(),
            to: new Date().toISOString(),
          },
        };
        break;
    }
  }

  // === 模板加载 ===
  function loadTemplate(template: ExportTemplate): void {
    selectedContents = new Set(template.content.contents);
    selectedFormat = template.format;
    filters = { ...template.content.filters };
    if (template.renderOptions) {
      renderOptions = { ...template.renderOptions };
    }
    selectedTemplateId = template.id;
    toastInfo(`已加载模板: ${template.name}`);
  }

  // === 执行导出 ===
  async function handleExport(): Promise<void> {
    if (sessionId === null) {
      toastError("无活动 session,无法导出");
      return;
    }
    if (selectedContents.size === 0) {
      toastError("请至少选择一种导出内容");
      return;
    }

    // 多内容选择时,聚合为 comprehensive 类型;否则用单内容
    const contentsArr = Array.from(selectedContents);
    const primaryContent: ExportContentType =
      contentsArr.length > 1 ? "comprehensive" : contentsArr[0];

    // 获取 serverBaseUrl(用于 PDF 服务端渲染)
    const serverBaseUrl =
      backend instanceof CloudHttpBackend ? backend.baseUrl : undefined;

    // 若选了模板,用模板的完整配置
    if (selectedTemplateId) {
      const tpl = templates.find((t) => t.id === selectedTemplateId);
      if (tpl) {
        await executeTemplateExport(backend, sessionId, tpl, serverBaseUrl);
        return;
      }
    }

    // 否则用当前 UI 配置
    await executeExportAndDownload(
      backend,
      sessionId,
      primaryContent,
      selectedFormat,
      filters,
      renderOptions,
      undefined,
      serverBaseUrl,
    );
  }

  // === 保存为模板 ===
  function openSaveTemplate(): void {
    if (selectedContents.size === 0) {
      toastError("请先选择导出内容");
      return;
    }
    newTemplateName = "";
    newTemplateDescription = "";
    showSaveTemplate = true;
  }

  function handleSaveTemplate(): void {
    if (!newTemplateName.trim()) {
      toastError("请输入模板名称");
      return;
    }
    const contentsArr = Array.from(selectedContents);
    const primaryContent: ExportContentType =
      contentsArr.length > 1 ? "comprehensive" : contentsArr[0];

    try {
      const id = addUserTemplate({
        name: newTemplateName.trim(),
        description: newTemplateDescription.trim(),
        content: {
          contents: contentsArr,
          filters,
        },
        format: selectedFormat,
        renderOptions,
      });
      toastInfo(`模板已保存: ${newTemplateName} (id: ${id})`);
      showSaveTemplate = false;
    } catch (e) {
      toastError(`保存模板失败: ${(e as Error).message}`);
    }
  }

  function handleDeleteTemplate(id: string): void {
    try {
      deleteUserTemplate(id);
      if (selectedTemplateId === id) {
        selectedTemplateId = "";
      }
      toastInfo("模板已删除");
    } catch (e) {
      toastError((e as Error).message);
    }
  }

  // === 内容类型列表 ===
  const contentTypes: ExportContentType[] = [
    "fact_stream",
    "decision_log",
    "audit_chain",
    "state_snapshot",
    "causal_chain",
    "comprehensive",
  ];

  const formats: ExportFormat[] = ["json", "csv", "pdf", "xml"];
</script>

{#if open}
  <div
    class="export-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="通用导出对话框"
    tabindex="-1"
    onclick={(e) => {
      if (e.currentTarget === e.target && !execState.exporting) onClose();
    }}
    onkeydown={(e) => {
      if (e.key === "Escape" && !execState.exporting) onClose();
    }}
  >
    <div class="export-dialog">
      <header class="ed-header">
        <h2 class="ed-title">📤 通用结果导出</h2>
        <button
          class="ed-close"
          onclick={onClose}
          disabled={execState.exporting}
          aria-label="关闭">✕</button
        >
      </header>

      <div class="ed-body">
        {#if sessionId === null}
          <div class="ed-warning">
            ⚠️ 无活动 session,请先在执行台创建 session 或等待滚动 session
            切换完成。
          </div>
        {/if}

        <!-- 1. 内容选择 -->
        <section class="ed-section">
          <div class="ed-section-title">
            1. 选择导出内容 <span class="ed-hint"
              >(可多选,多选时合并为综合报告)</span
            >
          </div>
          <div class="ed-content-grid">
            {#each contentTypes as ct}
              <label
                class="ed-content-card"
                class:selected={selectedContents.has(ct)}
              >
                <input
                  type="checkbox"
                  checked={selectedContents.has(ct)}
                  onchange={() => toggleContent(ct)}
                />
                <span class="ed-content-label">{CONTENT_TYPE_LABELS[ct]}</span>
              </label>
            {/each}
          </div>
        </section>

        <!-- 2. 格式选择 -->
        <section class="ed-section">
          <div class="ed-section-title">2. 选择导出格式</div>
          <div class="ed-format-grid">
            {#each formats as fmt}
              <label
                class="ed-format-card"
                class:selected={selectedFormat === fmt}
              >
                <input
                  type="radio"
                  name="format"
                  value={fmt}
                  checked={selectedFormat === fmt}
                  onchange={() => (selectedFormat = fmt)}
                />
                <span class="ed-format-label">{FORMAT_LABELS[fmt]}</span>
              </label>
            {/each}
          </div>
        </section>

        <!-- 3. 筛选条件 -->
        <section class="ed-section">
          <div class="ed-section-title">3. 筛选条件</div>

          <div class="ed-filter-row">
            <label class="ed-filter-label" for="ed-filter-time-range">时间范围:</label>
            <select
              id="ed-filter-time-range"
              value={timeRangeKind}
              onchange={(e) =>
                setTimeRangeKind(e.currentTarget.value as typeof timeRangeKind)}
            >
              <option value="all">全部</option>
              <option value="visible">当前视图可见</option>
              <option value="last">最近 N 单位</option>
              <option value="absolute">绝对时间范围</option>
            </select>

            {#if filters.timeRange?.kind === "last"}
              <input
                type="number"
                min="1"
                value={filters.timeRange.value}
                onchange={(e) =>
                  (filters = {
                    ...filters,
                    timeRange: {
                      ...(filters.timeRange as {
                        kind: "last";
                        value: number;
                        unit: "minutes" | "hours" | "days";
                      }),
                      value: Number(e.currentTarget.value),
                    },
                  })}
                style="width: 70px"
              />
              <select
                value={filters.timeRange.unit}
                onchange={(e) =>
                  (filters = {
                    ...filters,
                    timeRange: {
                      ...(filters.timeRange as {
                        kind: "last";
                        value: number;
                        unit: "minutes" | "hours" | "days";
                      }),
                      unit: e.currentTarget.value as
                        | "minutes"
                        | "hours"
                        | "days",
                    },
                  })}
              >
                <option value="minutes">分钟</option>
                <option value="hours">小时</option>
                <option value="days">天</option>
              </select>
            {/if}

            {#if filters.timeRange?.kind === "absolute"}
              <input
                type="datetime-local"
                onchange={(e) =>
                  (filters = {
                    ...filters,
                    timeRange: {
                      kind: "absolute",
                      from: new Date(e.currentTarget.value).toISOString(),
                      to: (
                        filters.timeRange as {
                          kind: "absolute";
                          from: string;
                          to: string;
                        }
                      ).to,
                    },
                  })}
                style="width: 200px"
              />
              <span>至</span>
              <input
                type="datetime-local"
                onchange={(e) =>
                  (filters = {
                    ...filters,
                    timeRange: {
                      kind: "absolute",
                      from: (
                        filters.timeRange as {
                          kind: "absolute";
                          from: string;
                          to: string;
                        }
                      ).from,
                      to: new Date(e.currentTarget.value).toISOString(),
                    },
                  })}
                style="width: 200px"
              />
            {/if}
          </div>

          <div class="ed-filter-row">
            <label class="ed-filter-label" for="ed-filter-fact-types">Fact 类型筛选:</label>
            <input
              id="ed-filter-fact-types"
              type="text"
              placeholder="逗号分隔,如 patient_visit,drug_prescribe(留空=全部)"
              onchange={(e) =>
                (filters = {
                  ...filters,
                  factTypes: e.currentTarget.value
                    ? e.currentTarget.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    : undefined,
                })}
              style="flex: 1; min-width: 200px"
            />
          </div>

          <div class="ed-filter-row">
            <label class="ed-filter-label" for="ed-filter-version-range">版本范围:</label>
            <input
              id="ed-filter-version-range"
              type="number"
              min="0"
              placeholder="起始版本"
              onchange={(e) => {
                const v = e.currentTarget.value
                  ? Number(e.currentTarget.value)
                  : undefined;
                const cur = filters.versionRange ?? { from: 0, to: 0 };
                filters = {
                  ...filters,
                  versionRange:
                    v !== undefined ? { ...cur, from: v } : undefined,
                };
              }}
              style="width: 100px"
            />
            <span>—</span>
            <input
              type="number"
              min="0"
              placeholder="结束版本"
              onchange={(e) => {
                const v = e.currentTarget.value
                  ? Number(e.currentTarget.value)
                  : undefined;
                const cur = filters.versionRange ?? { from: 0, to: 0 };
                filters = {
                  ...filters,
                  versionRange: v !== undefined ? { ...cur, to: v } : undefined,
                };
              }}
              style="width: 100px"
            />
          </div>
        </section>

        <!-- 4. 渲染选项 -->
        <section class="ed-section">
          <div class="ed-section-title">4. 渲染选项</div>
          <div class="ed-options-grid">
            <label class="ed-option">
              <input
                type="checkbox"
                checked={renderOptions.includeRaw}
                onchange={(e) =>
                  (renderOptions = {
                    ...renderOptions,
                    includeRaw: e.currentTarget.checked,
                  })}
              />
              <span>包含 raw 字段(JSON 默认 ✓)</span>
            </label>
            <label class="ed-option">
              <input
                type="checkbox"
                checked={renderOptions.includeBusiness}
                onchange={(e) =>
                  (renderOptions = {
                    ...renderOptions,
                    includeBusiness: e.currentTarget.checked,
                  })}
              />
              <span>包含业务化字段</span>
            </label>
            <label class="ed-option">
              <input
                type="checkbox"
                checked={renderOptions.includeIntegrity}
                onchange={(e) =>
                  (renderOptions = {
                    ...renderOptions,
                    includeIntegrity: e.currentTarget.checked,
                  })}
              />
              <span>嵌入 BLAKE3 完整性段(合规卖点)</span>
            </label>
            <label class="ed-option">
              <input
                type="checkbox"
                checked={renderOptions.includeMeta}
                onchange={(e) =>
                  (renderOptions = {
                    ...renderOptions,
                    includeMeta: e.currentTarget.checked,
                  })}
              />
              <span>包含导出元数据(操作人/时间/版本)</span>
            </label>
          </div>
        </section>

        <!-- 5. 模板 -->
        <section class="ed-section">
          <div class="ed-section-title">5. 模板(可选 — 加载后填充全部字段)</div>
          <div class="ed-template-list">
            {#each templates as tpl (tpl.id)}
              <div
                class="ed-template-card"
                class:selected={selectedTemplateId === tpl.id}
              >
                <button
                  class="ed-template-load"
                  onclick={() => loadTemplate(tpl)}
                >
                  <div class="ed-template-name">{tpl.name}</div>
                  <div class="ed-template-desc">{tpl.description}</div>
                  <div class="ed-template-meta">
                    <span class="ed-template-format"
                      >{tpl.format.toUpperCase()}</span
                    >
                    <span class="ed-template-source"
                      >{tpl.source === "builtin" ? "内置" : "自定义"}</span
                    >
                  </div>
                </button>
                {#if tpl.source === "user"}
                  <button
                    class="ed-template-delete"
                    onclick={() => handleDeleteTemplate(tpl.id)}
                    title="删除模板"
                    aria-label="删除模板">🗑</button
                  >
                {/if}
              </div>
            {/each}
          </div>
          <button class="ed-save-template-btn" onclick={openSaveTemplate}>
            💾 保存当前配置为模板
          </button>
        </section>

        <!-- 进度 -->
        {#if execState.exporting || execState.message}
          <div class="ed-progress" class:err={!!execState.error}>
            <div
              class="ed-progress-bar"
              style="width: {execState.progress}%"
            ></div>
            <div class="ed-progress-text">
              {execState.message}
              {#if execState.progress > 0 && execState.progress < 100}
                ({execState.progress}%)
              {/if}
            </div>
          </div>
        {/if}

        {#if execState.error}
          <div class="ed-error">⚠️ {execState.error}</div>
        {/if}
      </div>

      <footer class="ed-footer">
        <button
          class="ed-btn ed-cancel"
          onclick={onClose}
          disabled={execState.exporting}>取消</button
        >
        <button
          class="ed-btn ed-primary"
          onclick={handleExport}
          disabled={!canExport}
        >
          {execState.exporting ? "⏳ 导出中…" : "📤 立即导出"}
        </button>
      </footer>
    </div>

    <!-- 保存模板对话框 -->
    {#if showSaveTemplate}
      <div
        class="ed-sub-overlay"
        role="button"
        tabindex="-1"
        aria-label="关闭保存模板对话框"
        onclick={(e) => {
          if (e.currentTarget === e.target) showSaveTemplate = false;
        }}
        onkeydown={(e) => {
          if (e.key === "Escape") showSaveTemplate = false;
        }}
      >
        <div class="ed-sub-dialog">
          <h3>💾 保存为模板</h3>
          <label class="ed-sub-label">
            模板名称:
            <input
              type="text"
              bind:value={newTemplateName}
              placeholder="如:每周合规审计导出"
              style="width: 100%"
            />
          </label>
          <label class="ed-sub-label">
            描述:
            <textarea
              bind:value={newTemplateDescription}
              placeholder="模板用途说明"
              rows="2"
              style="width: 100%"
            ></textarea>
          </label>
          <div class="ed-sub-footer">
            <button
              class="ed-btn ed-cancel"
              onclick={() => (showSaveTemplate = false)}>取消</button
            >
            <button class="ed-btn ed-primary" onclick={handleSaveTemplate}>
              保存
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .export-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1200;
    overflow: auto;
    padding: 16px;
  }
  .export-dialog {
    background: white;
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
    width: 100%;
    max-width: 720px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .ed-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--color-gray-200, #e5e7eb);
    background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
    flex-shrink: 0;
  }
  .ed-title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: #1e40af;
  }
  .ed-close {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 16px;
    color: var(--color-gray-500, #6b7280);
    padding: 0 4px;
  }
  .ed-close:hover:not(:disabled) {
    color: var(--color-gray-700, #374151);
  }
  .ed-close:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ed-body {
    padding: 16px 18px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }
  .ed-warning {
    padding: 8px 12px;
    background: #fef3c7;
    border: 1px solid #fde68a;
    border-radius: 6px;
    color: #92400e;
    font-size: 12px;
    margin-bottom: 12px;
  }

  .ed-section {
    margin-bottom: 14px;
  }
  .ed-section-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--color-text-primary, #111827);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .ed-hint {
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
  }

  .ed-content-grid,
  .ed-format-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 6px;
  }
  .ed-content-card,
  .ed-format-card {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    border-radius: 5px;
    cursor: pointer;
    font-size: 12px;
    background: white;
  }
  .ed-content-card.selected,
  .ed-format-card.selected {
    border-color: var(--color-primary, #2563eb);
    background: #eff6ff;
    color: #1e40af;
  }
  .ed-content-card input,
  .ed-format-card input {
    margin: 0;
  }

  .ed-filter-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
    flex-wrap: wrap;
    font-size: 12px;
  }
  .ed-filter-label {
    font-weight: 600;
    color: var(--color-gray-700, #374151);
    min-width: 90px;
  }
  .ed-filter-row select,
  .ed-filter-row input {
    font-size: 11px;
    padding: 3px 6px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    border-radius: 4px;
    font-family: inherit;
  }

  .ed-options-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 4px;
  }
  .ed-option {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--color-gray-700, #374151);
    cursor: pointer;
  }
  .ed-option input {
    margin: 0;
  }

  .ed-template-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 8px;
  }
  .ed-template-card {
    display: flex;
    align-items: stretch;
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 6px;
    overflow: hidden;
  }
  .ed-template-card.selected {
    border-color: var(--color-primary, #2563eb);
    background: #eff6ff;
  }
  .ed-template-load {
    flex: 1;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: 8px 10px;
    font-family: inherit;
  }
  .ed-template-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-primary, #111827);
  }
  .ed-template-desc {
    font-size: 11px;
    color: var(--color-gray-600, #4b5563);
    margin: 2px 0;
  }
  .ed-template-meta {
    display: flex;
    gap: 6px;
    font-size: 10px;
  }
  .ed-template-format {
    font-family: var(--font-mono, monospace);
    color: #7c3aed;
    background: #f5f3ff;
    padding: 0 5px;
    border-radius: 2px;
  }
  .ed-template-source {
    color: var(--color-gray-500, #6b7280);
  }
  .ed-template-delete {
    background: transparent;
    border: none;
    border-left: 1px solid var(--color-gray-200, #e5e7eb);
    cursor: pointer;
    padding: 0 10px;
    font-size: 12px;
    color: var(--color-gray-400, #9ca3af);
  }
  .ed-template-delete:hover {
    color: #ef4444;
    background: #fef2f2;
  }

  .ed-save-template-btn {
    font-size: 11px;
    padding: 5px 10px;
    background: white;
    border: 1px dashed var(--color-gray-400, #9ca3af);
    border-radius: 4px;
    cursor: pointer;
    color: var(--color-gray-600, #4b5563);
  }
  .ed-save-template-btn:hover {
    background: var(--color-gray-50, #f9fafb);
  }

  .ed-progress {
    margin: 10px 0;
    padding: 8px 10px;
    background: var(--color-gray-50, #f9fafb);
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 6px;
    position: relative;
    overflow: hidden;
  }
  .ed-progress-bar {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, #dbeafe 0%, #bfdbfe 100%);
    transition: width 0.3s ease;
    z-index: 0;
  }
  .ed-progress-text {
    position: relative;
    z-index: 1;
    font-size: 11px;
    color: var(--color-text-primary, #111827);
    font-weight: 500;
  }
  .ed-progress.err .ed-progress-bar {
    background: #fee2e2;
  }

  .ed-error {
    margin: 8px 0;
    padding: 8px 10px;
    background: #fef2f2;
    border: 1px solid #fca5a5;
    border-radius: 6px;
    color: #991b1b;
    font-size: 11px;
  }

  .ed-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    background: var(--color-gray-50, #f9fafb);
    border-top: 1px solid var(--color-gray-200, #e5e7eb);
    flex-shrink: 0;
  }
  .ed-btn {
    font-size: 12px;
    padding: 7px 16px;
    border-radius: 5px;
    border: 1px solid;
    cursor: pointer;
    font-family: inherit;
    font-weight: 600;
  }
  .ed-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ed-cancel {
    background: white;
    border-color: var(--color-gray-300, #d1d5db);
    color: var(--color-text-secondary, #4b5563);
  }
  .ed-primary {
    background: var(--color-primary, #2563eb);
    border-color: var(--color-primary, #2563eb);
    color: white;
  }
  .ed-primary:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .ed-sub-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1300;
  }
  .ed-sub-dialog {
    background: white;
    border-radius: 8px;
    padding: 18px;
    width: 100%;
    max-width: 400px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
  }
  .ed-sub-dialog h3 {
    margin: 0 0 12px;
    font-size: 14px;
    color: var(--color-text-primary, #111827);
  }
  .ed-sub-label {
    display: block;
    font-size: 12px;
    color: var(--color-gray-700, #374151);
    margin-bottom: 10px;
  }
  .ed-sub-label input,
  .ed-sub-label textarea {
    margin-top: 4px;
    font-size: 12px;
    padding: 4px 6px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    border-radius: 4px;
    font-family: inherit;
  }
  .ed-sub-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
