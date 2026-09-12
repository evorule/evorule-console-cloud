<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 EvoRule Project
  evorule-console-cloud 流程设计页 /flow（UV-176 P3 激活）
-->
<!--
  吸收自 evorule-console src/routes/workspace/flow/+page.svelte(UV-175 交付),
  适配 cloud 布局(UV-176):
    - 去独立 topbar(cloud 三栏布局自带导航;换页头标题+提示)
    - PluginPacksClient 按 netConfig 构造(offline → DEFAULT_LOCAL_BASE_URL,
      online → remoteBaseUrl;authToken 经 store,Bearer 由客户端自带)
    - import 路径适配(kernel 镜像区 / $lib/backend)
  其余画布/属性/编译/AI 转译逻辑与 console 上游一致。

  职责:
    - 列出声明式 pack 的节点类型资产（node_types）渲染节点面板
    - 画布：加节点 / 拖动 / 连线（审批出边自动 guard="approved"）/ 删除
    - 属性面板：按 node_types.params_form 渲染（8 控件词表;scene_field 下拉来自场景 path 字段）
    - 导出 flow JSON 草稿 → compile 代理 → 规则草稿预览（JsonTree）+ 复制
    - AI 转译流程——NL → flow JSON 草稿填入画布（扩展槽消费,
      assistant 注入才渲染;草稿经 loadFlowAsset 落画布,人确认编译,R3）
  红线对齐:
    - R2:form_ref 取值域 = 场景已注册 path 字段;草稿编译走 server 同一校验链
    - R3:编译产物 draft-only 不落库,生效仍走既有 Draft→Publish 链
    - R4:节点语义全部来自 node_types 资产,本页零领域硬编码
    - R5:display_name 双语仅用于界面展示
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import JsonTree from "$lib/kernel/views/StateView/JsonTree.svelte";
  import FlowCanvas from "$lib/kernel/views/FlowCanvas/FlowCanvas.svelte";
  import {
    defaultPosition,
    buildFlowJson,
    loadFlowAsset,
    nextNodeId,
    type CanvasEdge,
    type CanvasNode,
  } from "$lib/kernel/views/FlowCanvas/flow-model";
  import {
    PluginPacksClient,
    PluginPacksError,
    dn,
    type FlowAssetRaw,
    type NodeTypeAssetRaw,
    type ParamFieldRaw,
    type PluginSummary,
    type SceneAssetRaw,
    type SceneFieldRaw,
  } from "$lib/backend/plugin-packs";
  import { DEFAULT_LOCAL_BASE_URL } from "$lib/backend/types";
  import { netConfig } from "$lib/config/net-config";
  import { t } from "$lib/locale";
  import { useAssistantOrNull, useWorkspaceBackend } from "$lib/kernel";
  import type { FlowTranspileContext } from "$lib/kernel";
  // NL→flow 草稿转译器（扩展槽消费,assistant=null 时按钮不渲染）
  import TranspileFlowDialog from "$lib/views/Assistant/TranspileFlowDialog.svelte";

  let client: PluginPacksClient | null = null;
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  let packs = $state<PluginSummary[]>([]);
  let currentPackId = $state<string | null>(null);
  let nodeTypes = $state<NodeTypeAssetRaw[]>([]);
  let scenes = $state<SceneAssetRaw[]>([]);
  let flows = $state<FlowAssetRaw[]>([]);

  // 存量规则投影(UV-178 批次D):执行域生效规则预取,注入转译上下文供 LLM
  // 参考既有结构模式与路径约定;预取失败降级为空(转译仍可用,不阻断画布),
  // 零领域硬编码——条目字段投影是通用读取,R4 不受影响
  let existingRules = $state<Array<{ rule_id: string; description?: string }>>([]);
  const EXISTING_RULES_CAP = 20;

  const wb = useWorkspaceBackend();

  // 执行域 transform 原始结构无规则名字段——展示名/摘要派生与规则库页
  // (BusinessRuleLibrary)同一策略:rule_id/id/name/type 键探测 → 序号兜底;
  // 摘要为 JSON 截断(给 LLM 看结构模式与路径约定,非领域文案)
  function execRuleName(entry: unknown, idx: number): string {
    if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      for (const k of ["rule_id", "id", "name", "type"]) {
        const v = o[k];
        if (typeof v === "string" && v) return v;
      }
    }
    return `transform-${idx + 1}`;
  }

  function execRuleSummary(entry: unknown): string {
    const s = JSON.stringify(entry);
    return s && s.length > 120 ? `${s.slice(0, 120)}…` : (s ?? "");
  }

  async function loadExistingRules() {
    try {
      const result = await wb.getExecutionRules();
      existingRules = result.core_eval
        .slice(0, EXISTING_RULES_CAP)
        .map((r, i) => ({
          rule_id: execRuleName(r, i),
          description: execRuleSummary(r),
        }));
    } catch {
      existingRules = []; // 降级为空:无存量规则视野,转译仍可用
    }
  }

  // 画布模型（协议 schema + 展示坐标;零领域语义,R4）
  let canvasNodes = $state<CanvasNode[]>([]);
  let canvasEdges = $state<CanvasEdge[]>([]);
  let selectedId = $state<string | null>(null);
  let connectFrom = $state<string | null>(null);
  let flowId = $state("canvas_flow");
  let copied = $state(false);

  let compiling = $state(false);
  let compileError = $state<string | null>(null);
  let draft = $state<unknown>(null);
  let draftProvenance = $state<Record<string, unknown> | null>(null);

  // LLM 扩展槽（P3）:注入方提供 transpileFlow 实现后 AI 按钮才渲染;
  // cloud 在 +layout.svelte 按 isLlmConfigured 注入 CloudLlmAssistant
  const assistant = useAssistantOrNull();
  let transpileOpen = $state(false);

  const currentPack = $derived(packs.find((p) => p.id === currentPackId) ?? null);
  const canCompile = $derived(
    currentPack?.capabilities.includes("flow-compile") ?? false
  );
  const selectedNode = $derived(
    canvasNodes.find((n) => n.node_id === selectedId) ?? null
  );
  const selectedMeta = $derived(
    selectedNode ? (nodeTypes.find((t) => t.node_type === selectedNode.node_type) ?? null) : null
  );
  const canvasMetas = $derived.by(() => {
    const m: Record<string, { label: string; hint?: string }> = {};
    for (const t of nodeTypes) {
      m[t.node_type] = { label: dn(t.display_name, t.node_type), hint: t.description };
    }
    return m;
  });

  onMount(() => {
    // cloud 适配:baseUrl/authToken 取自 netConfig(与 CloudHttpBackend 同一解析逻辑)
    const cfg = get(netConfig);
    const baseUrl = cfg.mode === "online" ? cfg.remoteBaseUrl : DEFAULT_LOCAL_BASE_URL;
    client = new PluginPacksClient(baseUrl, cfg.authToken.trim() || null);
    void load();
    void loadExistingRules(); // 存量规则与 pack 无关(执行域全局),挂载时预取一次
  });

  async function load() {
    if (!client) return;
    loading = true;
    loadError = null;
    try {
      packs = await client.listPacks();
      if (packs.length > 0) {
        await selectPack(packs[0].id);
      }
    } catch (e) {
      loadError = e instanceof PluginPacksError ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function selectPack(packId: string) {
    if (!client) return;
    currentPackId = packId;
    resetCanvas();
    try {
      const [nt, s, f] = await Promise.all([
        client.getNodeTypes(packId),
        client.getScenes(packId),
        client.getFlows(packId),
      ]);
      nodeTypes = nt;
      scenes = s;
      flows = f;
      flowId = f[0]?.flow_id ?? "canvas_flow";
    } catch (e) {
      // node_types 是可选资产（旧 pack 无此 kind）——404 视为空集,其余显式报错
      if (e instanceof PluginPacksError && e.status === 404) {
        nodeTypes = [];
        scenes = [];
        flows = [];
      } else {
        loadError = e instanceof PluginPacksError ? e.message : String(e);
      }
    }
  }

  function resetCanvas() {
    canvasNodes = [];
    canvasEdges = [];
    selectedId = null;
    connectFrom = null;
    draft = null;
    draftProvenance = null;
    compileError = null;
  }

  // ---- 节点面板 ----
  function addNode(nodeType: string) {
    const id = nextNodeId(canvasNodes);
    const pos = defaultPosition(canvasNodes.length);
    canvasNodes.push({ node_id: id, node_type: nodeType, x: pos.x, y: pos.y, params: {} });
    selectedId = id;
    compileError = null;
  }

  // ---- 连线（审批出边自动 guard="approved",与 server v0 校验一致） ----
  function startConnect() {
    if (selectedNode) {
      connectFrom = selectedNode.node_id;
      compileError = null;
    }
  }

  function handleConnect(toId: string) {
    const from = connectFrom;
    connectFrom = null;
    if (!from || from === toId) return;
    const src = canvasNodes.find((n) => n.node_id === from);
    const edge: CanvasEdge =
      src?.node_type === "approval"
        ? { from, to: toId, guard: "approved" }
        : { from, to: toId };
    // v0 线性链：每节点至多 1 出边/1 入边——重建该两槽位
    const fi = canvasEdges.findIndex((e) => e.from === from);
    if (fi >= 0) canvasEdges[fi] = edge;
    else canvasEdges.push(edge);
    const ti = canvasEdges.findIndex((e) => e.to === toId && e.from !== from);
    if (ti >= 0) canvasEdges.splice(ti, 1);
  }

  function deleteEdge(edge: CanvasEdge) {
    const i = canvasEdges.indexOf(edge);
    if (i >= 0) canvasEdges.splice(i, 1);
  }

  function deleteSelected() {
    if (!selectedId) return;
    const id = selectedId;
    const i = canvasNodes.findIndex((n) => n.node_id === id);
    if (i >= 0) canvasNodes.splice(i, 1);
    for (let k = canvasEdges.length - 1; k >= 0; k--) {
      if (canvasEdges[k].from === id || canvasEdges[k].to === id) canvasEdges.splice(k, 1);
    }
    selectedId = null;
  }

  // ---- 载入已有 flow 资产（画布编辑草稿,R3:导出仍是草稿） ----
  function loadExisting(e: Event) {
    const id = (e.target as HTMLSelectElement).value;
    const f = flows.find((x) => x.flow_id === id);
    if (!f) return;
    const loaded = loadFlowAsset(f);
    canvasNodes = loaded.nodes;
    canvasEdges = loaded.edges;
    flowId = f.flow_id;
    selectedId = null;
    connectFrom = null;
  }

  // ---- P3:NL→flow 草稿落画布（与 loadExisting 同投影路径;人可继续编辑,
  //      编译仍需人点击——LLM 永不直接 compile,R3） ----
  function handleAiFill(flow: object) {
    const loaded = loadFlowAsset(flow as FlowAssetRaw);
    canvasNodes = loaded.nodes;
    canvasEdges = loaded.edges;
    flowId = (flow as { flow_id?: string }).flow_id || "canvas_flow";
    selectedId = null;
    connectFrom = null;
    compileError = null;
  }

  // ---- P3:转译上下文（页面已加载资产 → ctx 投影,R4 零领域硬编码） ----
  const transpileCtx = $derived.by((): FlowTranspileContext => ({
    nodeTypes: nodeTypes.map((t) => ({
      node_type: t.node_type,
      display_name: dn(t.display_name, t.node_type),
      ...(t.description ? { description: t.description } : {}),
      ...(t.params_form
        ? {
            params_form: t.params_form.map((f: ParamFieldRaw) => ({
              field_id: f.field_id,
              type: f.type,
              ...(f.scene_ref ? { scene_ref: f.scene_ref } : {}),
            })),
          }
        : {}),
      ...(t.out_guards ? { out_guards: t.out_guards } : {}),
    })),
    sceneFields: scenes
      .flatMap((s) =>
        s.business_objects.flatMap((bo) => bo.fields).map((f: SceneFieldRaw) => ({
          scene_id: s.scene_id,
          field_id: f.field_id,
          path: f.path ?? "",
        })),
      )
      .filter((f) => f.path.length > 0),
    existingRules, // UV-178 批次D:存量规则面注入(prompt 侧仅供学习不引用)
  }));

  // ---- 属性面板（params_form → 节点位映射,flow 协议知识） ----
  /** params_form 字段映射:role/prompt → params.*;threshold → threshold;
   *  form_ref(scene_field) → form_ref{scene,field}（契约 v1.1 §4.4/§4.6） */
  function fieldValue(p: ParamFieldRaw): string | boolean {
    const n = selectedNode;
    if (!n) return "";
    if (p.field_id === "form_ref") return n.form_ref?.field ?? "";
    if (p.field_id === "threshold") return n.threshold === undefined ? "" : String(n.threshold);
    const v = n.params?.[p.field_id];
    if (p.type === "boolean") return Boolean(v);
    return v === undefined || v === null ? "" : String(v);
  }

  function setFieldValue(p: ParamFieldRaw, raw: string | boolean) {
    const n = selectedNode;
    if (!n) return;
    if (p.field_id === "form_ref") {
      n.form_ref = { scene: p.scene_ref ?? "", field: String(raw) };
      return;
    }
    if (p.field_id === "threshold") {
      if (raw === "") delete n.threshold;
      else n.threshold = Number(raw);
      return;
    }
    n.params = { ...n.params, [p.field_id]: p.type === "boolean" ? Boolean(raw) : raw };
  }

  /** scene_field 下拉来源:场景中声明了 path 的字段（R2 取值域锁定,同模板页） */
  function pathedFields(param: ParamFieldRaw): SceneFieldRaw[] {
    const pool = param.scene_ref
      ? scenes.filter((s) => s.scene_id === param.scene_ref)
      : scenes;
    return pool
      .flatMap((s) => s.business_objects.flatMap((bo) => bo.fields))
      .filter((f) => typeof f.path === "string" && f.path.length > 0);
  }

  // ---- 编译（draft-only,R3） ----
  async function handleCompile() {
    if (!client || !currentPackId) return;
    compiling = true;
    compileError = null;
    copied = false;
    try {
      const flowJson = buildFlowJson(
        flowId.trim() || "canvas_flow",
        canvasNodes,
        canvasEdges
      );
      const result = await client.compileFlow(currentPackId, flowJson.flow_id, flowJson);
      draft = result.rule_draft;
      draftProvenance = result.provenance as Record<string, unknown>;
    } catch (e) {
      draft = null;
      draftProvenance = null;
      compileError = e instanceof PluginPacksError ? e.message : String(e);
    } finally {
      compiling = false;
    }
  }

  async function handleCopy() {
    if (draft === null) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(draft, null, 2));
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // 剪贴板不可用:静默,预览区 JSON 可手动复制
    }
  }

  function handlePackChange(e: Event) {
    const id = (e.target as HTMLSelectElement).value;
    if (id) void selectPack(id);
  }
</script>

<div class="flow-page">
  <!-- === 页头(cloud 适配:三栏布局自带导航,此处只留标题与提示) === -->
  <header class="flow-header">
    <h2 class="flow-title">{t("flow.title")}</h2>
    <span class="flow-hint">
      {t("flow.subtitle")}
    </span>
  </header>

  {#if loadError}
    <div class="error-banner" role="alert">
      <span>⚠</span>
      <span>{loadError}</span>
    </div>
  {/if}

  {#if loading}
    <div class="empty-state"><p>{t("flow.loadingPacks")}</p></div>
  {:else if packs.length === 0}
    <div class="empty-state">
      <span class="empty-icon">🧩</span>
      <p>{t("flow.noPacks")}</p>
      <p class="empty-hint">{t("flow.noPacksHint")}</p>
    </div>
  {:else}
    <div class="pack-bar">
      <label for="pack-select" class="pack-label">{t("flow.packLabel")}</label>
      <select
        id="pack-select"
        class="pack-select"
        value={currentPackId ?? ""}
        onchange={handlePackChange}
      >
        {#each packs as p (p.id)}
          <option value={p.id}>
            {p.id} v{p.version}（{t("flow.nodeTypeCount", { count: p.assets.node_types ?? 0 })}
            {#if p.capabilities.includes("flow-compile")}{t("flow.compilable")}{/if}）
          </option>
        {/each}
      </select>
      <label for="flow-load" class="pack-label">{t("flow.loadExisting")}</label>
      <select id="flow-load" class="pack-select" onchange={loadExisting}>
        <option value="">{t("flow.selectFlowAsset")}</option>
        {#each flows as f (f.flow_id)}
          <option value={f.flow_id}>{dn(f.display_name, f.flow_id)}（{f.flow_id}）</option>
        {/each}
      </select>
      <label for="flow-id" class="pack-label">{t("flow.flowIdLabel")}</label>
      <input id="flow-id" class="flow-id-input" bind:value={flowId} />
    </div>

    <div class="flow-layout">
      <!-- === 节点面板（来自 node_types 资产,R4） === -->
      <aside class="node-panel" aria-label={t("flow.nodePanelAria")}>
        <h3 class="panel-title">{t("flow.nodeTypes")}</h3>
        {#if nodeTypes.length === 0}
          <p class="panel-empty">{t("flow.noNodeTypes")}</p>
        {/if}
        {#each nodeTypes as nt (nt.node_type)}
          <button class="node-row" onclick={() => addNode(nt.node_type)}>
            <span class="node-row-name">{dn(nt.display_name, nt.node_type)}</span>
            <span class="node-row-id">{nt.node_type}</span>
            {#if nt.compile_hint}
              <span class="node-row-emits">→ {nt.compile_hint.emits}</span>
            {/if}
          </button>
        {/each}
      </aside>

      <!-- === 画布 === -->
      <section class="canvas-col">
        <div class="canvas-toolbar">
          {#if assistant}
            <button class="btn-ai" onclick={() => (transpileOpen = true)} title={t("flow.aiTranspileTitle")}>
              {t("flow.aiTranspile")}
            </button>
          {/if}
          <button
            class="btn-secondary"
            disabled={!selectedNode || connectFrom !== null}
            onclick={startConnect}
          >
            {connectFrom ? t("flow.connecting") : t("flow.connectFromSelected")}
          </button>
          <button class="btn-secondary" disabled={!selectedId} onclick={deleteSelected}>
            {t("flow.deleteNode")}
          </button>
          <button class="btn-secondary" disabled={canvasEdges.length === 0} onclick={() => (canvasEdges = [])}>
            {t("flow.clearEdges")}
          </button>
          <button class="btn-secondary" disabled={canvasNodes.length === 0} onclick={resetCanvas}>
            {t("flow.clearCanvas")}
          </button>
          <button
            class="btn-primary"
            disabled={compiling || canvasNodes.length === 0 || !canCompile}
            onclick={() => void handleCompile()}
          >
            {compiling ? t("flow.compiling") : t("flow.exportCompile")}
          </button>
          {#if !canCompile}
            <span class="toolbar-warn">{t("flow.noCompileCap")}</span>
          {/if}
        </div>
        <FlowCanvas
          nodes={canvasNodes}
          edges={canvasEdges}
          metas={canvasMetas}
          bind:selectedId
          bind:connectFrom
          onconnect={handleConnect}
          onedgeclick={deleteEdge}
        />
        <p class="canvas-tip">
          {t("flow.canvasTip")}
        </p>
      </section>

      <!-- === 属性面板（params_form 渲染,R4） === -->
      <aside class="props-panel" aria-label={t("flow.propsPanelAria")}>
        <h3 class="panel-title">{t("flow.nodeProps")}</h3>
        {#if !selectedNode}
          <p class="panel-empty">{t("flow.selectNodeHint")}</p>
        {:else if !selectedMeta || !selectedMeta.params_form || selectedMeta.params_form.length === 0}
          <p class="panel-empty">
            {t("flow.noEditableParams", {
              id: selectedNode.node_id,
              name: dn(selectedMeta?.display_name, selectedNode.node_type),
            })}
          </p>
        {:else}
          <p class="props-node-id">{selectedNode.node_id}</p>
          {#each selectedMeta.params_form as p (p.field_id)}
            <div class="form-field">
              <label class="field-label" for="np-{p.field_id}">
                {dn(p.display_name, p.field_id)}
                <span class="field-type">{p.type}</span>
                {#if p.required}<span class="field-req" title={t("flow.required")}>*</span>{/if}
              </label>
              {#if p.type === "scene_field"}
                {@const fields = pathedFields(p)}
                <select
                  id="np-{p.field_id}"
                  class="field-input"
                  value={String(fieldValue(p))}
                  onchange={(e) => setFieldValue(p, (e.target as HTMLSelectElement).value)}
                >
                  <option value="">{t("flow.selectSceneField")}</option>
                  {#each fields as f (f.field_id)}
                    <option value={f.field_id}>
                      {dn(f.display_name, f.field_id)}（{f.field_id}）
                    </option>
                  {/each}
                </select>
                {#if fields.length === 0}
                  <span class="field-warn">{t("flow.noPathedFields")}</span>
                {/if}
              {:else if p.type === "enum"}
                <select
                  id="np-{p.field_id}"
                  class="field-input"
                  value={String(fieldValue(p))}
                  onchange={(e) => setFieldValue(p, (e.target as HTMLSelectElement).value)}
                >
                  <option value="">{t("flow.selectOption")}</option>
                  {#each p.options ?? [] as opt (opt)}
                    <option value={opt}>{opt}</option>
                  {/each}
                </select>
              {:else if p.type === "boolean"}
                <input
                  id="np-{p.field_id}"
                  type="checkbox"
                  checked={Boolean(fieldValue(p))}
                  onchange={(e) => setFieldValue(p, (e.target as HTMLInputElement).checked)}
                />
              {:else if p.type === "textarea"}
                <textarea
                  id="np-{p.field_id}"
                  class="field-input"
                  rows="3"
                  value={String(fieldValue(p))}
                  oninput={(e) => setFieldValue(p, (e.target as HTMLTextAreaElement).value)}
                ></textarea>
              {:else}
                <input
                  id="np-{p.field_id}"
                  type={p.type === "number" || p.type === "currency" ? "number" : p.type === "date" ? "date" : "text"}
                  class="field-input"
                  value={String(fieldValue(p))}
                  oninput={(e) => setFieldValue(p, (e.target as HTMLInputElement).value)}
                />
              {/if}
            </div>
          {/each}
        {/if}
      </aside>
    </div>

    {#if compileError}
      <div class="error-banner" role="alert">
        <span>⚠</span>
        <span>{compileError}</span>
      </div>
    {/if}

    {#if draft !== null}
      <div class="draft-section">
        <header class="section-header">
          <h3>{t("flow.draftPreview")}</h3>
          {#if draftProvenance}
            <span class="provenance">
              pack {draftProvenance.pack} v{draftProvenance.pack_version}
              · flow {draftProvenance.flow}（{draftProvenance.source === "draft" ? t("flow.provCanvasDraft") : t("flow.provLoadedFlow")}）
              · compiler {draftProvenance.compiler}
              · contract {draftProvenance.contract_version}
            </span>
          {/if}
          <button class="btn-secondary" onclick={handleCopy}>
            {copied ? t("flow.copied") : t("flow.copyJson")}
          </button>
        </header>
        <div class="draft-tree">
          <JsonTree data={draft} rootLabel="rule_draft" />
        </div>
      </div>
    {/if}

    <!-- P3:AI 转译流程 Dialog（扩展槽消费;onfill 走 loadFlowAsset 同投影） -->
    {#if transpileOpen}
      <TranspileFlowDialog
        context={transpileCtx}
        onfill={handleAiFill}
        onclose={() => (transpileOpen = false)}
      />
    {/if}
  {/if}
</div>

<style>
  .flow-page {
    padding: var(--spacing-lg);
    max-width: 1400px;
    margin: 0 auto;
  }

  .flow-header {
    display: flex;
    align-items: baseline;
    gap: var(--spacing-md);
    padding-bottom: var(--spacing-md);
    border-bottom: 1px solid var(--border);
    margin-bottom: var(--spacing-lg);
    flex-wrap: wrap;
  }

  .flow-title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--text-primary);
  }

  .flow-hint {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .btn-primary,
  .btn-secondary {
    padding: var(--spacing-xs) var(--spacing-md);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .btn-primary {
    background: var(--brand);
    color: #fff;
    border: 1px solid var(--brand);
  }

  .btn-secondary {
    background: var(--bg-card);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .btn-primary:disabled,
  .btn-secondary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm) var(--spacing-md);
    background: color-mix(in srgb, var(--danger) 8%, var(--bg-card));
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    color: var(--danger);
    font-size: var(--text-sm);
    margin-bottom: var(--spacing-md);
  }

  .pack-bar {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
    flex-wrap: wrap;
  }

  .pack-label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    font-weight: var(--font-medium);
  }

  .pack-select {
    min-width: 220px;
    font-size: var(--text-sm);
  }

  .flow-id-input {
    min-width: 180px;
    font-size: var(--text-sm);
    padding: var(--spacing-xs) var(--spacing-sm);
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-family: var(--font-mono);
  }

  .flow-layout {
    display: grid;
    grid-template-columns: 216px 1fr 280px;
    gap: var(--spacing-md);
    align-items: start;
  }

  .node-panel,
  .props-panel {
    background: var(--bg-card);
    border: var(--card-border);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .panel-title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--text-primary);
  }

  .panel-empty {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin: 0;
  }

  .node-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: var(--spacing-sm);
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    font-family: var(--font-sans);
    transition: border-color var(--transition-fast);
  }

  .node-row:hover {
    border-color: var(--brand);
  }

  .node-row-name {
    font-size: var(--text-sm);
    color: var(--text-primary);
    font-weight: var(--font-medium);
  }

  .node-row-id {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-secondary);
  }

  .node-row-emits {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-secondary);
  }

  .canvas-col {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .canvas-toolbar {
    display: flex;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
    align-items: center;
  }

  .toolbar-warn {
    font-size: var(--text-xs);
    color: var(--warning);
  }

  /* P3:AI 转译入口（扩展槽注入才渲染;与 btn-secondary 同形,品牌色区分） */
  .btn-ai {
    padding: var(--spacing-xs) var(--spacing-md);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    cursor: pointer;
    background: color-mix(in srgb, var(--brand) 10%, var(--bg-card));
    color: var(--brand);
    border: 1px solid color-mix(in srgb, var(--brand) 45%, var(--border));
  }

  .btn-ai:hover {
    border-color: var(--brand);
  }

  .canvas-tip {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .props-node-id {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .field-label {
    display: flex;
    align-items: baseline;
    gap: var(--spacing-sm);
    font-size: var(--text-sm);
    color: var(--text-primary);
    font-weight: var(--font-medium);
  }

  .field-type {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    font-weight: var(--font-regular, 400);
  }

  .field-req {
    color: var(--danger);
  }

  .field-input {
    font-size: var(--text-sm);
    padding: var(--spacing-xs) var(--spacing-sm);
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-primary);
  }

  .field-input:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .field-warn {
    font-size: var(--text-xs);
    color: var(--warning);
  }

  .draft-section {
    margin-top: var(--spacing-lg);
    background: var(--bg-card);
    border: var(--card-border);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-sm);
    flex-wrap: wrap;
  }

  .section-header h3 {
    margin: 0;
    font-size: var(--text-base);
    color: var(--text-primary);
    font-weight: var(--font-semibold);
  }

  .provenance {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin-right: auto;
  }

  .draft-tree {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    overflow: auto;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-2xl);
    color: var(--text-secondary);
    text-align: center;
    background: var(--bg-card);
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
  }

  .empty-icon {
    font-size: 48px;
    margin-bottom: var(--spacing-md);
  }

  .empty-hint {
    font-size: var(--text-xs);
    margin-top: var(--spacing-xs);
    color: var(--text-secondary);
  }

  @media (max-width: 1100px) {
    .flow-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
