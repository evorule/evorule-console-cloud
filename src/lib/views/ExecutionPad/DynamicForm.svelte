<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:动态表单(按 FormField schema 渲染)
    - 支持 6 种字段类型:text / number / date / select / textarea / checkbox
    - 必填/校验提示(min/max/pattern)
    - 双向绑定 formData
  关联设计:P04_BUSINESS_EXECUTION_PAD_DESIGN.md §5.3 + §6.2(DynamicForm)
-->

<script lang="ts">
  import type { FormField } from "$lib/stores/business-event-templates";

  interface Props {
    fields: FormField[];
    formData: Record<string, unknown>;
    onChange: (formData: Record<string, unknown>) => void;
    disabled?: boolean;
  }

  let { fields, formData, onChange, disabled = false }: Props = $props();

  // 字段级校验错误(derived 计算)
  const fieldErrors = $derived.by<Record<string, string>>(() => {
    const errors: Record<string, string> = {};
    for (const f of fields) {
      const val = formData[f.name];
      // 必填校验
      if (f.required) {
        if (val === undefined || val === null || val === "" || val === false) {
          if (f.type !== "checkbox") {
            errors[f.name] = `${f.label} 必填`;
            continue;
          }
        }
      }
      // 数字 min/max
      if (f.type === "number" && typeof val === "number" && f.validate) {
        if (typeof f.validate.min === "number" && val < f.validate.min) {
          errors[f.name] = `${f.label} 不能小于 ${f.validate.min}`;
        } else if (typeof f.validate.max === "number" && val > f.validate.max) {
          errors[f.name] = `${f.label} 不能大于 ${f.validate.max}`;
        }
      }
      // pattern(字符串)
      if (f.validate?.pattern && typeof val === "string") {
        try {
          const re = new RegExp(f.validate.pattern);
          if (!re.test(val)) {
            errors[f.name] = `${f.label} 格式不合法`;
          }
        } catch {
          // 非法正则,忽略
        }
      }
    }
    return errors;
  });

  const hasAnyError = $derived(Object.keys(fieldErrors).length > 0);

  function updateField(name: string, value: unknown): void {
    onChange({ ...formData, [name]: value });
  }

  function handleNumberInput(f: FormField, ev: Event): void {
    const el = ev.currentTarget as HTMLInputElement;
    const v = el.value === "" ? "" : Number(el.value);
    updateField(f.name, Number.isNaN(v) ? el.value : v);
  }

  function handleCheckbox(f: FormField, ev: Event): void {
    const el = ev.currentTarget as HTMLInputElement;
    updateField(f.name, el.checked);
  }
</script>

<form class="dynamic-form" onsubmit={(e) => e.preventDefault()}>
  {#each fields as field (field.name)}
    <div class="form-field" class:has-error={!!fieldErrors[field.name]}>
      {#if field.type === "checkbox"}
        <label class="checkbox-label">
          <input
            type="checkbox"
            checked={Boolean(formData[field.name])}
            {disabled}
            onchange={(e) => handleCheckbox(field, e)}
          />
          <span class="checkbox-text">
            {field.label}
            {#if field.required}<span class="required">*</span>{/if}
          </span>
        </label>
      {:else}
        <label class="field-label">
          <span class="label-text">
            {field.label}
            {#if field.required}<span class="required">*</span>{/if}
            {#if field.termHint}
              <span class="term-hint" title={field.termHint}>💡</span>
            {/if}
          </span>

          {#if field.type === "text"}
            <input
              type="text"
              class="field-input"
              value={String(formData[field.name] ?? "")}
              {disabled}
              oninput={(e) =>
                updateField(
                  field.name,
                  (e.currentTarget as HTMLInputElement).value,
                )}
            />
          {:else if field.type === "number"}
            <input
              type="number"
              class="field-input"
              value={String(formData[field.name] ?? "")}
              {disabled}
              min={field.validate?.min}
              max={field.validate?.max}
              oninput={(e) => handleNumberInput(field, e)}
            />
          {:else if field.type === "date"}
            <input
              type="date"
              class="field-input"
              value={String(formData[field.name] ?? "")}
              {disabled}
              oninput={(e) =>
                updateField(
                  field.name,
                  (e.currentTarget as HTMLInputElement).value,
                )}
            />
          {:else if field.type === "textarea"}
            <textarea
              class="field-input field-textarea"
              rows={3}
              {disabled}
              oninput={(e) =>
                updateField(
                  field.name,
                  (e.currentTarget as HTMLTextAreaElement).value,
                )}>{String(formData[field.name] ?? "")}</textarea
            >
          {:else if field.type === "select"}
            <select
              class="field-input field-select"
              {disabled}
              onchange={(e) =>
                updateField(
                  field.name,
                  (e.currentTarget as HTMLSelectElement).value,
                )}
            >
              <option value="">-- 请选择 --</option>
              {#each field.options ?? [] as opt (opt.value)}
                <option
                  value={opt.value}
                  selected={String(formData[field.name] ?? "") === opt.value}
                >
                  {opt.label}
                </option>
              {/each}
            </select>
          {/if}
        </label>
      {/if}

      {#if fieldErrors[field.name]}
        <div class="field-error">⚠ {fieldErrors[field.name]}</div>
      {/if}
    </div>
  {/each}
</form>

<style>
  .dynamic-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .form-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .form-field.has-error .field-input,
  .form-field.has-error .field-select {
    border-color: var(--danger, #dc2626);
  }
  .field-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary, #64748b);
  }
  .label-text {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .required {
    color: var(--danger, #dc2626);
  }
  .term-hint {
    font-size: 11px;
    cursor: help;
  }
  .field-input {
    font-size: 13px;
    padding: 6px 10px;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 4px;
    background: var(--bg-card);
    color: var(--text-primary, #1e293b);
    font-family: inherit;
    width: 100%;
    box-sizing: border-box;
  }
  .field-input:disabled {
    background: var(--bg-page, #f8fafc);
    color: var(--text-secondary, #64748b);
  }
  .field-textarea {
    resize: vertical;
    min-height: 60px;
  }
  .field-select {
    font-size: 13px;
    padding: 6px 10px;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 4px;
    background: var(--bg-card);
    color: var(--text-primary, #1e293b);
    width: 100%;
    box-sizing: border-box;
  }
  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-primary, #1e293b);
    cursor: pointer;
  }
  .checkbox-text {
    font-weight: 500;
    font-size: 12px;
    color: var(--text-secondary, #64748b);
  }
  .field-error {
    font-size: 11px;
    color: var(--danger, #dc2626);
  }
</style>
