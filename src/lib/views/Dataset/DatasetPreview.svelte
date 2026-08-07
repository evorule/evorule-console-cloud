<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:数据集运行前预览(P03 数据集编辑器子组件,设计 §6.2 + §7.2)
    - 规则完整性检查:缺失规则 / 规则 JSON 解析失败
    - 参数覆盖检查:JSON Patch 路径合法性 + 应用是否成功
    - 依赖冲突检查:P0 简化,只查 ID 重复
    - 组装后的 ruleset 预览(JSON 字符串数组)
  关联设计:P03_DATASET_DESIGN.md §6.2 + §8.2( assembleRuleset)
-->

<script lang="ts">
  import { getAllRules } from "@evorule/console";
  import type { Dataset } from "$lib/stores/dataset-types";
  import type { JsonPatch } from "$lib/types/json-patch";
  import { assembleRuleset } from "$lib/dataset/assemble-ruleset";
  import { applyJsonPatch } from "$lib/utils/json-patch";

  interface Props {
    dataset: Dataset;
  }

  let { dataset }: Props = $props();

  type CheckStatus = "ok" | "warn" | "error";

  interface CheckItem {
    status: CheckStatus;
    message: string;
  }

  // === 组装结果 ===
  const assemble = $derived(assembleRuleset(dataset));

  // === 完整性检查列表 ===
  const checks = $derived.by<CheckItem[]>(() => {
    const items: CheckItem[] = [];
    const allRules = getAllRules();

    // 1. 规则数检查
    if (dataset.ruleIds.length === 0) {
      items.push({
        status: "error",
        message: "数据集为空(未选择任何规则)",
      });
    } else {
      items.push({
        status: "ok",
        message: `共 ${dataset.ruleIds.length} 条规则`,
      });
    }

    // 2. 缺失规则检查
    if (assemble.skippedRuleIds.length > 0) {
      items.push({
        status: "error",
        message: `${assemble.skippedRuleIds.length} 条规则在规则库中不存在:${assemble.skippedRuleIds.join(", ")}`,
      });
    } else if (dataset.ruleIds.length > 0) {
      items.push({
        status: "ok",
        message: "所有规则在规则库中均存在",
      });
    }

    // 3. 规则 JSON 解析检查
    let parseFailures = 0;
    for (const ruleId of dataset.ruleIds) {
      const rule = allRules.find((r) => r.id === ruleId);
      if (!rule) continue;
      try {
        JSON.parse(rule.content);
      } catch {
        parseFailures++;
      }
    }
    if (parseFailures > 0) {
      items.push({
        status: "error",
        message: `${parseFailures} 条规则 JSON 解析失败`,
      });
    } else if (dataset.ruleIds.length > 0) {
      items.push({
        status: "ok",
        message: "所有规则 JSON 格式合法",
      });
    }

    // 4. 参数覆盖检查
    if (dataset.paramOverrides.length === 0) {
      items.push({
        status: "ok",
        message: "无参数覆盖(使用规则默认参数)",
      });
    } else {
      let invalidPatchCount = 0;
      for (const override of dataset.paramOverrides) {
        for (const p of override.patch) {
          if (!p.path || !p.path.startsWith("/")) {
            invalidPatchCount++;
          } else if (p.op !== "remove" && p.value === undefined) {
            invalidPatchCount++;
          } else {
            // 尝试应用,捕获运行时错误
            const rule = allRules.find((r) => r.id === override.ruleId);
            if (rule) {
              try {
                applyJsonPatch(rule.content, [p]);
              } catch {
                invalidPatchCount++;
              }
            }
          }
        }
      }
      if (invalidPatchCount > 0) {
        items.push({
          status: "error",
          message: `${invalidPatchCount} 条参数覆盖无效(JSON Patch 路径或值错误)`,
        });
      } else {
        items.push({
          status: "ok",
          message: `${dataset.paramOverrides.length} 条规则的参数覆盖均有效`,
        });
      }
    }

    // 5. ID 重复检查(P0 简化依赖检查)
    const idSet = new Set(dataset.ruleIds);
    if (idSet.size < dataset.ruleIds.length) {
      items.push({
        status: "warn",
        message: "存在重复规则 ID(将只生效一次)",
      });
    }

    // 6. 名称/描述检查
    if (!dataset.name.trim()) {
      items.push({
        status: "error",
        message: "数据集名称为空",
      });
    }
    if (!dataset.description.trim()) {
      items.push({
        status: "warn",
        message: "数据集描述为空(建议补充说明)",
      });
    }

    return items;
  });

  // === 总状态 ===
  const overallStatus = $derived.by<CheckStatus>(() => {
    if (checks.some((c) => c.status === "error")) return "error";
    if (checks.some((c) => c.status === "warn")) return "warn";
    return "ok";
  });

  const canRun = $derived(overallStatus !== "error");

  // === 预览 ruleset 折叠 ===
  let showRuleset = $state(false);

  const rulesetPreview = $derived(
    assemble.ruleset
      .map((json, i) => `// [${i + 1}]\n${json}`)
      .join("\n\n"),
  );
</script>

<div class="dataset-preview" data-status={overallStatus}>
  <header class="preview-header">
    <h3>🔍 运行前检查</h3>
    <span class={`status-pill status-${overallStatus}`}>
      {#if overallStatus === "ok"}
        ✅ 可以运行
      {:else if overallStatus === "warn"}
        ⚠ 有警告
      {:else}
        ❌ 不可运行
      {/if}
    </span>
  </header>

  <ul class="check-list">
    {#each checks as check, i (i)}
      <li class="check-item" data-status={check.status}>
        <span class="check-icon">
          {#if check.status === "ok"}✅{:else if check.status === "warn"}⚠️{:else}❌{/if}
        </span>
        <span class="check-msg">{check.message}</span>
      </li>
    {/each}
  </ul>

  {#if assemble.overriddenRuleIds.length > 0}
    <div class="override-summary">
      应用了参数覆盖的规则:
      <code>{assemble.overriddenRuleIds.join(", ")}</code>
    </div>
  {/if}

  <div class="ruleset-section">
    <button
      type="button"
      class="btn-toggle"
      onclick={() => (showRuleset = !showRuleset)}
    >
      {showRuleset ? "▼" : "▶"} 预览组装后的规则集({assemble.ruleset.length} 条)
    </button>
    {#if showRuleset}
      <pre class="ruleset-preview">{rulesetPreview || "// 空规则集"}</pre>
    {/if}
  </div>
</div>

<style>
  .dataset-preview {
    border: 1px solid var(--color-gray-200, #e2e8f0);
    border-radius: 6px;
    padding: 12px;
    background: white;
  }
  .dataset-preview[data-status="error"] {
    border-color: var(--color-error, #dc2626);
  }
  .dataset-preview[data-status="warn"] {
    border-color: var(--color-warning, #d97706);
  }
  .preview-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .preview-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .status-pill {
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 12px;
    font-weight: 600;
  }
  .status-ok {
    background: var(--color-success-bg, #f0fdf4);
    color: var(--color-success, #16a34a);
  }
  .status-warn {
    background: var(--color-warning-bg, #fffbeb);
    color: var(--color-warning, #d97706);
  }
  .status-error {
    background: var(--color-error-bg, #fef2f2);
    color: var(--color-error, #dc2626);
  }
  .check-list {
    list-style: none;
    padding: 0;
    margin: 0 0 12px 0;
  }
  .check-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 4px 0;
    font-size: 12px;
  }
  .check-item[data-status="error"] .check-msg {
    color: var(--color-error, #dc2626);
  }
  .check-item[data-status="warn"] .check-msg {
    color: var(--color-warning, #d97706);
  }
  .check-icon {
    flex-shrink: 0;
  }
  .override-summary {
    margin-bottom: 12px;
    padding: 6px 8px;
    background: var(--color-info-bg, #f0f9ff);
    border-radius: 4px;
    font-size: 12px;
    color: var(--color-info, #2563eb);
  }
  .override-summary code {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
  }
  .ruleset-section {
    border-top: 1px solid var(--color-gray-200, #e2e8f0);
    padding-top: 8px;
  }
  .btn-toggle {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 12px;
    color: var(--color-text-secondary, #64748b);
    padding: 4px 0;
  }
  .btn-toggle:hover {
    color: var(--color-primary, #2563eb);
  }
  .ruleset-preview {
    margin: 8px 0 0 0;
    padding: 10px;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    line-height: 1.4;
    background: #0f172a;
    color: #e2e8f0;
    border-radius: 4px;
    overflow-x: auto;
    max-height: 320px;
    overflow-y: auto;
  }
</style>
