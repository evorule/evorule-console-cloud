<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  KnowledgeEntryForm — knowledge 数据条目在线编辑表单（UV-086）

  模式：
    - create：添加新条目（含"编辑新版本"底稿预填，POST 全量字段）
    - edit：编辑 Draft 条目（PATCH 仅 payload/schema_ref/tags/provenance；
      entry_id/version/domain 为 PATCH 契约外字段，只读展示）

  本地门（发网络前阻断）：payload JSON 可解析 / schema_ref 非空 /
  create 时 entry_id 非空且 version ≥ 1。
  权威校验（D3 门禁）在 server：schema_ref 须为 domain_schemas 已注册引用，
  payload 须过领域 schema 校验 —— 失败原文透出（不静默）。

  provenance 合并纪律：PATCH 的 provenance 是整体替换（server if-let 覆盖），
  编辑提交时以原条目 provenance 为底只覆盖 source 字段，防止抹掉
  clause/document_id 等既有溯源信息。
-->
<script lang="ts">
  import type { KnowledgeEntry } from '$lib/governance/types';
  import {
    addKnowledgeEntry,
    patchKnowledgeEntry
  } from '$lib/governance/governance-store';

  let {
    datasetId,
    mode,
    entry,
    onDone,
    onCancel
  }: {
    /** 目标 knowledge 数据集 */
    datasetId: string;
    /** create = POST 新条目（可带底稿）；edit = PATCH Draft 原地改 */
    mode: 'create' | 'edit';
    /** edit 必传；create 可选（编辑新版本的预填底稿，version 由调用方 +1） */
    entry?: KnowledgeEntry;
    /** 提交成功后回调（父组件收起表单；列表刷新由 store 层完成） */
    onDone: () => void;
    onCancel: () => void;
  } = $props();

  // === 表单状态（edit / create+底稿 预填；create 空白为缺省值） ===
  // 表单为"挂载时预填一次"语义：显式捕获 props 初始值，
  // 父组件经条件渲染重建实例传入新条目（编辑期间不响应 props 变化）。
  // svelte-ignore state_referenced_locally
  const init = entry;
  // svelte-ignore state_referenced_locally
  const isEdit = mode === 'edit';

  let entryId = $state(init?.entry_id ?? '');
  let version = $state(init?.version ?? 1);
  let domain = $state(init?.domain ?? '');
  let schemaRef = $state(init?.schema_ref ?? '');
  let tagsText = $state((init?.tags ?? []).join(', '));
  let provenanceSource = $state(init?.provenance?.source ?? '');
  let payloadText = $state(
    init ? JSON.stringify(init.payload, null, 2) : ''
  );

  let err = $state<string | null>(null);
  let submitting = $state(false);

  /** payload 占位：领域结构化数据示例 */
  const PAYLOAD_PLACEHOLDER = `{
  "device_class": "rotation_motor",
  "max_torque_nm": 45.5,
  "service_interval_days": 180
}`;

  /** tags 文本 → 数组（逗号/中文逗号/分号分隔，去空项） */
  function parseTags(text: string): string[] {
    return text
      .split(/[,，;；]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  /** 格式化 payload（JSON.stringify 2 空格；解析失败如实报错） */
  function formatPayload(): void {
    try {
      payloadText = JSON.stringify(JSON.parse(payloadText), null, 2);
      err = null;
    } catch (e) {
      err = `payload 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /**
   * 编辑提交的 provenance 构造：原条目溯源为底，仅覆盖 source；
   * source 未变则省略 provenance 字段（不触发整体替换）。
   */
  function provenanceForPatch(): { source: string } | undefined {
    const orig = init?.provenance;
    if (provenanceSource.trim() === (orig?.source ?? '')) return undefined;
    return {
      ...(orig ?? {}),
      source: provenanceSource.trim()
    } as { source: string };
  }

  /** 本地门：通过返回 null，否则返回阻断原因 */
  function localGate(): string | null {
    if (!schemaRef.trim()) return 'schema_ref 必填（领域 JSON Schema 引用，D3 强校验锚）';
    try {
      JSON.parse(payloadText);
    } catch (e) {
      return `payload 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`;
    }
    if (!isEdit) {
      if (!entryId.trim()) return 'entry_id 必填';
      if (!Number.isInteger(version) || version < 1) return 'version 须为 ≥ 1 的整数';
    }
    return null;
  }

  async function handleSubmit(): Promise<void> {
    err = null;
    const gate = localGate();
    if (gate) {
      err = gate;
      return;
    }
    submitting = true;
    try {
      if (isEdit && entry) {
        await patchKnowledgeEntry(datasetId, entry.entry_id, {
          payload: JSON.parse(payloadText),
          schema_ref: schemaRef.trim(),
          tags: parseTags(tagsText),
          provenance: provenanceForPatch()
        });
      } else {
        await addKnowledgeEntry(datasetId, {
          entry_id: entryId.trim(),
          version,
          domain: domain.trim() || undefined,
          tags: parseTags(tagsText),
          payload: JSON.parse(payloadText),
          schema_ref: schemaRef.trim(),
          // 创建时 source 留空 = 不带溯源；填写才构造
          provenance: provenanceSource.trim()
            ? { source: provenanceSource.trim() }
            : undefined
        });
      }
      onDone();
    } catch (e) {
      // server 错误原文透出（含 D3 schema 校验失败/frozen 拒改/唯一键冲突等）
      err = e instanceof Error ? e.message : String(e);
    } finally {
      submitting = false;
    }
  }
</script>

<div class="entry-form">
  <div class="form-title">
    {isEdit ? `编辑数据条目「${entry?.entry_id}」（Draft · 原地修改）` : '添加数据条目'}
    {#if !isEdit && entry}
      <span class="muted">（底稿 v{entry.version} → 新版本 v{version}）</span>
    {/if}
  </div>

  <div class="field-row">
    <label class="field">
      <span>entry_id {isEdit ? '（定位键，不可改）' : '*'}</span>
      <input bind:value={entryId} disabled={isEdit} placeholder="motor-spec-001" />
    </label>
    <label class="field">
      <span>版本 {isEdit ? '（PATCH 不改版本）' : '*'}</span>
      <input type="number" min="1" bind:value={version} disabled={isEdit} />
    </label>
    <label class="field">
      <span>领域 {isEdit ? '（PATCH 契约无 domain，不可改）' : ''}</span>
      <input bind:value={domain} disabled={isEdit} placeholder="robot" />
    </label>
  </div>

  <label class="field">
    <span>schema_ref *（领域 JSON Schema 引用；须为治理侧 domain_schemas 已注册的 $id 或文件名，未命中将被拒收）</span>
    <input bind:value={schemaRef} placeholder="robot-device.schema.json" />
  </label>

  <div class="field-row">
    <label class="field">
      <span>标签（逗号分隔）</span>
      <input bind:value={tagsText} placeholder="spec, motor" />
    </label>
    <label class="field">
      <span>溯源来源（provenance.source）</span>
      <input bind:value={provenanceSource} placeholder="设备台账 2026-09 版" />
    </label>
  </div>

  <label class="field">
    <span>payload（领域结构化 JSON，过 schema_ref 强校验，零转译）</span>
    <div class="rule-body-tools">
      <button class="btn btn-sm" type="button" onclick={formatPayload} title="JSON.stringify 2 空格缩进">格式化</button>
    </div>
    <textarea bind:value={payloadText} rows="12" placeholder={PAYLOAD_PLACEHOLDER}></textarea>
  </label>

  {#if err}
    <div class="err-box">{err}</div>
  {/if}

  <div class="form-actions">
    <button class="btn btn-sm btn-primary" onclick={handleSubmit} disabled={submitting}>
      {submitting ? '提交中…' : isEdit ? '保存修改' : '入库'}
    </button>
    <button class="btn btn-sm" onclick={onCancel} disabled={submitting}>取消</button>
  </div>
</div>

<style>
  .entry-form {
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    margin-bottom: var(--spacing-md);
  }
  .form-title {
    font-weight: 600;
    margin-bottom: var(--spacing-md);
    font-size: var(--text-sm);
  }
  .muted {
    color: var(--text-secondary);
    font-weight: 400;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    margin-bottom: var(--spacing-md);
  }
  .field > span {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .field input,
  .field textarea {
    padding: var(--spacing-sm) var(--spacing-md);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-page);
    font-size: var(--text-sm);
    color: inherit;
  }
  .field input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .field textarea {
    font-family: monospace;
    resize: vertical;
  }
  .field-row {
    display: flex;
    gap: var(--spacing-md);
  }
  .field-row .field {
    flex: 1;
  }
  .rule-body-tools {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--spacing-xs);
  }
  .err-box {
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger);
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    padding: var(--spacing-sm) var(--spacing-md);
    font-size: var(--text-sm);
    margin-bottom: var(--spacing-md);
    white-space: pre-wrap;
  }
  .form-actions {
    display: flex;
    gap: var(--spacing-sm);
  }
  .btn {
    padding: var(--spacing-sm) var(--spacing-lg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-hover);
    color: inherit;
    cursor: pointer;
    font-size: var(--text-sm);
    transition: all var(--transition-fast);
  }
  .btn:hover {
    background: var(--border);
  }
  .btn-primary {
    background: var(--brand);
    border-color: var(--brand);
    color: #fff;
  }
  .btn-primary:hover {
    background: var(--brand-hover);
  }
  .btn-sm {
    padding: var(--spacing-xs) var(--spacing-md);
    font-size: var(--text-xs);
  }
</style>
