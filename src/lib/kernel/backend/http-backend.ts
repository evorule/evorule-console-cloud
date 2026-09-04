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
  InterruptResult,
  AutoVerifyStatus,
  AutoVerifyConfigResult,
  StepInfo,
  SessionSnapshot,
  DebugPhaseInfo,
  DebugQueueInfo,
  DebugPendingIoInfo,
  PendingIoCountInfo,
  CausalDepthInfo,
  AuditImportResult,
  ReapResult,
  PayloadUpdateResult,
  SharedFactEntry,
  SharedFactsVersionInfo,
  PermissionEntryRecord,
  PermissionListResult,
  PermissionWriteResult,
  PermissionVersionResult,
  PermissionEvaluateRequest,
  PermissionEvaluateResult,
  KnowledgeDatasetsResult,
  KnowledgeEntryRecord,
  KnowledgeEntryFilter,
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

  /**
   * 统一 fetch + Blob 解析(二进制端点用,如 gzip 审计链导出)。
   * 错误处理与 fetchJson 一致(网络错误 status=0;非 2xx 抛 HttpBackendError,
   * 含响应体前 200 字符摘要,不静默)。
   */
  private async fetchBlob(path: string, opts: RequestInit = {}): Promise<Blob> {
    const url = this.baseUrl + path;
    let r: Response;
    try {
      r = await fetch(url, {
        ...opts,
        headers: this.headers(opts.headers as Record<string, string> | undefined)
      });
    } catch (e) {
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
    return r.blob();
  }

  // ------------------------------------------------------------------------
  // === 会话管理 ===
  // ------------------------------------------------------------------------

  /**
   * GET /api/health — 只检查 HTTP 状态,不解析 body(兼容纯文本响应)。
   * signal 透传给 fetch(UV-085 ④):调用方 pagehide 主动中止,消灭浏览器
   * 中止 in-flight 请求的 console 噪音;中止走 catch → false(探测语义)。
   */
  async health(signal?: AbortSignal): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/api/health`, {
        headers: this.headers(),
        signal,
      });
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

  /**
   * POST /api/sessions/{id}/interrupt — 温和中断(UV-062)。
   * 下一检查点生效,无条件可用;会话不存在 → 404(HttpBackendError)。
   * 返回对齐 server InterruptResponse:{ session_id, success, message }。
   */
  async interruptSession(id: SessionId): Promise<InterruptResult> {
    return this.fetchJson<InterruptResult>(
      `/api/sessions/${id}/interrupt`,
      this.postJson()
    );
  }

  /**
   * POST /api/sessions/{id}/abort — 强制中止反应器任务(UV-062,破坏性)。
   * 不等待 checkpoint,直接中止;条件挂载:server 未以 --allow-abort
   * (或 EVORULE_ALLOW_ABORT=1)启动时端点未挂载 → 404,由调用方
   * 显式提示启用方法(fail-fast,不静默)。
   */
  async abortSession(id: SessionId): Promise<InterruptResult> {
    return this.fetchJson<InterruptResult>(
      `/api/sessions/${id}/abort`,
      this.postJson()
    );
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

  /**
   * GET /api/sessions/{id}/audit/export — 审计链 JSON 导出(UV-062 W2)。
   * server 返回完整哈希链 JSON(serde_json::Value),以 unknown 透传,
   * 由视图层序列化下载;失败(404 会话不存在 / 500 导出失败)抛 HttpBackendError。
   */
  async exportAudit(id: SessionId): Promise<unknown> {
    return this.fetchJson<unknown>(`/api/sessions/${id}/audit/export`);
  }

  /**
   * GET /api/sessions/{id}/audit/export/compressed — gzip 压缩审计链导出
   * (UV-062 W2)。server 返回 application/gzip 二进制(Content-Disposition
   * 文件名 audit_chain.json.gz,体积约为 JSON 的 5-10%),以 Blob 返回,
   * Blob.type 携带实际 content-type,由视图层决定扩展名(.json.gz)。
   */
  async exportAuditCompressed(id: SessionId): Promise<Blob> {
    return this.fetchBlob(`/api/sessions/${id}/audit/export/compressed`);
  }

  /**
   * GET /api/sessions/{id}/audit/auto_verify — 查询实时验证开关(UV-062 W2)。
   * 返回 { session_id, auto_verify }。
   */
  async getAutoVerify(id: SessionId): Promise<AutoVerifyStatus> {
    return this.fetchJson<AutoVerifyStatus>(
      `/api/sessions/${id}/audit/auto_verify`
    );
  }

  /**
   * POST /api/sessions/{id}/audit/auto_verify — 设置实时验证开关(UV-062 W2)。
   * threshold / interval 缺省不传(server serde default:threshold=0 不限制,
   * interval=0 被核心归一为 1 = 每次验证);返回配置结果,调用方须检查
   * success 并显式提示失败(不静默)。
   */
  async setAutoVerify(
    id: SessionId,
    enabled: boolean,
    threshold?: number,
    interval?: number
  ): Promise<AutoVerifyConfigResult> {
    const body: Record<string, unknown> = { enabled };
    if (threshold !== undefined) body.threshold = threshold;
    if (interval !== undefined) body.interval = interval;
    return this.fetchJson<AutoVerifyConfigResult>(
      `/api/sessions/${id}/audit/auto_verify`,
      this.postJson(body)
    );
  }

  /**
   * 公开只读 GET JSON(UV-016 审计档案等 server 扩展端点使用)。
   * 复用统一 headers(Bearer)与错误处理,供 Cloud 层组合调用。
   */
  getJson<T>(path: string): Promise<T> {
    return this.fetchJson<T>(path);
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

  // ------------------------------------------------------------------------
  // === 调试只读查询(UV-062 W2,六路独立) ===
  // ------------------------------------------------------------------------

  /** GET /api/sessions/{id}/step — 当前执行步数({ session_id, current_step }) */
  async getStep(id: SessionId): Promise<StepInfo> {
    return this.fetchJson<StepInfo>(`/api/sessions/${id}/step`);
  }

  /**
   * GET /api/sessions/{id}/snapshot — 反应器完整状态快照。
   * server 在反应器结束/锁中毒时返回 200 + 仅 { session_id, error }
   * (数据字段缺失 ≠ 隐式 0),此处透传,由调用方检查 error 字段展示失败态。
   */
  async getSessionSnapshot(id: SessionId): Promise<SessionSnapshot> {
    return this.fetchJson<SessionSnapshot>(`/api/sessions/${id}/snapshot`);
  }

  /** GET /api/sessions/{id}/debug/phase — 当前执行阶段(null = 未启动) */
  async getDebugPhase(id: SessionId): Promise<DebugPhaseInfo> {
    return this.fetchJson<DebugPhaseInfo>(`/api/sessions/${id}/debug/phase`);
  }

  /** GET /api/sessions/{id}/debug/queue — 待执行队列(server 当前恒为空数组) */
  async getDebugQueue(id: SessionId): Promise<DebugQueueInfo> {
    return this.fetchJson<DebugQueueInfo>(`/api/sessions/${id}/debug/queue`);
  }

  /** GET /api/sessions/{id}/debug/pending_io — 悬挂 I/O 计数与列表 */
  async getDebugPendingIo(id: SessionId): Promise<DebugPendingIoInfo> {
    return this.fetchJson<DebugPendingIoInfo>(
      `/api/sessions/${id}/debug/pending_io`
    );
  }

  /** GET /api/sessions/{id}/pending_io_count — 悬挂 I/O 计数 */
  async getPendingIoCount(id: SessionId): Promise<PendingIoCountInfo> {
    return this.fetchJson<PendingIoCountInfo>(
      `/api/sessions/${id}/pending_io_count`
    );
  }

  /** GET /api/sessions/{id}/causal_depth — 因果链深度({ session_id, causal_depth }) */
  async getCausalDepth(id: SessionId): Promise<CausalDepthInfo> {
    return this.fetchJson<CausalDepthInfo>(`/api/sessions/${id}/causal_depth`);
  }

  // ------------------------------------------------------------------------
  // === A 组 5 项(UV-084 W1:审计导入/会话派生/会话回收/payload 注入/共享事实) ===
  // ------------------------------------------------------------------------

  /**
   * POST /api/sessions/{id}/audit/import — 导入外部审计链 JSON(UV-084 W1)。
   * 破坏性:完全覆盖当前会话审计链,调用方须二次确认。
   * server 导入后自动 verify,verify_ok=false 时 status="verify_failed"
   * (HTTP 仍 200,数据可能损坏,如实呈现,不静默);400 JSON 解析失败 / 404 会话
   * 不存在由 fetchJson 抛 HttpBackendError。
   */
  async importAudit(id: SessionId, data: unknown): Promise<AuditImportResult> {
    return this.fetchJson<AuditImportResult>(
      `/api/sessions/${id}/audit/import`,
      this.postJson(data)
    );
  }

  /**
   * POST /api/sessions/{id}/audit/import/compressed — 导入 gzip 压缩审计链
   * (UV-084 W1)。请求体 application/gzip 二进制(与 exportAuditCompressed
   * 的导出互逆:导出的 .json.gz 可直接回灌);响应含 format:"gzip",
   * 其余字段与 importAudit 一致。
   */
  async importAuditCompressed(
    id: SessionId,
    blob: Blob
  ): Promise<AuditImportResult> {
    return this.fetchJson<AuditImportResult>(
      `/api/sessions/${id}/audit/import/compressed`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/gzip' },
        body: blob
      }
    );
  }

  /**
   * POST /api/sessions/from/{parent_id}?version= — 从父会话派生新会话
   * (UV-084 W1)。记录跨会话因果(父会话 ID + 初始内容哈希);version 缺省 =
   * 父最新版本。server 返回 { session_id, parent_session_id, ... },
   * 取 session_id;404 父会话不存在 / 429 超最大会话数 / 400 版本无效
   * 由 fetchJson 抛 HttpBackendError。
   */
  async createSessionFrom(
    parentId: SessionId,
    version?: number
  ): Promise<SessionId> {
    const q = version !== undefined ? `?version=${version}` : '';
    const j = await this.fetchJson<Record<string, unknown>>(
      `/api/sessions/from/${parentId}${q}`,
      this.postJson()
    );
    if (j && typeof j.session_id === 'number') return j.session_id;
    if (typeof j === 'number') return j; // 兜底
    throw new HttpBackendError(
      `createSessionFrom: unexpected response shape: ${JSON.stringify(j).slice(0, 200)}`,
      200,
      `/api/sessions/from/${parentId}`
    );
  }

  /**
   * POST /api/sessions/reap — 手动回收已结束/已过期会话(UV-084 W1)。
   * 与后台 reaper 走同一 reap_once:生产会话保活 + 失忆自愈(UV-079),
   * 不会误回收生产会话。返回 { finished, expired, total } 计数。
   */
  async reapSessions(): Promise<ReapResult> {
    return this.fetchJson<ReapResult>('/api/sessions/reap', this.postJson());
  }

  /**
   * POST /api/sessions/{id}/payload — 向指定会话注入 payload 字段
   * (UV-084 W1,body: { path, value })。path 以 "shared." 开头时 server
   * 同步写入共享事实日志(跨会话广播)。
   * 错误纪律:403 受保护域(stable.llm/stable.system 需 service 身份)与
   * 404 会话不存在抛 HttpBackendError(消息含 server 指引原文);
   * HTTP 200 + success=false = 命令通道关闭(反应器已退出),如实返回,
   * 由调用方检查 success 显式提示(不静默)。
   */
  async updatePayload(
    id: SessionId,
    path: string,
    value: unknown
  ): Promise<PayloadUpdateResult> {
    return this.fetchJson<PayloadUpdateResult>(
      `/api/sessions/${id}/payload`,
      this.postJson({ path, value })
    );
  }

  /**
   * GET /api/shared/facts?prefix= — 共享事实查询(UV-084 W1,跨会话广播
   * 事实,前缀过滤,缺省全部)。server 返回裸数组 [{ fact_id, path, value,
   * source_session_id, version }]。
   */
  async getSharedFacts(prefix?: string): Promise<SharedFactEntry[]> {
    const q = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
    const j = await this.fetchJson<SharedFactEntry[] | { facts: SharedFactEntry[] }>(
      `/api/shared/facts${q}`
    );
    if (Array.isArray(j)) return j;
    if (j && Array.isArray((j as { facts: SharedFactEntry[] }).facts)) {
      return (j as { facts: SharedFactEntry[] }).facts;
    }
    return [];
  }

  /**
   * GET /api/shared/facts/version — 共享事实日志版本与历史长度
   * (UV-084 W1)。返回 { version, history_len }。
   */
  async getSharedFactsVersion(): Promise<SharedFactsVersionInfo> {
    return this.fetchJson<SharedFactsVersionInfo>('/api/shared/facts/version');
  }

  // === UV-084 W3:A-流权限策略族(对齐 server permissions.rs) ===
  // 错误纪律:400/404/409/500 一律抛 HttpBackendError(消息含 server
  // {"message": ...} 原文,LLM/用户可自诊断),拒绝静默。

  /** GET /api/permissions — 全部权限条目 + 快照版本 */
  async listPermissions(): Promise<PermissionListResult> {
    return this.fetchJson<PermissionListResult>('/api/permissions');
  }

  /** GET /api/permissions/{id} — 单条查询(server 返回 {success, entry} 包装,解包) */
  async getPermission(id: string): Promise<PermissionEntryRecord> {
    const r = await this.fetchJson<{ success: boolean; entry: PermissionEntryRecord }>(
      `/api/permissions/${encodeURIComponent(id)}`
    );
    return r.entry;
  }

  /** POST /api/permissions — 新建(强制 Draft;409 id 冲突抛错) */
  async createPermission(entry: PermissionEntryRecord): Promise<PermissionWriteResult> {
    return this.fetchJson<PermissionWriteResult>(
      '/api/permissions',
      this.postJson(entry)
    );
  }

  /** PUT /api/permissions/{id} — 全量替换(幂等;已 Active 保持 Active) */
  async updatePermission(
    id: string,
    entry: PermissionEntryRecord
  ): Promise<PermissionWriteResult> {
    return this.fetchJson<PermissionWriteResult>(
      `/api/permissions/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      }
    );
  }

  /** DELETE /api/permissions/{id} — 删除(写墓碑,历史保留) */
  async deletePermission(id: string): Promise<PermissionWriteResult> {
    const r = await this.fetchJson<{ success: boolean; id: string }>(
      `/api/permissions/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    );
    return r;
  }

  /** POST /api/permissions/{id}/submit — 提交审批(Draft → Candidate) */
  async submitPermission(id: string): Promise<PermissionWriteResult> {
    return this.fetchJson<PermissionWriteResult>(
      `/api/permissions/${encodeURIComponent(id)}/submit`,
      this.postJson()
    );
  }

  /** POST /api/permissions/{id}/review — 审批裁决(Candidate → Active/Rejected) */
  async reviewPermission(id: string, approve: boolean): Promise<PermissionWriteResult> {
    return this.fetchJson<PermissionWriteResult>(
      `/api/permissions/${encodeURIComponent(id)}/review`,
      this.postJson({ approve })
    );
  }

  /** GET /api/permissions/version — 快照版本与条目数量 */
  async getPermissionsVersion(): Promise<PermissionVersionResult> {
    return this.fetchJson<PermissionVersionResult>('/api/permissions/version');
  }

  /** POST /api/permissions/evaluate — 只读判定测试(verdict: allow/deny/candidate) */
  async evaluatePermission(
    req: PermissionEvaluateRequest
  ): Promise<PermissionEvaluateResult> {
    return this.fetchJson<PermissionEvaluateResult>(
      '/api/permissions/evaluate',
      this.postJson(req)
    );
  }

  // === UV-084 W5:知识数据面(对齐 server knowledge.rs;错误体 {"error"},
  // fetchJson 非 ok 时原文透出,含 error 原文可自诊断) ===

  /** GET /api/knowledge — 已承载数据集清单(库加载失败 500 抛错,不静默空) */
  async listKnowledgeDatasets(): Promise<KnowledgeDatasetsResult> {
    return this.fetchJson<KnowledgeDatasetsResult>('/api/knowledge');
  }

  /** GET /api/knowledge/{ds}/entries — 条目检索(404=数据集未承载/不存在,抛错) */
  async listKnowledgeEntries(
    datasetId: string,
    filter?: KnowledgeEntryFilter
  ): Promise<KnowledgeEntryRecord[]> {
    const qs = new URLSearchParams();
    if (filter?.q) qs.set('q', filter.q);
    if (filter?.domain) qs.set('domain', filter.domain);
    if (filter?.tags) qs.set('tags', filter.tags);
    const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
    const j = await this.fetchJson<{ entries: KnowledgeEntryRecord[] }>(
      `/api/knowledge/${encodeURIComponent(datasetId)}/entries${suffix}`
    );
    return Array.isArray(j.entries) ? j.entries : [];
  }

  /** GET /api/knowledge/{ds}/entries/{id} — 单条直取(payload 零转译原样) */
  async getKnowledgeEntry(
    datasetId: string,
    entryId: string
  ): Promise<KnowledgeEntryRecord> {
    return this.fetchJson<KnowledgeEntryRecord>(
      `/api/knowledge/${encodeURIComponent(datasetId)}/entries/${encodeURIComponent(entryId)}`
    );
  }
}
