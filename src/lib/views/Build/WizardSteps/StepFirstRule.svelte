<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责(v0):建库向导步骤 3 — 加第一条规则
    v0 增强(相对 P0-1):
    - SchemaSelector 按 industry + businessObject 动态选 schema
    - LLM 草案 → 业务表单反向解析(决策 §3.7)
    - 置信度可视化(三档颜色)
    - 双模式自由切换(LLM 不可用时强制表单)
    - 业务预览结构化 + LLM 双层
    - 保存产出内核合法 transform JSON(通过 kernel-rule-adapter)
  关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §9.1 + §6.2
-->

<script lang="ts">
  import {
    addRule,
    RuleValidator,
    useAssistantOrNull,
    useWorkspaceBackend,
    currentWorkspace,
  } from "$lib/kernel";
  import { get } from "svelte/store";
  import { dbStore } from "$lib/stores/db";
  import { setMeta } from "$lib/stores/rule-business-meta";
  import {
    getSchemasByBusinessObject,
    getSchemaById,
  } from "$lib/stores/business-form-schema";
  import { activeTermsByIndustry } from "$lib/stores/business-terms";
  import {
    getCachedExplanation,
    setCachedExplanation,
    hashContent,
    type StructuredExplanation,
  } from "$lib/stores/business-preview";
  import {
    formValuesToEvoruleJson,
    evoruleJsonToFormValues,
  } from "$lib/views/Rules/business-form-to-json";
  import {
    wrapAsKernelTransform,
    buildKernelRuleContent,
  } from "$lib/views/Rules/kernel-rule-adapter";
  import { explainStructured } from "$lib/views/Rules/business-preview-explainer";
  import { autoFillTermIds } from "$lib/views/Rules/auto-fill-terms";
  import BusinessForm from "$lib/views/Rules/BusinessForm.svelte";
  import BusinessPreview from "$lib/views/Rules/BusinessPreview.svelte";
  import SchemaSelector from "$lib/views/Rules/SchemaSelector.svelte";

  let {
    template,
    businessObjects,
    onCreated,
    onBack,
  }: {
    template: "blank" | "finance" | "compliance" | null;
    businessObjects: string[];
    onCreated: (ruleId: string) => void;
    onBack: () => void;
  } = $props();

  const assistant = useAssistantOrNull();
  // backend 在组件初始化期捕获(Svelte 5 context 不支持事件处理器内调用)
  const wb = useWorkspaceBackend();

  // === schema 选择(v0,决策 §3.10) ===
  let selectedSchemaId = $state<string | null>(null);
  const availableSchemas = $derived(
    getSchemasByBusinessObject(businessObjects[0] ?? "", $dbStore.industry),
  );

  // 模板预填
  $effect(() => {
    if (template === "finance" && !selectedSchemaId) {
      selectedSchemaId = "finance.expense_limit";
    } else if (template === "compliance" && !selectedSchemaId) {
      selectedSchemaId = "compliance.control_check";
    }
  });

  // === 输入模式 ===
  let inputMode = $state<"llm" | "form">("llm");

  // LLM 不可用时强制表单模式
  $effect(() => {
    if (!assistant && inputMode === "llm") {
      inputMode = "form";
    }
  });

  // === LLM 模式状态 ===
  let naturalLanguage = $state("");
  let generatedRule = $state<object | null>(null);
  let confidence = $state<number>(0);
  let validation = $state<{ valid: boolean; errors: string[] } | null>(null);
  let isGenerating = $state(false);
  let llmError = $state<string | null>(null);

  // === 业务表单模式状态 ===
  let formValues = $state<Record<string, string | number | boolean>>({});
  // 表单保存后的内核 content(LLM 模式用 wrapAsKernelTransform 生成,表单模式由 BusinessForm 给出)
  let savedKernelContent = $state<string | null>(null);
  let savedDescription = $state<string>("");

  // === 业务预览 ===
  let structuredPreview = $state<StructuredExplanation | null>(null);
  let llmExplanation = $state<string>("");
  let isExplaining = $state(false);
  let previewFromCache = $state(false);
  let llmExplainError = $state<string>("");

  // === LLM 生成规则草案 ===
  async function handleGenerate(): Promise<void> {
    if (!assistant) {
      llmError = "LLM 未配置,请切换到业务表单模式或前往设置配置 LLM";
      return;
    }
    if (!naturalLanguage.trim()) {
      llmError = "请输入规则描述";
      return;
    }

    isGenerating = true;
    llmError = null;
    try {
      const result = await assistant.generateRuleDraft(naturalLanguage);
      generatedRule = result.rule;
      confidence = result.confidence;

      // v0:反向解析到表单(决策 §3.7)
      if (selectedSchemaId) {
        const schema = getSchemaById(selectedSchemaId);
        if (schema) {
          formValues = evoruleJsonToFormValues(schema, result.rule);
        }
      }

      // 校验:把业务视图包装为内核 transform 后校验
      const kernelJson = wrapAsKernelTransform(result.rule as never);
      savedKernelContent = JSON.stringify(kernelJson, null, 2);
      const v = RuleValidator.validate(savedKernelContent);
      validation = { valid: v.valid, errors: v.errors.map((e) => e.message) };

      // 业务预览(结构化层本地计算,LLM 层异步)
      generateStructuredPreview(result.rule);

      // LLM 解释(异步,带缓存)
      if (v.valid) {
        await generateLlmExplanation(result.rule);
      }
    } catch (e) {
      llmError = (e as Error).message;
    } finally {
      isGenerating = false;
    }
  }

  function generateStructuredPreview(ruleJson: object): void {
    const terms = $activeTermsByIndustry;
    structuredPreview = explainStructured(ruleJson, terms);
  }

  async function generateLlmExplanation(ruleJson: object): Promise<void> {
    if (!assistant) return;
    const content = JSON.stringify(ruleJson);
    const hash = hashContent(content);

    // 命中缓存(临时 ruleId,Step 3 还没保存)
    const tempRuleId = `__temp__:${hash}`;
    const cached = getCachedExplanation(tempRuleId, content);
    if (cached?.llmExplanation) {
      llmExplanation = cached.llmExplanation;
      previewFromCache = true;
      return;
    }

    isExplaining = true;
    previewFromCache = false;
    llmExplainError = "";
    try {
      llmExplanation = await assistant.explainRule(ruleJson);
      if (structuredPreview) {
        setCachedExplanation({
          ruleId: tempRuleId,
          contentHash: hash,
          structured: structuredPreview,
          llmExplanation,
          cachedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      llmExplainError = (e as Error).message;
      llmExplanation = "";
    } finally {
      isExplaining = false;
    }
  }

  // 业务表单保存回调
  function handleFormSave(
    kernelContent: string,
    description: string,
    values: Record<string, string | number | boolean>,
  ): void {
    savedKernelContent = kernelContent;
    savedDescription = description;
    formValues = values;
    naturalLanguage = description;

    // 用业务视图生成结构化预览
    if (selectedSchemaId) {
      const schema = getSchemaById(selectedSchemaId);
      if (schema) {
        const businessJson = formValuesToEvoruleJson(schema, values);
        generateStructuredPreview(businessJson);
      }
    }

    // 校验
    const v = RuleValidator.validate(kernelContent);
    validation = { valid: v.valid, errors: v.errors.map((e) => e.message) };
  }

  // === 保存规则到 workspace(内核 v0.2.0:经 WorkspaceBackend 异步写入) ===
  async function handleSave(): Promise<void> {
    if (!savedKernelContent || !validation?.valid) {
      llmError = "规则未校验通过,无法保存";
      return;
    }
    const ws = get(currentWorkspace);
    if (!ws) {
      llmError = "当前没有 workspace,无法保存规则";
      return;
    }

    const db = $dbStore;
    const description = naturalLanguage || savedDescription || "未命名规则";

    let ruleId: string;
    try {
      ruleId = await addRule(wb, ws.id, {
        name: `user.${Date.now()}`,
        content: savedKernelContent,
        description,
      });
    } catch (e) {
      llmError = `保存规则失败: ${(e as Error).message}`;
      return;
    }

    // 关联业务元数据(含 schemaId + formValues + 自动补全术语)
    const schemaId = selectedSchemaId ?? undefined;
    const businessTermIds = schemaId
      ? autoFillTermIds(getSchemaById(schemaId)!, formValues, [])
      : [];

    setMeta({
      ruleId,
      industry: db.industry,
      businessObject: db.businessObjects[0] ?? "未指定",
      businessTermIds,
      scenarioContext: naturalLanguage || savedDescription,
      schemaId,
      formValues,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    onCreated(ruleId);
  }

  const canSave = $derived(
    savedKernelContent !== null && validation?.valid === true,
  );

  const selectedSchema = $derived(
    selectedSchemaId ? getSchemaById(selectedSchemaId) : null,
  );
</script>

<div class="step-first-rule">
  <h2>步骤 3:加第一条规则</h2>

  <!-- SchemaSelector -->
  <SchemaSelector
    schemas={availableSchemas}
    bind:selectedId={selectedSchemaId}
  />

  <!-- 输入模式切换 -->
  <div class="mode-tabs">
    <button
      class:active={inputMode === "llm"}
      onclick={() => (inputMode = "llm")}
      disabled={!assistant}
      title={assistant ? "LLM 辅助模式" : "LLM 未配置"}
    >
      🤖 LLM 辅助 {!assistant && "(未配置)"}
    </button>
    <button
      class:active={inputMode === "form"}
      onclick={() => (inputMode = "form")}
    >
      📝 业务表单
    </button>
  </div>

  {#if inputMode === "llm"}
    <div class="llm-section">
      <label for="nl-input">用自然语言描述规则:</label>
      <textarea
        id="nl-input"
        bind:value={naturalLanguage}
        placeholder="例如:报销金额超过 10000 元需要 CFO 批准"
        rows="3"
      ></textarea>

      <button
        class="btn-primary"
        onclick={handleGenerate}
        disabled={isGenerating}
      >
        {isGenerating ? "生成中..." : "✨ 生成规则草案"}
      </button>

      {#if llmError}
        <div class="error-box">⚠ {llmError}</div>
      {/if}

      {#if generatedRule}
        <div class="generated-rule">
          <h3>生成的规则</h3>

          <!-- 置信度可视化 -->
          <div
            class="confidence"
            data-level={confidence >= 0.7
              ? "high"
              : confidence >= 0.3
                ? "mid"
                : "low"}
          >
            置信度: {confidence.toFixed(2)}
            {#if confidence >= 0.7}
              🟢 高(可直接保存)
            {:else if confidence >= 0.3}
              🟡 中(建议在业务表单模式核对)
            {:else}
              🔴 低(建议切换到业务表单模式重填)
            {/if}
          </div>

          {#if validation}
            <div
              class="validation"
              class:valid={validation.valid}
              class:invalid={!validation.valid}
            >
              {#if validation.valid}
                ✅ 校验通过(7 门禁全过)
              {:else}
                ❌ 校验失败:
                <ul>
                  {#each validation.errors as error}
                    <li>{error}</li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}

          {#if confidence < 0.7 && Object.keys(formValues).length > 0}
            <div class="reverse-parse-hint">
              💡 已将 LLM 草案解析到业务表单,
              <button onclick={() => (inputMode = "form")}>
                切换到业务表单核对 →
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <BusinessForm
      schema={selectedSchema}
      values={formValues}
      onSave={handleFormSave}
    />
  {/if}

  <!-- 业务预览(结构化 + LLM) -->
  {#if structuredPreview}
    <BusinessPreview
      structured={structuredPreview}
      {llmExplanation}
      {isExplaining}
      fromCache={previewFromCache}
      llmError={llmExplainError}
    />
  {/if}

  <!-- 操作按钮 -->
  <div class="actions">
    <button class="btn-ghost" onclick={onBack}>上一步</button>
    <button class="btn-primary" onclick={handleSave} disabled={!canSave}>
      保存并下一步
    </button>
  </div>
</div>

<style>
  .step-first-rule {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h2 {
    font-size: 18px;
    margin: 0;
    color: var(--text-primary, #1e293b);
  }

  .mode-tabs {
    display: flex;
    gap: 4px;
    background: var(--bg-hover, #f1f5f9);
    padding: 4px;
    border-radius: 6px;
  }
  .mode-tabs button {
    flex: 1;
    padding: 8px;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-secondary, #64748b);
    transition: all 0.15s ease;
  }
  .mode-tabs button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .mode-tabs button.active {
    background: var(--bg-card);
    color: var(--brand, #2563eb);
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  .llm-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #1e293b);
  }
  textarea {
    padding: 10px;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 6px;
    font-size: 14px;
    font-family: inherit;
    resize: vertical;
  }

  .btn-primary,
  .btn-ghost {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
    border: none;
  }
  .btn-primary {
    background: var(--brand, #2563eb);
    color: white;
    align-self: flex-start;
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error-box {
    padding: 8px 12px;
    background: var(--danger-bg, #fee2e2);
    color: var(--danger, #991b1b);
    border-radius: 6px;
    font-size: 13px;
  }

  .generated-rule {
    padding: 12px;
    background: var(--bg-page, #f8fafc);
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 6px;
  }
  .generated-rule h3 {
    font-size: 14px;
    margin: 0 0 8px 0;
  }
  .confidence {
    font-size: 13px;
    font-weight: 600;
    padding: 6px 10px;
    border-radius: 4px;
    margin-bottom: 8px;
  }
  .confidence[data-level="high"] {
    color: var(--success, #166534);
    background: var(--success-bg, #dcfce7);
  }
  .confidence[data-level="mid"] {
    color: var(--warning, #92400e);
    background: var(--warning-bg, #fef3c7);
  }
  .confidence[data-level="low"] {
    color: var(--danger, #991b1b);
    background: var(--danger-bg, #fee2e2);
  }

  .validation {
    font-size: 13px;
    padding: 6px 10px;
    border-radius: 4px;
    margin-bottom: 8px;
  }
  .validation.valid {
    background: var(--success-bg, #dcfce7);
    color: var(--success, #166534);
  }
  .validation.invalid {
    background: var(--danger-bg, #fee2e2);
    color: var(--danger, #991b1b);
  }
  .validation ul {
    margin: 4px 0 0 16px;
    padding: 0;
  }

  .reverse-parse-hint {
    background: var(--info-bg, #dbeafe);
    color: var(--info, #1e40af);
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 12px;
  }
  .reverse-parse-hint button {
    background: none;
    border: none;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    font-size: 12px;
    padding: 0;
  }

  .actions {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 12px;
  }
  .btn-ghost {
    background: transparent;
    color: var(--text-secondary, #64748b);
    border: 1px solid var(--border, #cbd5e1);
  }
</style>
