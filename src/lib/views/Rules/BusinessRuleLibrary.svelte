<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:业务规则库(v0 新增,决策 §6.1 + §3.10)
    - 包装内核 RuleLibraryView,在业务模式 / 开发者模式之间切换
    - 业务模式(默认):BusinessTermFilter + BusinessRuleCard + BusinessForm + BusinessPreview
      面向业务专家,业务表单填写自动生成 evorule JSON
    - 开发者模式:直接渲染内核 RuleLibraryView(JSON 编辑),面向工程师
    - 透传 onaiGenerateDraft / onaiExplainRule(LLM callback)
  边界:
    - 规则数据仍存内核 rules store(BusinessRuleLibrary 不复制规则,只扩展展示层)
    - 业务元数据存 ruleBusinessMetaStore(扩展表,关联内核 ruleId)
    - schema 选择器允许为无 meta 的规则关联 schema
  关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §6.1 + §9.2
            P01_BUILD_SCHEMA_DESIGN.md §4.5
-->

<script lang="ts">
  import {
    rules,
    selectedRuleId,
    selectedRule,
    selectRule,
    updateRule,
    useWorkspaceBackend,
    currentWorkspace,
    isRuleReadonly,
  } from "$lib/kernel";
  import { get } from "svelte/store";
  import { dbStore } from "$lib/stores/db";
  import { toastWarning } from "$lib/stores/toast";
  import { getMeta, setMeta } from "$lib/stores/rule-business-meta";
  import {
    businessFormSchemaStore,
    getSchemasByIndustry,
    getSchemaById,
  } from "$lib/stores/business-form-schema";
  import { activeTermsByIndustry } from "$lib/stores/business-terms";
  import { explainStructured } from "./business-preview-explainer";
  import DeveloperModeToggle from "./DeveloperModeToggle.svelte";
  import BusinessTermFilter from "./BusinessTermFilter.svelte";
  import BusinessRuleCard from "./BusinessRuleCard.svelte";
  import BusinessForm from "./BusinessForm.svelte";
  import BusinessPreview from "./BusinessPreview.svelte";
  import SchemaSelector from "./SchemaSelector.svelte";

  let {
    onaiGenerateDraft,
    onaiExplainRule,
  }: {
    onaiGenerateDraft?: () => void;
    onaiExplainRule?: () => void;
  } = $props();

  // backend 在组件初始化期捕获(Svelte 5 context 不支持事件处理器内调用)
  const wb = useWorkspaceBackend();

  // === 模式状态 ===
  let devMode = $state(false);
  let selectedTermId = $state<string | null>(null);
  // schema 选择器 ID(null = 用 meta.schemaId 或无 schema)
  let selectedSchemaId = $state<string | null>(null);

  // === 选中规则的业务元数据(响应式) ===
  const selectedMeta = $derived(
    $selectedRuleId ? getMeta($selectedRuleId) : null,
  );

  // === 当前 schema(优先 selectedSchemaId,否则 meta.schemaId) ===
  const currentSchema = $derived(
    selectedSchemaId
      ? getSchemaById(selectedSchemaId)
      : selectedMeta?.schemaId
        ? getSchemaById(selectedMeta.schemaId)
        : null,
  );

  // === 规则列表(按术语筛选) ===
  const filteredRules = $derived.by(() => {
    if (!selectedTermId) return $rules;
    const tid = selectedTermId; // 窄化为 string(闭包内 TS 无法自动窄化)
    return $rules.filter((r) => {
      const m = getMeta(r.id);
      return m?.businessTermIds.includes(tid) ?? false;
    });
  });

  // === 业务预览(结构化层,本地计算) ===
  const structured = $derived.by(() => {
    if (!$selectedRule || $selectedRule.content === undefined) return null;
    try {
      const ruleJson = JSON.parse($selectedRule.content);
      return explainStructured(ruleJson, $activeTermsByIndustry);
    } catch {
      return null;
    }
  });

  // === 选中规则变化时重置 schema 选择器 ===
  $effect(() => {
    // 依赖 selectedRuleId,切换规则时重置 selectedSchemaId
    $selectedRuleId;
    selectedSchemaId = null;
  });

  // === 选中规则(v0.2.0:selectRule 需 backend + workspaceId,含 content 懒加载) ===
  async function handleSelect(ruleId: string): Promise<void> {
    const ws = get(currentWorkspace);
    if (!ws) return;
    await selectRule(wb, ws.id, ruleId);
  }

  // === 保存(业务表单 → 内核规则 + 业务元数据) ===
  async function handleSave(
    kernelContent: string,
    description: string,
    formValues: Record<string, string | number | boolean>,
  ): Promise<void> {
    if (!$selectedRuleId) return;
    // 1. 更新内核规则 content(v0.2.0:仅 content 可更新,description 无更新通道)
    const ws = get(currentWorkspace);
    if (!ws) {
      toastWarning("当前没有 workspace,无法保存规则");
      return;
    }
    try {
      await updateRule(wb, ws.id, $selectedRuleId, { content: kernelContent });
    } catch (e) {
      toastWarning(`保存规则失败: ${(e as Error).message}`);
      return;
    }
    // 2. 描述变更:内核 v0.2.0 updateRuleContent 不支持 description,如实提示
    const currentDesc = $selectedRule?.description ?? "";
    if (description && description !== currentDesc) {
      toastWarning("规则描述暂不支持在线更新(内核 v0.2.0 限制),内容已保存");
    }
    // 3. 更新/创建业务元数据(formValues + schemaId)
    const schemaId = currentSchema?.id ?? selectedSchemaId ?? undefined;
    if (selectedMeta) {
      setMeta({ ...selectedMeta, formValues, schemaId });
    } else if (schemaId) {
      // 无 meta 但选了 schema:新建 meta
      setMeta({
        ruleId: $selectedRuleId,
        industry: $dbStore.industry,
        businessObject: $dbStore.businessObjects[0] ?? "",
        businessTermIds: [],
        scenarioContext: description,
        schemaId,
        formValues,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }
</script>

{#if devMode}
  <!-- 开发者模式:内核 v0.2.0 RuleLibraryView 已弃用(仅重定向 /workspace,
       cloud 无此路由),JSON 直接编辑暂以占位提示,待 workspace 视图专项接入 -->
  <div class="business-lib">
    <header class="lib-header">
      <div class="title-group">
        <h1>规则库</h1>
        <span class="subtitle">开发者模式 · JSON 直接编辑</span>
      </div>
      <div class="header-actions">
        <DeveloperModeToggle bind:devMode />
      </div>
    </header>
    <div class="dev-mode-placeholder">
      <p>📋 开发者 JSON 编辑视图正在适配内核 v0.2.0 workspace 化重构</p>
      <p class="hint">
        内核 RuleLibraryView 已弃用(原为 /workspace 重定向壳),本视图将在
        workspace 视图专项中补齐。当前请使用业务模式编辑规则。
      </p>
    </div>
  </div>
{:else}
  <!-- 业务模式:业务表单 + 业务预览 -->
  <div class="business-lib">
    <header class="lib-header">
      <div class="title-group">
        <h1>规则库</h1>
        <span class="subtitle">业务专家视角 · 表单填写自动生成 JSON</span>
      </div>
      <div class="header-actions">
        {#if onaiGenerateDraft}
          <button class="btn btn-ai" onclick={() => onaiGenerateDraft?.()}>
            🤖 AI 起草规则
          </button>
        {/if}
        <DeveloperModeToggle bind:devMode />
      </div>
    </header>

    <div class="lib-body">
      <aside class="lib-sidebar">
        <BusinessTermFilter bind:selectedTermId />
        <div class="rule-list">
          <div class="list-header">
            规则列表({filteredRules.length})
          </div>
          {#each filteredRules as rule (rule.id)}
            <BusinessRuleCard
              {rule}
              meta={getMeta(rule.id)}
              selected={$selectedRuleId === rule.id}
              onSelect={() => handleSelect(rule.id)}
            />
          {/each}
          {#if filteredRules.length === 0}
            <div class="empty-list">
              {#if selectedTermId}
                <p>无关联此术语的规则</p>
                <p class="hint">清除筛选查看全部</p>
              {:else}
                <p>暂无规则</p>
                <p class="hint">通过建库向导创建</p>
              {/if}
            </div>
          {/if}
        </div>
      </aside>

      <main class="lib-detail">
        {#if $selectedRule}
          <header class="detail-header">
            <h2 class="rule-id">{$selectedRule.id}</h2>
            {#if onaiExplainRule}
              <button class="btn btn-ai" onclick={() => onaiExplainRule?.()}>
                ✨ LLM 解释
              </button>
            {/if}
          </header>

          <!-- schema 选择器(允许切换业务场景) -->
          <SchemaSelector
            schemas={getSchemasByIndustry($dbStore.industry)}
            bind:selectedId={selectedSchemaId}
          />

          {#if currentSchema}
            <BusinessForm
              schema={currentSchema}
              values={selectedMeta?.formValues}
              onSave={handleSave}
            />
            <BusinessPreview {structured} />
          {:else}
            <div class="no-schema">
              <p>📋 此规则无业务表单关联</p>
              <p class="hint">
                可从上方下拉选择业务场景,或切到开发者模式直接编辑 JSON
              </p>
            </div>
          {/if}
        {:else}
          <div class="empty-detail">
            <span class="empty-icon">👈</span>
            <p>从左侧选择规则查看业务详情</p>
          </div>
        {/if}
      </main>
    </div>
  </div>
{/if}

<style>
  .business-lib {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .lib-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 20px;
    border-bottom: 1px solid var(--border, #e2e8f0);
    background: var(--bg-page, #f8fafc);
  }
  .title-group h1 {
    margin: 0;
    font-size: 20px;
    color: var(--text-primary, #1e293b);
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .subtitle {
    font-size: 11px;
    color: var(--text-secondary, #64748b);
    margin-left: 8px;
  }
  .lib-body {
    flex: 1;
    display: grid;
    grid-template-columns: 300px 1fr;
    overflow: hidden;
    min-height: 0;
  }
  .lib-sidebar {
    border-right: 1px solid var(--border, #e2e8f0);
    overflow-y: auto;
    background: var(--bg-card);
    display: flex;
    flex-direction: column;
  }
  .list-header {
    padding: 8px 12px;
    font-size: 11px;
    color: var(--text-secondary, #64748b);
    font-weight: 600;
    text-transform: uppercase;
    background: var(--bg-page, #f8fafc);
    border-bottom: 1px solid var(--border, #e2e8f0);
    position: sticky;
    top: 0;
    z-index: 1;
  }
  .rule-list {
    flex: 1;
    overflow-y: auto;
  }
  .empty-list {
    padding: 24px 12px;
    text-align: center;
    color: var(--text-secondary, #64748b);
    font-size: 13px;
  }
  .empty-list .hint {
    font-size: 11px;
    margin-top: 4px;
  }
  .dev-mode-placeholder {
    margin: 60px auto;
    max-width: 480px;
    padding: 24px;
    text-align: center;
    color: var(--text-secondary, #64748b);
    border: 1px dashed var(--border, #cbd5e1);
    border-radius: 8px;
  }
  .dev-mode-placeholder .hint {
    font-size: 12px;
    margin-top: 8px;
  }
  .lib-detail {
    overflow-y: auto;
    padding: 20px;
    background: var(--bg-card);
    min-width: 0;
  }
  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }
  .rule-id {
    font-family: var(--font-mono, monospace);
    font-size: 16px;
    margin: 0;
    color: var(--text-primary, #1e293b);
  }
  .btn {
    padding: 6px 12px;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 4px;
    background: var(--bg-card);
    cursor: pointer;
    font-size: 13px;
  }
  .btn-ai {
    background: var(--info-bg, #f5f3ff);
    border-color: var(--brand, #c4b5fd);
    color: var(--brand, #6d28d9);
  }
  .no-schema {
    padding: 32px;
    text-align: center;
    background: var(--bg-page, #f8fafc);
    border-radius: 8px;
    color: var(--text-secondary, #64748b);
  }
  .no-schema p {
    margin: 4px 0;
    font-size: 14px;
  }
  .no-schema .hint {
    font-size: 12px;
  }
  .empty-detail {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-secondary, #64748b);
    text-align: center;
  }
  .empty-icon {
    font-size: 48px;
    margin-bottom: 12px;
  }
  @media (max-width: 768px) {
    .lib-body {
      grid-template-columns: 1fr;
    }
    .lib-sidebar {
      max-height: 240px;
    }
  }
</style>
