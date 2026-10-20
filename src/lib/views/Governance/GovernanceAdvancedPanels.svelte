<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:高级治理面板容器（07 号缺口 G2-G6 接线）
    tabs: 审计(G2) / API Keys(G5) / 检索(G4) / 数据依赖+服务模板(G3) / 组织(G6)
  挂载:/governance 页折叠区;全部复用 governanceStore.backend(已登录 18081)
  权限:审计与 API Keys 仅管理员(403 原样透传);其余按 View/Edit 角色
-->

<script lang="ts">
  import { get } from "svelte/store";
  import {
    governanceStore,
    selectDataset,
  } from "$lib/governance/governance-store";
  import GovernanceAuditPanel from "./GovernanceAuditPanel.svelte";
  import ApiKeysPanel from "./ApiKeysPanel.svelte";
  import JsonViewer from "$lib/views/Dataset/JsonViewer.svelte";
  import { toastSuccess, toastError } from "$lib/stores/toast";
  import { useBackend } from "$lib/kernel";
  import { CloudHttpBackend, type RulesReloadedResult } from "$lib/backend/cloud-http-backend";

  const kernelBackend = useBackend() as CloudHttpBackend;

  type Tab = "audit" | "keys" | "search" | "deps" | "orgs" | "ops";

  const TABS: readonly [Tab, string][] = [
    ["audit", "🕵 审计"],
    ["keys", "🔑 API Keys"],
    ["search", "🔍 检索"],
    ["deps", "🔗 数据依赖"],
    ["orgs", "🏢 组织"],
    ["ops", "⚡ 执行域运维(18080)"],
  ];

  let tab = $state<Tab>("audit");

  const backend = $derived(get(governanceStore).backend);

  // === G4 检索 ===
  let q = $state("");
  let searchDomain = $state("");
  let searching = $state(false);
  let searchResults = $state<{ dataset_id: string; name: string; dataset_kind?: string; lifecycle?: { status: string } }[] | null>(null);
  let entryResults = $state<unknown>(null);

  async function handleSearch(): Promise<void> {
    const bk = get(governanceStore).backend;
    if (!bk) return;
    searching = true;
    try {
      const page = await bk.searchDatasets({
        q: q.trim() || undefined,
        domain: searchDomain.trim() || undefined,
      });
      searchResults = page.items ?? [];
      entryResults = await bk.searchEntries({ q: q.trim() || undefined });
    } catch (e) {
      toastError(`检索失败: ${(e as Error).message}`);
    } finally {
      searching = false;
    }
  }

  // === G3 数据依赖+服务模板 ===
  const selectedId = $derived(get(governanceStore).selectedId);
  let depsData = $state<unknown>(null);
  let depsLoading = $state(false);
  let templates = $state<Record<string, unknown>[]>([]);
  let tplLoading = $state(false);
  let bindValues = $state<Record<string, string>>({});
  let boundTemplate = $state<unknown>(null);
  let boundTplId = $state<string | null>(null);

  async function loadDeps(): Promise<void> {
    const bk = get(governanceStore).backend;
    if (!bk || !selectedId) return;
    depsLoading = true;
    try {
      depsData = await bk.getDatasetDeps(selectedId);
    } catch (e) {
      depsData = { error: (e as Error).message };
    } finally {
      depsLoading = false;
    }
  }

  async function loadTemplates(): Promise<void> {
    const bk = get(governanceStore).backend;
    if (!bk) return;
    tplLoading = true;
    try {
      templates = (await bk.listDepTemplates()) as Record<string, unknown>[];
    } catch (e) {
      toastError(`模板加载失败: ${(e as Error).message}`);
    } finally {
      tplLoading = false;
    }
  }

  function placeholdersOf(tpl: Record<string, unknown>): string[] {
    const raw = JSON.stringify(tpl);
    return [...new Set(Array.from(raw.matchAll(/\{(\w+)\}/g)).map((m) => m[1]))];
  }

  function selectTemplate(id: string): void {
    boundTplId = id;
    boundTemplate = null;
    const tpl = templates.find((t) => (t.template_id ?? t.id) === id);
    bindValues = {};
    for (const ph of placeholdersOf(tpl ?? {})) bindValues[ph] = "";
  }

  async function handleBind(): Promise<void> {
    const bk = get(governanceStore).backend;
    if (!bk || !boundTplId) return;
    try {
      boundTemplate = await bk.bindDepTemplate(boundTplId, { values: bindValues });
      toastSuccess("模板已绑定生成 ServiceTemplate(复制到 service_registry)");
    } catch (e) {
      toastError(`绑定失败: ${(e as Error).message}`);
    }
  }

  // === G6 组织 ===
  let orgs = $state<Record<string, unknown>[]>([]);
  let orgsLoading = $state(false);
  let selectedOrg = $state<string | null>(null);
  let members = $state<Record<string, unknown>[]>([]);
  let newMemberId = $state("");
  let newMemberRole = $state("viewer");

  async function loadOrgs(): Promise<void> {
    const bk = get(governanceStore).backend;
    if (!bk) return;
    orgsLoading = true;
    try {
      orgs = (await bk.listOrgs()) as Record<string, unknown>[];
      if (orgs.length > 0 && !selectedOrg) {
        selectedOrg = String(orgs[0].org_id ?? "");
        await loadMembers();
      }
    } catch (e) {
      toastError(`组织加载失败: ${(e as Error).message}`);
    } finally {
      orgsLoading = false;
    }
  }

  async function loadMembers(): Promise<void> {
    const bk = get(governanceStore).backend;
    if (!bk || !selectedOrg) return;
    try {
      members = (await bk.listOrgMembers(selectedOrg)) as Record<
        string,
        unknown
      >[];
    } catch (e) {
      toastError(`成员加载失败: ${(e as Error).message}`);
    }
  }

  async function handleAddMember(): Promise<void> {
    const bk = get(governanceStore).backend;
    if (!bk || !selectedOrg || !newMemberId.trim()) return;
    try {
      await bk.addOrgMember(selectedOrg, newMemberId.trim(), newMemberRole);
      toastSuccess(`成员 ${newMemberId.trim()} 已加入组织`);
      newMemberId = "";
      await loadMembers();
    } catch (e) {
      toastError((e as Error).message);
    }
  }

  $effect(() => {
    if (tab === "orgs" && orgs.length === 0 && !orgsLoading) void loadOrgs();
    if (tab === "deps" && templates.length === 0 && !tplLoading) void loadTemplates();
  });

  // === 执行域运维(G8):从磁盘重载规则 ===
  let reloading = $state(false);
  let reloadResult = $state<RulesReloadedResult | null>(null);

  async function handleReload(): Promise<void> {
    if (
      !window.confirm(
        "从磁盘重载执行域规则?\n" +
          "语义:rules_dir/bundles 落盘内容 → 内存生效;存量会话不改 TCB(新会话用新规则);\n" +
          "生产引用切换仍归治理链(rolling_swap/晋级)。",
      )
    ) {
      return;
    }
    reloading = true;
    try {
      reloadResult = await kernelBackend.reloadRules();
      if (reloadResult.reload_ok) {
        toastSuccess(
          `规则已重载:${reloadResult.previous_rules} → ${reloadResult.current_rules} 条(新会话生效)`,
        );
      } else {
        toastError(`重载失败: ${reloadResult.error ?? "未知原因"}`);
      }
    } catch (e) {
      toastError(`重载失败: ${(e as Error).message}`);
    } finally {
      reloading = false;
    }
  }
</script>

{#if tab === "ops"}
  <div class="adv-sec" aria-label="执行域运维">
    <p class="adv-status">
      对象:18080 执行域。手动触发 rules_dir/bundles 落盘内容 → 内存重载
      (带外放置 bundle 后的收口动作;正常发布链会自动触发)。
    </p>
    <div class="adv-form">
      <button
        type="button"
        class="adv-btn primary"
        disabled={reloading}
        onclick={() => void handleReload()}
      >
        {reloading ? "重载中…" : "⚡ 从磁盘重载规则"}
      </button>
    </div>
    {#if reloadResult}
      <div class="adv-json"><JsonViewer value={reloadResult} /></div>
      {#if (reloadResult.rejected_overlaps?.length ?? 0) + (reloadResult.rejected_domains?.length ?? 0) > 0}
        <p class="adv-status">
          ⚠️ 本次装载有被拒条目(重叠/域门禁),明细见上方 JSON——落盘前显式拒,不静默半激活。
        </p>
      {/if}
    {/if}
  </div>
{/if}

<div class="adv" aria-label="高级治理">
  <div class="adv-tabs" role="tablist">
    {#each TABS as [t, label] (t)}
      <button
        type="button"
        class="adv-tab"
        class:active={tab === t}
        role="tab"
        aria-selected={tab === t}
        onclick={() => (tab = t)}
      >
        {label}
      </button>
    {/each}
  </div>

  {#if !backend}
    <p class="adv-status">未连接治理域——先在上方完成连接。</p>
  {:else if tab === "audit"}
    <GovernanceAuditPanel />
  {:else if tab === "keys"}
    <ApiKeysPanel />
  {:else if tab === "search"}
    <div class="adv-sec">
      <form
        class="adv-form"
        onsubmit={(e) => {
          e.preventDefault();
          void handleSearch();
        }}
      >
        <input bind:value={q} placeholder="关键词(q)" />
        <input bind:value={searchDomain} placeholder="领域(domain,可空)" />
        <button type="submit" class="adv-btn primary" disabled={searching}>
          {searching ? "检索中…" : "检索"}
        </button>
      </form>
      {#if searchResults}
        <h4 class="adv-sub">数据集({searchResults.length})</h4>
        <ul class="adv-list">
          {#each searchResults as d (d.dataset_id)}
            <li class="adv-row">
              <span class="adv-name">{d.name || d.dataset_id}</span>
              <span class="adv-meta">
                {d.dataset_kind ?? "rule_set"} · {d.lifecycle?.status ?? "?"}
              </span>
              <button
                type="button"
                class="adv-btn"
                onclick={() => {
                  selectDataset(d.dataset_id);
                  toastSuccess(`已选中数据集 ${d.dataset_id}`);
                }}
              >
                选中
              </button>
            </li>
          {:else}
            <li class="adv-status">无命中</li>
          {/each}
        </ul>
        {#if entryResults}
          <h4 class="adv-sub">条目检索</h4>
          <div class="adv-json"><JsonViewer value={entryResults} /></div>
        {/if}
      {/if}
    </div>
  {:else if tab === "deps"}
    <div class="adv-sec">
      <div class="adv-form">
        <span class="adv-meta">选中数据集:{selectedId ?? "(无)"}</span>
        <button type="button" class="adv-btn" disabled={!selectedId || depsLoading} onclick={() => void loadDeps()}>
          读取依赖声明
        </button>
        <button type="button" class="adv-btn" disabled={tplLoading} onclick={() => void loadTemplates()}>
          {tplLoading ? "加载中…" : "⟳ 服务模板"}
        </button>
      </div>
      {#if depsData}
        <div class="adv-json"><JsonViewer value={depsData} /></div>
      {/if}
      {#if templates.length > 0}
        <h4 class="adv-sub">服务模板({templates.length})——选模板填占位符生成 ServiceTemplate</h4>
        <select onchange={(e) => selectTemplate(e.currentTarget.value)}>
          <option value="" disabled selected>选择模板…</option>
          {#each templates as tpl (String(tpl.template_id ?? tpl.id))}
            <option value={String(tpl.template_id ?? tpl.id)}>
              {String(tpl.name ?? tpl.template_id ?? tpl.id)}
            </option>
          {/each}
        </select>
        {#if boundTplId}
          <div class="adv-form">
            {#each Object.keys(bindValues) as ph (ph)}
              <label class="adv-field">
                <span>{ph}</span>
                <input bind:value={bindValues[ph]} placeholder="{ ph }" />
              </label>
            {/each}
            <button type="button" class="adv-btn primary" onclick={() => void handleBind()}>
              生成绑定
            </button>
          </div>
          {#if boundTemplate}
            <div class="adv-json"><JsonViewer value={boundTemplate} /></div>
          {/if}
        {/if}
      {/if}
    </div>
  {:else if tab === "orgs"}
    <div class="adv-sec">
      {#if orgsLoading}
        <p class="adv-status">加载中…</p>
      {:else}
        <div class="adv-form">
          <select
            bind:value={selectedOrg}
            onchange={() => void loadMembers()}
          >
            {#each orgs as o (String(o.org_id))}
              <option value={String(o.org_id)}>{String(o.name ?? o.org_id)}</option>
            {/each}
          </select>
        </div>
        <ul class="adv-list">
          {#each members as m (String(m.user_id))}
            <li class="adv-row">
              <span class="adv-name">{String(m.user_id)}</span>
              <span class="adv-meta">{String(m.role)}</span>
            </li>
          {:else}
            <li class="adv-status">无成员</li>
          {/each}
        </ul>
        <div class="adv-form">
          <input bind:value={newMemberId} placeholder="用户 ID" />
          <select bind:value={newMemberRole}>
            <option value="viewer">viewer</option>
            <option value="engineer">engineer</option>
            <option value="approver">approver</option>
            <option value="admin">admin</option>
          </select>
          <button
            type="button"
            class="adv-btn primary"
            disabled={!newMemberId.trim()}
            onclick={() => void handleAddMember()}
          >
            + 添加成员
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .adv {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .adv-tabs {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .adv-tab {
    font-size: 11px;
    padding: 4px 12px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card, #fff);
    color: var(--text-secondary, #4b5563);
    cursor: pointer;
    border-radius: 6px;
  }
  .adv-tab.active {
    background: var(--brand, #2563eb);
    border-color: var(--brand, #2563eb);
    color: #fff;
  }
  .adv-status {
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
    margin: 0;
  }
  .adv-sec {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .adv-sub {
    margin: 6px 0 0;
    font-size: 12px;
    font-weight: 700;
  }
  .adv-form {
    display: flex;
    gap: 6px;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .adv-form input,
  .adv-form select {
    font-size: 12px;
    padding: 5px 8px;
    border: 1px solid var(--border, #d1d5db);
    border-radius: 5px;
  }
  .adv-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 10px;
    color: var(--text-secondary, #6b7280);
  }
  .adv-field input {
    font-size: 12px;
  }
  .adv-btn {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 5px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card, #fff);
    color: var(--text-secondary, #4b5563);
    cursor: pointer;
  }
  .adv-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .adv-btn.primary {
    border-color: var(--brand, #2563eb);
    background: var(--brand, #2563eb);
    color: #fff;
  }
  .adv-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .adv-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 6px;
    font-size: 12px;
  }
  .adv-name {
    font-weight: 600;
  }
  .adv-meta {
    font-size: 11px;
    color: var(--text-secondary, #6b7280);
    margin-right: auto;
  }
  .adv-json {
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 6px;
    padding: 6px;
    max-height: 260px;
    overflow: auto;
    font-size: 11px;
  }
</style>
