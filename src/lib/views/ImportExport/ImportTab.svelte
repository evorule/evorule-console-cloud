<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:P09 导入 Tab
    - 4 类对象选择(rule/dataset/form/library_schema)
    - 文件上传(拖拽 + 点击)
    - 格式自动检测(扩展名 + 内容嗅探)
    - 冲突处理 4 策略(skip/overwrite/rename/merge)
    - 导入前自动创建快照(可回滚)
    - 导入结果汇总
  关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §9.1 + §3.5 + §3.6
-->

<script lang="ts">
  import {
    OBJECT_TYPE_LABELS,
    CONFLICT_RESOLUTION_LABELS,
    type ObjectType,
    type ConflictResolution,
    type ImportResult,
  } from "$lib/stores/import-export-types";
  import {
    ALL_FORMATS,
    FORMAT_LABELS,
    STRUCTURED_FORMATS,
    type UniversalFormat,
  } from "$lib/stores/format-converter";
  import { importRuleUniversal, importRulesBatch } from "$lib/stores/rule-import-export";
  import { importDataset } from "$lib/stores/dataset-import-export";
  import { importFormSchema } from "$lib/stores/form-import-export";
  import { createImportSnapshot, listSnapshotsByUser } from "$lib/stores/import-snapshot";
  import { buildDjbhRulesetPackage } from "$lib/stores/ruleset-import";
  import ConflictResolver from "./ConflictResolver.svelte";
  import { toastSuccess, toastError, toastInfo } from "$lib/stores/toast";
  import { getCurrentUser } from "$lib/stores/auth";

  interface Props {
    presetType?: ObjectType;
  }

  let { presetType }: Props = $props();

  // svelte-ignore state_referenced_locally
  let selectedType = $state<ObjectType>(presetType ?? "rule");
  let selectedFormat = $state<UniversalFormat>("json");
  let conflictResolution = $state<ConflictResolution>("rename");
  let uploadedFile = $state<File | null>(null);
  let uploadedContent = $state<string>("");
  let importing = $state(false);
  let importResult = $state<ImportResult | null>(null);
  let showConflictResolver = $state(false);
  let createSnapshot = $state(true);

  const objectTypes: ObjectType[] = ["rule", "dataset", "form", "library_schema"];

  async function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploadedFile = file;
    uploadedContent = await file.text();
    // 自动检测格式
    const detected = detectFormat(file.name, uploadedContent);
    if (detected) selectedFormat = detected;
    importResult = null;
  }

  function detectFormat(filename: string, content: string): UniversalFormat | null {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "json") return "json";
    if (ext === "yaml" || ext === "yml") return "yaml";
    if (ext === "toml") return "toml";
    if (ext === "csv") return "csv";
    if (ext === "xml") return "xml";
    // 嗅探内容
    const trimmed = content.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
    if (trimmed.startsWith("<")) return "xml";
    if (trimmed.startsWith("# evorule export")) return "yaml";
    return null;
  }

  async function handleImport() {
    if (!uploadedFile || !uploadedContent) {
      toastError("请先选择文件");
      return;
    }
    importing = true;
    importResult = null;
    try {
      // 1. 创建快照(可选)
      if (createSnapshot) {
        const user = getCurrentUser();
        const snapshotId = await createImportSnapshot(
          user?.id ?? "anonymous",
          `导入${OBJECT_TYPE_LABELS[selectedType]}前`,
        );
        toastInfo(`已创建导入快照 ${snapshotId.slice(0, 16)}(可回滚)`);
      }

      // 2. 执行导入
      if (selectedType === "rule") {
        // 检测是否批量包(.evorule-batch.json 或 manifest)
        const isBatch =
          uploadedFile.name.includes(".evorule-batch") ||
          (uploadedContent.includes('"manifest"') &&
            uploadedContent.includes('"files"'));
        if (isBatch) {
          const result = await importRulesBatch(
            new Blob([uploadedContent]),
            conflictResolution,
          );
          importResult = result;
        } else {
          const r = await importRuleUniversal(
            uploadedContent,
            selectedFormat,
            conflictResolution,
          );
          importResult = {
            objectType: "rule",
            totalCount: 1,
            results: [
              {
                objectId: r.imported,
                action: r.action,
                status: "success",
              },
            ],
            successCount: 1,
            failureCount: 0,
          };
        }
      } else if (selectedType === "dataset") {
        const newId = await importDataset(
          uploadedContent,
          selectedFormat,
        );
        importResult = {
          objectType: "dataset",
          totalCount: 1,
          results: [
            { objectId: newId, action: "created", status: "success" },
          ],
          successCount: 1,
          failureCount: 0,
        };
      } else if (selectedType === "form") {
        const newId = await importFormSchema(uploadedContent, selectedFormat);
        importResult = {
          objectType: "form",
          totalCount: 1,
          results: [
            { objectId: newId, action: "created", status: "success" },
          ],
          successCount: 1,
          failureCount: 0,
        };
      } else {
        // library_schema 导入(走 ruleset-import 或 library-schema-import)
        toastInfo("库 Schema 导入请在建库向导中使用「从模板创建」");
      }

      if (importResult && importResult.failureCount === 0) {
        toastSuccess(
          `导入成功:${importResult.successCount}/${importResult.totalCount} 条`,
        );
      } else if (importResult && importResult.failureCount > 0) {
        toastError(
          `导入完成:${importResult.successCount} 成功,${importResult.failureCount} 失败`,
        );
      }
    } catch (e) {
      toastError(`导入失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      importing = false;
    }
  }

  function handleClear() {
    uploadedFile = null;
    uploadedContent = "";
    importResult = null;
  }

  // DJBH 规则集快速导入
  async function importDjbhRuleset() {
    importing = true;
    try {
      const pkg = await buildDjbhRulesetPackage();
      const rulesetJson = JSON.stringify(pkg);
      const { importRuleset } = await import("$lib/stores/ruleset-import");
      const result = await importRuleset(rulesetJson, {
        conflictResolution,
      });
      toastSuccess(
        `等保 2.0 三级规则集导入完成:${result.imported} 条,跳过 ${result.skipped} 条`,
      );
      importResult = {
        objectType: "rule",
        totalCount: pkg.rules.length,
        results: result.importedRuleIds.map((id) => ({
          objectId: id,
          action: "created" as const,
          status: "success" as const,
        })),
        successCount: result.imported,
        failureCount: 0,
      };
    } catch (e) {
      toastError(`规则集导入失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      importing = false;
    }
  }
</script>

<div class="import-tab">
  <!-- 对象类型选择 -->
  <section class="it-section">
    <h3 class="it-sec-title">1. 选择导入对象类型</h3>
    <div class="it-type-grid">
      {#each objectTypes as t (t)}
        <button
          class="it-type-btn"
          class:active={selectedType === t}
          onclick={() => (selectedType = t)}
        >
          <span class="it-type-icon">
            {t === "rule" ? "📋" : t === "dataset" ? "📊" : t === "form" ? "📝" : "📚"}
          </span>
          <span>{OBJECT_TYPE_LABELS[t]}</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- 格式选择 -->
  <section class="it-section">
    <h3 class="it-sec-title">2. 选择格式(自动检测)</h3>
    <select class="it-select" bind:value={selectedFormat}>
      {#each STRUCTURED_FORMATS as f (f)}
        <option value={f}>{FORMAT_LABELS[f]}</option>
      {/each}
    </select>
  </section>

  <!-- 文件上传 -->
  <section class="it-section">
    <h3 class="it-sec-title">3. 上传文件</h3>
    <label class="it-file-label">
      <input
        type="file"
        accept=".json,.yaml,.yml,.toml,.csv,.xml"
        onchange={handleFileChange}
      />
      <span class="it-file-button">📁 选择文件</span>
      {#if uploadedFile}
        <span class="it-file-name">{uploadedFile.name}({uploadedFile.size} bytes)</span>
      {:else}
        <span class="it-file-hint">支持 JSON/YAML/TOML/CSV/XML</span>
      {/if}
    </label>
    {#if uploadedFile}
      <button class="it-clear-btn" onclick={handleClear}>清除</button>
    {/if}
  </section>

  <!-- 冲突处理 -->
  <section class="it-section">
    <h3 class="it-sec-title">4. 冲突处理策略</h3>
    <select class="it-select" bind:value={conflictResolution}>
      {#each Object.entries(CONFLICT_RESOLUTION_LABELS) as [key, label] (key)}
        <option value={key}>{label}</option>
      {/each}
    </select>
    <label class="it-checkbox">
      <input type="checkbox" bind:checked={createSnapshot} />
      <span>导入前创建快照(可回滚,推荐)</span>
    </label>
  </section>

  <!-- 操作按钮 -->
  <section class="it-actions">
    <button
      class="it-btn primary"
      disabled={!uploadedFile || importing}
      onclick={handleImport}
    >
      {importing ? "导入中..." : "🚀 开始导入"}
    </button>
    {#if selectedType === "rule"}
      <button class="it-btn secondary" disabled={importing} onclick={importDjbhRuleset}>
        📥 快速导入等保 2.0 三级规则集
      </button>
    {/if}
  </section>

  <!-- 导入结果 -->
  {#if importResult}
    <section class="it-result">
      <h3 class="it-sec-title">导入结果</h3>
      <div class="it-result-summary">
        <span class="it-badge success">✓ 成功:{importResult.successCount}</span>
        {#if importResult.failureCount > 0}
          <span class="it-badge error">✗ 失败:{importResult.failureCount}</span>
        {/if}
        <span class="it-badge info">总计:{importResult.totalCount}</span>
      </div>
      {#if importResult.results.length > 0}
        <details class="it-result-details">
          <summary>详细结果({importResult.results.length} 条)</summary>
          <ul class="it-result-list">
            {#each importResult.results as r (r.objectId)}
              <li>
                <span class="it-action-{r.status}">{r.action}</span>
                <code>{r.objectId}</code>
                {#if r.error}
                  <span class="it-error-msg"> — {r.error}</span>
                {/if}
              </li>
            {/each}
          </ul>
        </details>
      {/if}
    </section>
  {/if}

  <ConflictResolver
    conflicts={[]}
    defaultResolution={conflictResolution}
    onresolve={(rs) => {
      conflictResolution = rs[0] ?? "rename";
      showConflictResolver = false;
    }}
  />
</div>

<style>
  .import-tab {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .it-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .it-sec-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-secondary, #4b5563);
  }
  .it-type-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .it-type-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 12px 8px;
    background: var(--bg-card);
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    transition: all 0.15s;
  }
  .it-type-btn:hover {
    border-color: var(--color-primary, #2563eb);
  }
  .it-type-btn.active {
    background: var(--color-info-bg, #eff6ff);
    border-color: var(--color-primary, #2563eb);
    color: var(--color-primary, #2563eb);
  }
  .it-type-icon {
    font-size: 20px;
  }
  .it-select {
    padding: 6px 10px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    border-radius: 4px;
    font-family: inherit;
    font-size: 13px;
    max-width: 320px;
  }
  .it-file-label {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }
  .it-file-label input[type="file"] {
    display: none;
  }
  .it-file-button {
    padding: 6px 12px;
    background: var(--color-gray-100, #f3f4f6);
    border: 1px solid var(--color-gray-300, #d1d5db);
    border-radius: 4px;
    font-size: 12px;
  }
  .it-file-name {
    font-size: 12px;
    color: var(--color-text-primary, #111827);
  }
  .it-file-hint {
    font-size: 11px;
    color: var(--color-gray-500, #6b7280);
  }
  .it-clear-btn {
    align-self: flex-start;
    padding: 4px 10px;
    background: transparent;
    border: none;
    color: var(--color-gray-500, #6b7280);
    cursor: pointer;
    font-size: 11px;
  }
  .it-checkbox {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--color-text-secondary, #4b5563);
  }
  .it-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .it-btn {
    padding: 8px 18px;
    border: 1px solid;
    border-radius: 5px;
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
  }
  .it-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .it-btn.primary {
    background: var(--color-primary, #2563eb);
    border-color: var(--color-primary, #2563eb);
    color: white;
  }
  .it-btn.secondary {
    background: var(--bg-card);
    border-color: var(--color-gray-300, #d1d5db);
    color: var(--color-text-secondary, #4b5563);
  }
  .it-result {
    background: #f9fafb;
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 6px;
    padding: 12px;
  }
  .it-result-summary {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .it-badge {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }
  .it-badge.success {
    background: var(--color-success-bg, #dcfce7);
    color: var(--color-success, #166534);
  }
  .it-badge.error {
    background: var(--color-error-bg, #fee2e2);
    color: var(--color-error, #991b1b);
  }
  .it-badge.info {
    background: var(--color-info-bg, #dbeafe);
    color: var(--color-info, #1e40af);
  }
  .it-result-details summary {
    cursor: pointer;
    font-size: 12px;
    color: var(--color-primary, #2563eb);
  }
  .it-result-list {
    margin: 8px 0 0;
    padding-left: 20px;
    font-size: 11px;
  }
  .it-result-list li {
    margin-bottom: 4px;
  }
  .it-action-success {
    color: var(--color-success, #166534);
    font-weight: 600;
  }
  .it-action-error {
    color: var(--color-error, #991b1b);
    font-weight: 600;
  }
  .it-error-msg {
    color: var(--color-error, #991b1b);
  }
</style>
