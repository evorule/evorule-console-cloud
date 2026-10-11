// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// template-services 渲染面客户端 — 确定性模板渲染调试/消费
//
// 端点对齐 evorule-server plugins/template-services:
//   - POST /api/templates/render → 确定性纯函数渲染(不落库,与 pack 模板 generate 同口径)
//
// 设计: 独立轻客户端(模式对齐 plugin-packs.ts)——渲染面是独立契约域;
//   鉴权/错误处理模式与 http-workspace-backend.ts 一致。
//   默认 loopback 免认证;server 启用统一认证时经 authToken 构造参数传 Bearer。

const DEFAULT_BASE_URL = 'http://127.0.0.1:18080';

/** 连接或响应异常(模式对齐 PluginPacksError) */
export class TemplatesError extends Error {
  readonly status: number;
  readonly endpoint: string;

  constructor(message: string, status: number, endpoint: string) {
    super(message);
    this.name = 'TemplatesError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

/** 渲染产出格式(缺省 text;声明 json 时服务端对产物额外做合法性校验) */
export type RenderFormat = 'text' | 'markdown' | 'json';

/** POST /api/templates/render 请求体 */
export interface RenderRequest {
  /** 必填,非空,≤ 1 MiB */
  template: string;
  /** 可选对象,模板变量取值来源(数值域为整数,无浮点);缺省空对象 */
  context?: Record<string, unknown>;
  /** 可选,缺省 text */
  format?: RenderFormat;
}

/** POST /api/templates/render 成功响应 */
export interface RenderResult {
  success: true;
  format: RenderFormat;
  content: string;
}

export class TemplatesClient {
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
      throw new TemplatesError(`network error: ${(e as Error).message}`, 0, path);
    }
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new TemplatesError(`HTTP ${r.status}: ${text.slice(0, 200)}`, r.status, path);
    }
    return (await r.json()) as T;
  }

  /**
   * POST /api/templates/render — 确定性模板渲染(纯函数,server 不落库)。
   * 服务端 fail-fast 不静默回退:模板为空/路径缺失/迭代源缺失或非数组/预算超限
   * (模板 1 MiB/输出 8 MiB/迭代 10 万次)/(json 声明时)产物非法 → 400 显式报错,
   * 错误文本含 1 基行列诊断,原样抛出交 UI 展示。
   */
  async render(req: RenderRequest): Promise<RenderResult> {
    return this.fetchJson<RenderResult>('/api/templates/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
  }
}
