// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console 插件契约 v1 资产面客户端 — 声明式 pack 只读 + 草稿生成/编译
//
// 依据: Plugin Contract v1.1 §5/§6（D:\knowledge\2-Projects\evorule-plugin\02-Plugin-Contract-v1.md）
// 端点对齐 evorule-server api/plugin_packs.rs:
//   - GET  /api/plugins                                          → pack 清单
//   - GET  /api/plugins/{pack_id}/assets/{kind}                  → 资产只读面（kind ∈ scenes|templates|flows|node_types）
//   - POST /api/plugins/templates/{pack_id}/{template_id}/generate → 草稿生成纯函数（不落库,R3）
//   - POST /api/plugins/flows/{pack_id}/{flow_id}/compile         → 流程编译代理（draft-only,R3;body 空=编译已装载
//                                                                    流程,{"flow":{...}}=编译画布草稿,契约 v1.1 §6）
//
// 设计: 独立轻客户端（不复用 HttpWorkspaceBackend 类型）——插件资产面是
//   独立契约域；鉴权/错误处理模式与 http-workspace-backend.ts 一致。
//   默认 loopback 免认证；server 启用 --auth-token 时经 authToken 构造参数传 Bearer。

const DEFAULT_BASE_URL = 'http://127.0.0.1:18080';

/** 连接或响应异常（模式对齐 HttpWorkspaceBackendError） */
export class PluginPacksError extends Error {
  readonly status: number;
  readonly endpoint: string;

  constructor(message: string, status: number, endpoint: string) {
    super(message);
    this.name = 'PluginPacksError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

// ============================================================================
// 契约 v1 资产类型（只读视图,与 pack.json 形态一一对应）
// ============================================================================

/** 双语展示名（R5 纯展示数据,不进事实/命令） */
export type DisplayName = { zh?: string; en?: string } & Record<string, unknown>;

/** GET /api/plugins 元素 */
export interface PluginSummary {
  id: string;
  contract_version: string;
  version: string;
  description: string;
  capabilities: string[];
  assets: { scenes: number; templates: number; flows?: number; node_types?: number };
}

/** 模板表单参数（契约 §4.3 / §4.5 控件词表） */
export interface ParamFieldRaw {
  field_id: string;
  display_name: DisplayName;
  type:
    | 'text'
    | 'textarea'
    | 'number'
    | 'currency'
    | 'date'
    | 'boolean'
    | 'enum'
    | 'scene_field';
  required?: boolean;
  default?: unknown;
  options?: string[];
  scene_ref?: string;
}

/** 模板资产原值（GET assets/templates 元素） */
export interface TemplateAssetRaw {
  template_id: string;
  display_name: DisplayName;
  description?: string;
  scene_ref?: string;
  params_form: ParamFieldRaw[];
  rule_draft_skeleton: unknown;
}

/** 场景字段（契约 §4.2） */
export interface SceneFieldRaw {
  field_id: string;
  display_name: DisplayName;
  type: string;
  options?: string[];
  path?: string;
  unit?: string;
}

/** 场景资产原值（GET assets/scenes 元素） */
export interface SceneAssetRaw {
  scene_id: string;
  display_name: DisplayName;
  description?: string;
  business_objects: Array<{
    object_id: string;
    display_name: DisplayName;
    fields: SceneFieldRaw[];
  }>;
}

/** POST generate 响应（R3: 仅草稿 + 来源标记,不落库） */
export interface GenerateResult {
  rule_draft: unknown;
  provenance: {
    pack: string;
    pack_version: string;
    template: string;
    contract_version: string;
  };
}

/** 节点类型资产（契约 §4.4；画布节点面板/属性表单唯一来源,R4） */
export interface NodeTypeAssetRaw {
  node_type: string;
  display_name: DisplayName;
  description?: string;
  params_form?: ParamFieldRaw[];
  compile_hint?: { emits: string; note?: string };
  /** 出边 guard 取值域声明（契约 v1.2 §4.4;缺省/空 = 该类型出边禁 guard） */
  out_guards?: string[];
}

/** flow 节点（契约 v1.1 §4.6） */
export interface FlowNodeRaw {
  node_id: string;
  node_type: string;
  params?: Record<string, unknown>;
  form_ref?: { scene: string; field: string };
  threshold?: number;
}

/** flow 边（契约 v1.1 §4.6；审批出边 guard="approved"） */
export interface FlowEdgeRaw {
  from: string;
  to: string;
  guard?: string;
}

/** flow 资产原值（GET assets/flows 元素） */
export interface FlowAssetRaw {
  flow_id: string;
  display_name?: DisplayName;
  description?: string;
  version: number;
  nodes: FlowNodeRaw[];
  edges: FlowEdgeRaw[];
}

/** POST compile 响应（R3: 仅草稿 + 来源标记,不落库;source ∈ asset|draft） */
export interface FlowCompileResult {
  rule_draft: unknown;
  provenance: {
    pack: string;
    pack_version: string;
    flow: string;
    compiler: string;
    contract_version: string;
    source: string;
  };
}

/** 展示名取值:zh 优先,en 兜底,最后回退 id（console 中文 UI） */
export function dn(name: DisplayName | undefined, fallback: string): string {
  if (!name) return fallback;
  if (typeof name.zh === 'string' && name.zh) return name.zh;
  if (typeof name.en === 'string' && name.en) return name.en;
  return fallback;
}

// ============================================================================
// 客户端
// ============================================================================

export class PluginPacksClient {
  private readonly baseUrl: string;
  private readonly authToken: string | null;

  constructor(baseUrl: string = DEFAULT_BASE_URL, authToken: string | null = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authToken = authToken;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.authToken) {
      h['Authorization'] = `Bearer ${this.authToken}`;
    }
    return h;
  }

  private async fetchJson<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const url = this.baseUrl + path;
    let r: Response;
    try {
      r = await fetch(url, {
        ...opts,
        headers: this.headers(opts.headers as Record<string, string> | undefined)
      });
    } catch (e) {
      throw new PluginPacksError(`network error: ${(e as Error).message}`, 0, path);
    }
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new PluginPacksError(`HTTP ${r.status}: ${text.slice(0, 200)}`, r.status, path);
    }
    return (await r.json()) as T;
  }

  /** GET /api/plugins — 已注册声明式 pack 清单 */
  async listPacks(): Promise<PluginSummary[]> {
    const j = await this.fetchJson<{ contract_version: string; plugins: PluginSummary[] }>(
      '/api/plugins'
    );
    return Array.isArray(j.plugins) ? j.plugins : [];
  }

  /** GET /api/plugins/{pack_id}/assets/templates — 模板资产原值 */
  async getTemplates(packId: string): Promise<TemplateAssetRaw[]> {
    const j = await this.fetchJson<{ pack: string; kind: string; assets: TemplateAssetRaw[] }>(
      `/api/plugins/${encodeURIComponent(packId)}/assets/templates`
    );
    return Array.isArray(j.assets) ? j.assets : [];
  }

  /** GET /api/plugins/{pack_id}/assets/scenes — 场景资产原值 */
  async getScenes(packId: string): Promise<SceneAssetRaw[]> {
    const j = await this.fetchJson<{ pack: string; kind: string; assets: SceneAssetRaw[] }>(
      `/api/plugins/${encodeURIComponent(packId)}/assets/scenes`
    );
    return Array.isArray(j.assets) ? j.assets : [];
  }

  /** GET /api/plugins/{pack_id}/assets/node_types — 节点类型资产原值（契约 §4.4） */
  async getNodeTypes(packId: string): Promise<NodeTypeAssetRaw[]> {
    const j = await this.fetchJson<{ pack: string; kind: string; assets: NodeTypeAssetRaw[] }>(
      `/api/plugins/${encodeURIComponent(packId)}/assets/node_types`
    );
    return Array.isArray(j.assets) ? j.assets : [];
  }

  /** GET /api/plugins/{pack_id}/assets/flows — 流程资产原值（契约 v1.1 §4.6） */
  async getFlows(packId: string): Promise<FlowAssetRaw[]> {
    const j = await this.fetchJson<{ pack: string; kind: string; assets: FlowAssetRaw[] }>(
      `/api/plugins/${encodeURIComponent(packId)}/assets/flows`
    );
    return Array.isArray(j.assets) ? j.assets : [];
  }

  /**
   * POST /api/plugins/flows/{pack_id}/{flow_id}/compile — 流程编译代理（R3 draft-only）。
   * flowDraft 缺省 → 编译已装载的同名 flow 资产；
   * flowDraft 传入 → 编译画布草稿（server 先过与装载期同一套校验链,R2）。
   * 校验/门禁失败 → 4xx/502 显式错误（服务端 fail-fast 文案已面向用户,原样抛出）。
   */
  async compileFlow(packId: string, flowId: string, flowDraft?: FlowAssetRaw): Promise<FlowCompileResult> {
    const body = flowDraft ? { flow: flowDraft } : {};
    return this.fetchJson<FlowCompileResult>(
      `/api/plugins/flows/${encodeURIComponent(packId)}/${encodeURIComponent(flowId)}/compile`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );
  }

  /**
   * POST /api/plugins/templates/{pack_id}/{template_id}/generate — 草稿生成。
   * 纯函数面:server 不落库,草稿仅在用户确认后走既有 Draft→Publish 链（R3）。
   * 校验失败 → 400 显式错误（服务端 fail-fast 文案已面向用户,原样抛出）。
   */
  async generate(packId: string, templateId: string, form: Record<string, unknown>): Promise<GenerateResult> {
    return this.fetchJson<GenerateResult>(
      `/api/plugins/templates/${encodeURIComponent(packId)}/${encodeURIComponent(templateId)}/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      }
    );
  }
}
