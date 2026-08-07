<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责(v0):业务表单组件
    - 根据 BusinessFormSchema 渲染字段(分 condition / action / metadata 三组)
    - 字段联动(visibleWhen / enabledWhen / requiredWhen,决策 §3.2)
    - 业务层校验(FieldValidator)
    - 内核校验(RuleValidator,通过 kernel-rule-adapter 包装后校验)
    - 实时 evorule JSON 预览(wrapAsKernelTransform 产出 transform 数组)
    - 保存:onSave(kernelContent, description, formValues)
  关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §9.2 + §6.4
-->

<script lang="ts">
  import { RuleValidator } from "@evorule/console";
  import type {
    BusinessFormSchema,
    BusinessFormField,
    FieldValidator,
  } from "$lib/stores/business-form-schema";
  import { formValuesToEvoruleJson } from "./business-form-to-json";
  import { wrapAsKernelTransform } from "./kernel-rule-adapter";
  import { evalConditions } from "./field-conditions";

  let {
    schema,
    values = {},
    onSave,
  }: {
    schema: BusinessFormSchema | null;
    values?: Record<string, string | number | boolean>;
    onSave: (
      kernelContent: string,
      description: string,
      formValues: Record<string, string | number | boolean>,
    ) => void;
  } = $props();

  // 表单值(本地状态)
  let formValues = $state<Record<string, string | number | boolean>>({
    ...values,
  });

  // schema 变化时重置表单值(用 defaultValue,保留传入 values)
  $effect(() => {
    if (!schema) {
      formValues = {};
      return;
    }
    const next: Record<string, string | number | boolean> = {};
    for (const field of schema.fields) {
      if (field.defaultValue !== undefined) {
        next[field.id] = field.defaultValue;
      }
    }
    // 保留传入的 values(schema 不变时复用)
    for (const k of Object.keys(values)) {
      if (schema.fields.find((f) => f.id === k)) {
        next[k] = values[k];
      }
    }
    formValues = next;
  });

  // === 字段联动求值器(决策 §3.2,实现见 field-conditions.ts) ===

  function isFieldVisible(field: BusinessFormField): boolean {
    return evalConditions(field.visibleWhen, formValues);
  }
  function isFieldEnabled(field: BusinessFormField): boolean {
    return evalConditions(field.enabledWhen, formValues);
  }
  function isFieldRequired(field: BusinessFormField): boolean {
    const baseRequired =
      field.validators?.some((v) => v.type === "required") ?? false;
    return baseRequired || evalConditions(field.requiredWhen, formValues);
  }

  // === 业务层校验 ===
  function validateField(field: BusinessFormField): string[] {
    const errors: string[] = [];
    const v = formValues[field.id];
    const required = isFieldRequired(field);

    if (required && (v === undefined || v === "" || v === null)) {
      errors.push(`${field.label} 必填`);
      return errors;
    }
    if (v === undefined || v === "") return errors;

    for (const validator of field.validators ?? []) {
      if (validator.type === "required") continue;
      const err = runValidator(validator, v);
      if (err) errors.push(err);
    }
    return errors;
  }

  function runValidator(
    v: FieldValidator,
    value: string | number | boolean,
  ): string | null {
    switch (v.type) {
      case "min":
        return Number(value) < Number(v.param) ? v.message : null;
      case "max":
        return Number(value) > Number(v.param) ? v.message : null;
      case "pattern":
        return new RegExp(v.param as string).test(String(value))
          ? null
          : v.message;
      case "custom":
        return v.message; // 占位,v0 不实现 custom 逻辑
      default:
        return null;
    }
  }

  // === 全局校验状态 ===
  let businessErrors = $state<Record<string, string[]>>({});
  let kernelValidation = $state<{ valid: boolean; errors: string[] } | null>(
    null,
  );
  let formStatus = $state<
    "empty" | "dirty" | "validating" | "valid" | "invalid"
  >("empty");

  function runValidation(): void {
    if (!schema) return;
    formStatus = "validating";

    // 1. 业务层校验(只校验可见字段)
    const errors: Record<string, string[]> = {};
    for (const field of schema.fields) {
      if (!isFieldVisible(field)) continue;
      const e = validateField(field);
      if (e.length > 0) errors[field.id] = e;
    }
    businessErrors = errors;

    // 2. 内核校验(业务视图 → 包装为 transform 数组 → 校验)
    const businessJson = formValuesToEvoruleJson(schema, formValues);
    const kernelJson = wrapAsKernelTransform(businessJson as never);
    const v = RuleValidator.validate(JSON.stringify(kernelJson));
    kernelValidation = {
      valid: v.valid,
      errors: v.errors.map((e) => e.message),
    };

    formStatus =
      Object.keys(errors).length === 0 && v.valid ? "valid" : "invalid";
  }

  // === 实时 JSON 预览(包装后的内核格式) ===
  const kernelJson = $derived(
    schema
      ? wrapAsKernelTransform(
          formValuesToEvoruleJson(schema, formValues) as never,
        )
      : { transform: [] },
  );

  // === 保存 ===
  function handleSave(): void {
    runValidation();
    if (formStatus !== "valid") return;
    const description = schema?.scenario ?? "未命名规则";
    onSave(JSON.stringify(kernelJson, null, 2), description, formValues);
  }

  // 字段变化时自动校验(debounce 200ms)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    // 依赖 formValues(读取以建立响应)
    formValues;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (schema) runValidation();
    }, 200);
  });

  const groups = $derived(
    schema
      ? (["condition", "action", "metadata"] as const).map((g) => ({
          group: g,
          fields: schema.fields.filter((f) => (f.group ?? "condition") === g),
        }))
      : [],
  );
</script>

{#if !schema}
  <div class="no-schema">
    <p>请先选择业务场景(schema)</p>
  </div>
{:else}
  <div class="business-form">
    <div class="form-header">
      <h3>{schema.scenario}</h3>
      <span class="industry-badge">{schema.industry}</span>
    </div>

    <!-- 主体:按 group 分区 -->
    <div class="form-body">
      {#each groups as g}
        {#if g.fields.length > 0}
          <fieldset class="field-group">
            <legend>
              {g.group === "condition"
                ? "条件"
                : g.group === "action"
                  ? "动作"
                  : "元数据"}
            </legend>
            {#each g.fields as field (field.id)}
              {#if isFieldVisible(field)}
                <div class="field" data-required={isFieldRequired(field)}>
                  <label for={field.id}>
                    {field.label}
                    {#if isFieldRequired(field)}<span class="required">*</span
                      >{/if}
                  </label>

                  {#if field.type === "number"}
                    <input
                      id={field.id}
                      type="number"
                      bind:value={formValues[field.id]}
                      disabled={!isFieldEnabled(field)}
                    />
                  {:else if field.type === "string"}
                    <input
                      id={field.id}
                      type="text"
                      bind:value={formValues[field.id]}
                      disabled={!isFieldEnabled(field)}
                    />
                  {:else if field.type === "date"}
                    <input
                      id={field.id}
                      type="date"
                      bind:value={formValues[field.id]}
                      disabled={!isFieldEnabled(field)}
                    />
                  {:else if field.type === "enum"}
                    <select
                      id={field.id}
                      bind:value={formValues[field.id]}
                      disabled={!isFieldEnabled(field)}
                    >
                      {#each field.options ?? [] as opt}
                        <option value={opt}>{opt}</option>
                      {/each}
                    </select>
                  {:else if field.type === "boolean"}
                    <input
                      id={field.id}
                      type="checkbox"
                      checked={Boolean(formValues[field.id])}
                      onchange={(e) =>
                        (formValues[field.id] = (
                          e.target as HTMLInputElement
                        ).checked)}
                      disabled={!isFieldEnabled(field)}
                    />
                  {/if}

                  {#if field.description}
                    <small class="field-desc">{field.description}</small>
                  {/if}

                  {#if businessErrors[field.id]}
                    <div class="field-errors">
                      {#each businessErrors[field.id] as err}
                        <span class="error">❌ {err}</span>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            {/each}
          </fieldset>
        {/if}
      {/each}
    </div>

    <!-- 校验面板 -->
    <div class="validation-panel">
      <h4>校验</h4>
      <div class="validation-status" data-status={formStatus}>
        {formStatus === "empty" && "待填写"}
        {formStatus === "dirty" && "有改动未校验"}
        {formStatus === "validating" && "校验中..."}
        {formStatus === "valid" && "✅ 全部通过"}
        {formStatus === "invalid" && "❌ 有错误"}
      </div>

      {#if kernelValidation && !kernelValidation.valid}
        <div class="kernel-errors">
          <strong>内核校验(7 门禁):</strong>
          <ul>
            {#each kernelValidation.errors as err}
              <li>{err}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>

    <!-- JSON 预览(可折叠) -->
    <details class="json-preview">
      <summary>evorule JSON 预览(实时,内核 transform 格式)</summary>
      <pre>{JSON.stringify(kernelJson, null, 2)}</pre>
    </details>

    <!-- 操作按钮 -->
    <div class="form-actions">
      <button onclick={() => runValidation()}>校验</button>
      <button onclick={handleSave} disabled={formStatus !== "valid"}>
        保存
      </button>
    </div>
  </div>
{/if}

<style>
  .no-schema {
    padding: 24px;
    text-align: center;
    color: var(--color-text-secondary, #64748b);
    background: var(--color-gray-50, #f8fafc);
    border-radius: 8px;
  }
  .business-form {
    background: white;
    border: 1px solid var(--color-gray-200, #e2e8f0);
    border-radius: 8px;
    padding: 16px;
  }
  .form-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--color-gray-200, #e2e8f0);
  }
  .form-header h3 {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    flex: 1;
  }
  .industry-badge {
    padding: 2px 8px;
    background: var(--color-info-bg, #dbeafe);
    color: var(--color-info-text, #1e40af);
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }

  .field-group {
    border: 1px solid var(--color-gray-200, #e2e8f0);
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 12px;
  }
  .field-group legend {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-secondary, #64748b);
    padding: 0 6px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }
  .field label {
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text-primary, #1e293b);
  }
  .required {
    color: var(--color-error, #dc2626);
    margin-left: 2px;
  }
  input,
  select {
    padding: 6px 8px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 4px;
    font-size: 13px;
    background: white;
  }
  input:disabled,
  select:disabled {
    background: var(--color-gray-100, #f1f5f9);
    cursor: not-allowed;
  }
  input[type="checkbox"] {
    width: auto;
  }
  .field-desc {
    font-size: 11px;
    color: var(--color-text-secondary, #64748b);
  }
  .field-errors {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .error {
    font-size: 11px;
    color: var(--color-error-text, #991b1b);
  }

  .validation-panel {
    padding: 12px;
    background: var(--color-gray-50, #f8fafc);
    border-radius: 6px;
    margin-top: 12px;
  }
  .validation-panel h4 {
    font-size: 13px;
    margin: 0 0 6px 0;
  }
  .validation-status {
    font-size: 13px;
    font-weight: 500;
  }
  .validation-status[data-status="valid"] {
    color: var(--color-success-text, #166534);
  }
  .validation-status[data-status="invalid"] {
    color: var(--color-error-text, #991b1b);
  }
  .kernel-errors {
    margin-top: 8px;
    padding: 8px;
    background: white;
    border-radius: 4px;
    font-size: 12px;
  }
  .kernel-errors ul {
    margin: 4px 0 0 16px;
    padding: 0;
  }

  .json-preview {
    margin-top: 12px;
  }
  .json-preview summary {
    cursor: pointer;
    font-size: 12px;
    color: var(--color-text-secondary, #64748b);
    padding: 6px 0;
  }
  .json-preview pre {
    background: var(--color-gray-900, #0f172a);
    color: var(--color-gray-100, #f1f5f9);
    padding: 12px;
    border-radius: 6px;
    font-size: 11px;
    overflow-x: auto;
    margin: 0;
    max-height: 280px;
  }

  .form-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 12px;
  }
  .form-actions button {
    padding: 6px 16px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 4px;
    background: white;
    cursor: pointer;
    font-size: 13px;
  }
  .form-actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .form-actions button:last-child {
    background: var(--color-primary, #2563eb);
    color: white;
    border-color: var(--color-primary, #2563eb);
  }
</style>
