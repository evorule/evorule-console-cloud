// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console 执行后端 — HttpBackend 实现
//
// 依据: docs/SPEC.md §1.3, §5
// 端点对齐:
//   - time-travel-debugger/src/core/api.js (v1.0,49/51 PASS)
//   (旧 src/lib/api/evorule-server.js 只读 client 已于阶段 C.1 删除;本文件是其 TS 全功能超集)
//
// 设计说明:
//   - HttpBackend 是"开发期 / 大众版"实现,不是 evorule-console 边界的一部分
//   - 高级版用 EmbeddedBackend (Tauri + Rust) 替换,不联网
//   - 复用旧 console client 的只读部分(health/list/getState/getAudit/getReplay)
//   - 补全写操作和高级查询(submitCommand / forkSession / getDiff / getCausalChain / verifyAudit / ...)
//
// 端口:默认 127.0.0.1:18080 (evorule-server default)
// 浏览器 fetch 需在客户端 mount 后调用(SSR 不安全,SvelteKit 浏览器端用 onMount)。

import type {
  SessionId,
  SessionState,
  HistoricalState,
  SessionAudit,
  VerifyResult,
  Fact,
  FactRecord,
  DiffResult,
  CausalChain,
  CommandResult,
  ExecutionBackend
} from './types';

const DEFAULT_BASE_URL = 'http://127.0.0.1:18080';

/**
 * evorule-server 连接或响应异常的统一错误类型。
 * 视图层用 instanceof 区分网络错误与业务错误。
 */
export class HttpBackendError extends Error {
  readonly status: number;
  readonly endpoint: string;

  constructor(message: string, status: number, endpoint: string) {
    super(message);
    this.name = 'HttpBackendError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

/**
 * HttpBackend — 调 evorule-server HTTP API 实现 ExecutionBackend。
 *
 * 用法:
 *   const backend = new HttpBackend();           // 默认 127.0.0.1:18080
 *   const backend = new HttpBackend('http://localhost:9000');
 *   const backend = new HttpBackend('http://localhost:9000', 'token'); // Bearer 认证
 *   const ok = await backend.health();
 */
export class HttpBackend implements ExecutionBackend {
  private readonly baseUrl: string;
  private readonly authToken: string | null;

  constructor(baseUrl: string = DEFAULT_BASE_URL, authToken: string | null = null) {
    // 去掉末尾斜杠,避免 path 拼接出现 //
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authToken = authToken;
  }

  // ------------------------------------------------------------------------
  // 内部工具
  // ------------------------------------------------------------------------

  /** 构造请求头(含可选 Bearer token;模式对齐 HttpWorkspaceBackend.headers) */
  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.authToken) {
      h['Authorization'] = `Bearer ${this.authToken}`;
    }
    return h;
  }

  /**
   * 统一 fetch + JSON 解析 + 错误处理。
   * 对齐 ttd api.js fetchJson 的行为,但返回类型化结果。
   *
   * @param path  - 以 / 开头的 path,如 /api/sessions
   * @param opts  - RequestInit(method/headers/body)
   */
  private async fetchJson<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const url = this.baseUrl + path;
    let r: Response;
    try {
      r = await fetch(url, {
        ...opts,
        headers: this.headers(opts.headers as Record<string, string> | undefined)
      });
    } catch (e) {
      // fetch 抛出 TypeError 通常是网络问题(连接拒绝 / DNS 失败 / CORS)
      throw new HttpBackendError(
        `network error: ${(e as Error).message}`,
        0,
        path
      );
    }

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new HttpBackendError(
        `HTTP ${r.status}: ${text.slice(0, 200)}`,
        r.status,
        path
      );
    }

    // evorule-server 某些端点(如 health)可能返回非 JSON
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('json')) {
      return (await r.json()) as T;
    }
    // 非 JSON 端点(极少见,health 可能是纯文本):原样返回
    return (await r.text()) as unknown as T;
  }

  /** 构造 POST application/json 请求 */
  private postJson(body?: unknown): RequestInit {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    };
  }

  // ------------------------------------------------------------------------
  // === 会话管理 ===
  // ------------------------------------------------------------------------

  /** GET /api/health — 只检查 HTTP 状态,不解析 body(兼容纯文本响应) */
  async health(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/api/health`, { headers: this.headers() });
      return r.ok;
    } catch {
      return false;
    }
  }

  /**
   * POST /api/sessions — 创建 session,返回新 SessionId。
   *
   * C1 修复(2026-08-03):对齐 INTEGRATION_GUIDE §2.1,server 返回
   *   { session_id: number, message: string },字段名是 session_id(不是 id)。
   *   保留对裸数字 / {id} 的兜底以兼容其他实现。
   */
  async createSession(): Promise<SessionId> {
    const r = await fetch(`${this.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: this.headers()
    });
    if (!r.ok) {
      throw new HttpBackendError(`createSession failed: ${r.status}`, r.status, '/api/sessions');
    }
    const j = await r.json().catch(() => null);
    if (typeof j === 'number') return j;
    if (j && typeof j.session_id === 'number') return j.session_id;
    if (j && typeof j.id === 'number') return j.id; // 兜底
    throw new HttpBackendError(
      `createSession: unexpected response shape: ${JSON.stringify(j).slice(0, 200)}`,
      200,
      '/api/sessions'
    );
  }

  /** GET /api/sessions — 返回 SessionId 列表 */
  async listSessions(): Promise<SessionId[]> {
    const j = await this.fetchJson<{ sessions?: SessionId[] } | SessionId[]>(
      '/api/sessions'
    );
    // 兼容两种响应:{ sessions: [1,2,3] } 或裸数组 [1,2,3]
    if (Array.isArray(j)) return j;
    if (j && Array.isArray(j.sessions)) return j.sessions;
    return [];
  }

  /** DELETE /api/sessions/{id} — 关闭 session */
  async closeSession(id: SessionId): Promise<void> {
    await this.fetchJson<void>(`/api/sessions/${id}`, { method: 'DELETE' });
  }

  /** GET /api/sessions/{id}/state — 当前 session 快照 */
  async getSessionState(id: SessionId): Promise<SessionState> {
    return this.fetchJson<SessionState>(`/api/sessions/${id}/state`);
  }

  // ------------------------------------------------------------------------
  // === 命令执行 ===
  // ------------------------------------------------------------------------

  /**
   * POST /api/sessions/{id}/command (body: { instruction })
   * 对齐 ttd api.js command() 的 body 形式。
   *
   * 响应适配(2026-08-03 dogfooding 发现):
   *   evorule-server 实际返回: { success, message, fact_id }
   *   CommandResult 契约期望:   { accepted, version?, error? }
   *   这里做字段映射,兼容两种格式(优先 accepted,回退 success)。
   *   version 不在 command 响应中返回,前端通过 refreshSessionState 获取。
   */
  async submitCommand(id: SessionId, instruction: object): Promise<CommandResult> {
    const raw = await this.fetchJson<Record<string, unknown>>(
      `/api/sessions/${id}/command`,
      this.postJson({ instruction })
    );
    // 兼容两种响应格式:
    //   evorule-server: { success: true, message: "Command submitted", fact_id: 30000 }
    //   理想契约:     { accepted: true, version: 6 }
    const accepted =
      typeof raw.accepted === 'boolean' ? raw.accepted : Boolean(raw.success);
    const result: CommandResult = { accepted };
    if (typeof raw.version === 'number') result.version = raw.version;
    if (typeof raw.error === 'string') {
      result.error = raw.error;
    } else if (!accepted && typeof raw.message === 'string') {
      result.error = raw.message;
    }
    return result;
  }

  // ------------------------------------------------------------------------
  // === 历史 / 回放 ===
  // ------------------------------------------------------------------------

  /** GET /api/sessions/{id}/history — 完整历史(结构由 evorule-server 定) */
  async getHistory(id: SessionId): Promise<unknown> {
    return this.fetchJson<unknown>(`/api/sessions/${id}/history`);
  }

  /**
   * GET /api/sessions/{id}/replay?from=&to=
   * 对齐 ttd api.js replay(): 大 session 必须用范围参数。
   *
   * @param from  起始 fact id(默认 0)
   * @param to    结束 fact id,null 表示到末尾(默认 null)
   */
  async getReplay(
    id: SessionId,
    from: number = 0,
    to: number | null = null
  ): Promise<Fact[]> {
    let q = `?from=${from}`;
    if (to !== null) q += `&to=${to}`;
    const j = await this.fetchJson<Fact[] | { facts: Fact[] }>(
      `/api/sessions/${id}/replay${q}`
    );
    // 兼容裸数组或 { facts: [...] }
    if (Array.isArray(j)) return j;
    if (j && Array.isArray((j as { facts: Fact[] }).facts)) {
      return (j as { facts: Fact[] }).facts;
    }
    return [];
  }

  /**
   * GET /api/sessions/{id}/facts?prefix=
   * 对齐 ttd api.js facts(): 支持 prefix 过滤(按 path 前缀)。
   *
   * C4 修复(2026-08-03):对齐 server session_facts_by_prefix,返回 FactRecord[]
   *   (元素字段为 fact_id / version / path / value),不是完整 Fact。
   *   D-S3 后 server 已 filter 非 PayloadUpdate,不再有空对象。
   */
  async getFacts(id: SessionId, prefix?: string): Promise<FactRecord[]> {
    const q = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
    const j = await this.fetchJson<FactRecord[] | { facts: FactRecord[] }>(
      `/api/sessions/${id}/facts${q}`
    );
    if (Array.isArray(j)) return j;
    if (j && Array.isArray((j as { facts: FactRecord[] }).facts)) {
      return (j as { facts: FactRecord[] }).facts;
    }
    return [];
  }

  // ------------------------------------------------------------------------
  // === 审计 ===
  // ------------------------------------------------------------------------

  /** GET /api/sessions/{id}/audit — 审计链 */
  async getAudit(id: SessionId): Promise<SessionAudit> {
    return this.fetchJson<SessionAudit>(`/api/sessions/${id}/audit`);
  }

  /**
   * GET /api/sessions/{id}/audit/verify
   * 对齐 ttd api.js 修复 4: 字段是 verified,不是 valid。
   */
  async verifyAudit(id: SessionId): Promise<VerifyResult> {
    return this.fetchJson<VerifyResult>(`/api/sessions/${id}/audit/verify`);
  }

  /**
   * GET /api/sessions/{id}/audit/causal/{factId} — 因果链。
   * C3 修复(2026-08-03):chain 元素是审计条目 CausalEntry(fact_id / fact_type /
   *   logical_time / cause / ...),不是完整 Fact(type / id),对齐 INTEGRATION_GUIDE §3.3。
   *   server 返回 { session_id, fact_id, chain_length, chain: [...] },直接透传。
   */
  async getCausalChain(id: SessionId, factId: number): Promise<CausalChain> {
    return this.fetchJson<CausalChain>(
      `/api/sessions/${id}/audit/causal/${factId}`
    );
  }

  // ------------------------------------------------------------------------
  // === 时间旅行 ===
  // ------------------------------------------------------------------------

  /**
   * GET /api/sessions/{id}/rewind?version=
   * 对齐 ttd api.js 修复 1: path 用 query ?version=N,不是 /rewind/{v}。
   *
   * C6/D2-A 修复(2026-08-03):rewind 是历史快照,server 不返回 reactor(无历史运行态,
   *   不编造)。返回类型从 SessionState 改为 HistoricalState(无 reactor)。
   *   server rewind 返回 { payload, queue, actual_version }(actual_version 是实际回溯版本,
   *   可能与请求 version 不同),这里映射为 HistoricalState.version。
   */
  async getStateAtVersion(id: SessionId, version: number): Promise<HistoricalState> {
    const raw = await this.fetchJson<Record<string, unknown>>(
      `/api/sessions/${id}/rewind?version=${version}`
    );
    const v =
      typeof raw.actual_version === 'number'
        ? raw.actual_version
        : typeof raw.version === 'number'
          ? raw.version
          : version;
    return {
      payload: (raw.payload as object) ?? {},
      queue: Array.isArray(raw.queue) ? raw.queue : [],
      version: v
    };
  }

  /**
   * GET /api/sessions/{id}/diff?a=&b=
   * 对齐 ttd api.js 修复 2: items 是数组格式 ["key", value] / ["key", old, new]。
   * D1-B 修复(2026-08-03):server 同时返回 removed 字段(可选),DiffResult.removed 透传。
   */
  async getDiff(id: SessionId, a: number, b: number): Promise<DiffResult> {
    return this.fetchJson<DiffResult>(`/api/sessions/${id}/diff?a=${a}&b=${b}`);
  }

  // ------------------------------------------------------------------------
  // === What-If 假设分析 ===
  // ------------------------------------------------------------------------

  /**
   * POST /api/sessions/fork/{parentId}?version=
   * 对齐 ttd api.js fork(): 在指定 version 处分叉出新 session。
   *
   * C2 修复(2026-08-03):对齐 server 实现,返回
   *   { session_id, parent_session_id, forked_from_version, message },
   *   字段名是 session_id(不是 id)。保留裸数字 / {id} 兜底。
   */
  async forkSession(parentId: SessionId, version: number): Promise<SessionId> {
    const r = await fetch(
      `${this.baseUrl}/api/sessions/fork/${parentId}?version=${version}`,
      { method: 'POST', headers: this.headers() }
    );
    if (!r.ok) {
      throw new HttpBackendError(
        `forkSession failed: ${r.status}`,
        r.status,
        `/api/sessions/fork/${parentId}`
      );
    }
    const j = await r.json().catch(() => null);
    if (typeof j === 'number') return j;
    if (j && typeof j.session_id === 'number') return j.session_id;
    if (j && typeof j.id === 'number') return j.id; // 兜底
    throw new HttpBackendError(
      `forkSession: unexpected response shape: ${JSON.stringify(j).slice(0, 200)}`,
      200,
      `/api/sessions/fork/${parentId}`
    );
  }
}
