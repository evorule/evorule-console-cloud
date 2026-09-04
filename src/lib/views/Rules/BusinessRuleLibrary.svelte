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
  import type {
    ActiveBundleInfo,
    ExecutionRulesResult,
  } from "$lib/kernel";
  import { get } from "svelte/store";
  import { dbStore } from "$lib/stores/db";
  import { toastWarning, toastError } from "$lib/stores/toast";
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
  // UV-078 W2-B5:分类与标签管理入口(复活 CategoryManager/TagManager 孤儿组件)
  import CategoryManager from "$lib/views/Categories/CategoryManager.svelte";
  import TagManager from "$lib/views/Tags/TagManager.svelte";

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

  // === UV-078 W2-B5:分类与标签管理抽屉 ===
  let manageOpen = $state(false);
  let manageTab = $state<"category" | "tag">("category");

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

  // === 执行域生效规则(UV-062 接线③:只读,数据来自 evorule-server GET /api/rules) ===
  // 与本地规则库(工作区 draft/active 规则)区分:此处展示执行域当前实际生效的
  // 合并规则集(宪法 + 已落地 bundle),用于核对"运行中到底在用什么规则"。
  let execRulesOpen = $state(false);
  let execRulesLoading = $state(false);
  let execRulesError = $state<string | null>(null);
  let execRules: ExecutionRulesResult | null = $state(null);
  /** 当前激活 bundle(来源归属展示;"仅宪法生效"时为空) */
  let activeBundles: ActiveBundleInfo[] = $state([]);

  async function toggleExecRules(): Promise<void> {
    execRulesOpen = !execRulesOpen;
    if (execRulesOpen && !execRules) await loadExecRules();
  }

  async function loadExecRules(): Promise<void> {
    execRulesLoading = true;
    execRulesError = null;
    try {
      const [rulesResult, bundles] = await Promise.all([
        wb.getExecutionRules(),
        wb.listActiveBundles(),
      ]);
      execRules = rulesResult;
      activeBundles = bundles;
    } catch (e) {
      execRules = null;
      activeBundles = [];
      execRulesError = e instanceof Error ? e.message : String(e);
      // 加载失败显式报错,不静默降级为"0 条规则"
      toastError(`加载执行域生效规则失败:${execRulesError}`, "执行域规则");
    } finally {
      execRulesLoading = false;
    }
  }

  /** transform 原始结构无规则名字段,展示名按结构派生(rule_id/id/name/type → 序号兜底) */
  function execRuleName(t: unknown, idx: number): string {
    if (t && typeof t === "object") {
      const o = t as Record<string, unknown>;
      for (const k of ["rule_id", "id", "name", "type"]) {
        const v = o[k];
        if (typeof v === "string" && v) return v;
      }
    }
    return `transform-${idx + 1}`;
  }

  /** 内容摘要:JSON 序列化截断 */
  function execRuleSummary(t: unknown): string {
    const s = JSON.stringify(t);
    return s && s.length > 120 ? `${s.slice(0, 120)}…` : (s ?? "");
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
        <button
          class="btn"
          onclick={() => (manageOpen = true)}
          title="管理分类与标签以组织规则库"
        >
          🏷 分类与标签
        </button>
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

    <!-- 执行域生效规则(UV-062 接线③:只读;数据来自 evorule-server :18080) -->
    <section class="exec-rules">
      <header class="exec-head">
        <button class="btn exec-toggle" onclick={toggleExecRules}>
          {execRulesOpen ? "▾" : "▸"} 执行域生效规则({execRules?.count ?? 0})
        </button>
        <span class="exec-src" title="数据来自执行域 evorule-server(:18080) GET /api/rules">
          数据来自执行域 evorule-server · 只读
        </span>
        {#if execRulesOpen}
          <button class="btn exec-toggle" onclick={loadExecRules} disabled={execRulesLoading}>
            ⟳ 刷新
          </button>
        {/if}
      </header>
      {#if execRulesOpen}
        {#if execRulesLoading}
          <p class="exec-hint">加载中…</p>
        {:else if execRulesError}
          <div class="exec-error">⚠️ {execRulesError}</div>
        {:else}
          {#if activeBundles.length > 0}
            <div class="exec-bundles">
              <span class="exec-bundle-label">来源 bundle:</span>
              {#each activeBundles as b (b.bundle_id)}
                <span
                  class="exec-bundle-chip"
                  title={`bundle_id: ${b.bundle_id}\n内容哈希: ${b.content_hash}\n条目数: ${b.entry_count}`}
                >
                  {b.dataset_id} · v{b.source_version} · {b.entry_count} 条
                </span>
              {/each}
            </div>
          {:else}
            <p class="exec-hint">当前无激活 bundle(仅宪法规则生效)。</p>
          {/if}
          {#if (execRules?.count ?? 0) === 0}
            <p class="exec-hint">执行域当前无生效规则。</p>
          {:else}
            <ul class="exec-list">
              {#each execRules?.core_eval ?? [] as t, i (i)}
                <li class="exec-item">
                  <span class="exec-name">{execRuleName(t, i)}</span>
                  <code class="exec-summary">{execRuleSummary(t)}</code>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      {/if}
    </section>
  </div>

  <!-- UV-078 W2-B5:分类与标签管理抽屉 -->
  {#if manageOpen}
    <!-- tabindex="-1":dialog 容器可编程聚焦(ARIA 惯例),同时满足 a11y 焦点要求;
         Escape 关闭提供与遮罩点击对等的键盘通道 -->
    <div
      class="manage-overlay"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(e) => {
        if (e.target === e.currentTarget) manageOpen = false;
      }}
      onkeydown={(e) => {
        if (e.key === "Escape") manageOpen = false;
      }}
    >
      <div class="manage-drawer">
        <header class="drawer-header">
          <div class="drawer-tabs">
            <button
              type="button"
              class="drawer-tab"
              class:active={manageTab === "category"}
              onclick={() => (manageTab = "category")}
            >
              📂 分类
            </button>
            <button
              type="button"
              class="drawer-tab"
              class:active={manageTab === "tag"}
              onclick={() => (manageTab = "tag")}
            >
              🏷 标签
            </button>
          </div>
          <button type="button" class="btn-close" onclick={() => (manageOpen = false)}>
            ✕
          </button>
        </header>
        {#if manageTab === "category"}
          <CategoryManager />
        {:else}
          <TagManager />
        {/if}
      </div>
    </div>
  {/if}
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

  /* === 执行域生效规则(UV-062 接线③) === */
  .exec-rules {
    border-top: 1px solid var(--border, #e2e8f0);
    background: var(--bg-page, #f8fafc);
    padding: 8px 20px 12px;
    min-height: 40px;
  }
  .exec-head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .exec-toggle {
    font-size: 12px;
    padding: 4px 10px;
  }
  .exec-src {
    font-size: 11px;
    color: var(--text-secondary, #64748b);
  }
  .exec-hint {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--text-secondary, #64748b);
  }
  .exec-error {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--danger, #dc2626);
    padding: 8px 10px;
    border: 1px solid var(--danger, #dc2626);
    border-radius: 4px;
    background: color-mix(in srgb, var(--danger, #dc2626) 6%, transparent);
  }
  .exec-bundles {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 8px;
    font-size: 11px;
  }
  .exec-bundle-label {
    color: var(--text-secondary, #64748b);
  }
  .exec-bundle-chip {
    padding: 1px 8px;
    border-radius: 10px;
    background: var(--bg-hover, #f1f5f9);
    font-family: monospace;
    font-size: 11px;
    white-space: nowrap;
  }
  .exec-list {
    list-style: none;
    margin: 8px 0 0;
    padding: 0 0 4px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 260px;
    overflow-y: auto;
  }
  .exec-item {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 4px 8px;
    background: var(--bg-card);
    border-radius: 4px;
    border: 1px solid var(--border, #e2e8f0);
  }
  .exec-name {
    font-family: monospace;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #1e293b);
    white-space: nowrap;
    flex-shrink: 0;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .exec-summary {
    font-size: 11px;
    color: var(--text-secondary, #64748b);
    word-break: break-all;
  }

  /* === UV-078 W2-B5:分类与标签管理抽屉 === */
  .manage-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: stretch;
    justify-content: flex-end;
    /* 需高于全局顶栏(.header z-index:1300),否则抽屉顶部被顶栏遮挡不可点(UV-078 W2-B5 实测取证) */
    z-index: 1400;
  }
  .manage-drawer {
    background: var(--bg-card);
    width: min(520px, 92vw);
    height: 100%;
    box-shadow: -10px 0 30px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border, #e2e8f0);
    flex-shrink: 0;
  }
  .drawer-tabs {
    display: flex;
    gap: 4px;
  }
  .drawer-tab {
    border: none;
    background: transparent;
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-secondary, #64748b);
  }
  .drawer-tab.active {
    background: var(--info-bg, #dbeafe);
    color: var(--brand, #2563eb);
    font-weight: 600;
  }
  .btn-close {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 16px;
    color: var(--text-secondary, #64748b);
    padding: 0 4px;
  }
</style>
