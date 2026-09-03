// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console 执行后端 — 数据契约 + ExecutionBackend 抽象接口
//
// 依据: docs/SPEC.md §1
// 设计原则: evorule-console 只依赖此抽象接口,不绑定 HTTP / Tauri / WASM。
//   - 大众版提供 HttpBackend 实现(本目录 http-backend.ts)
//   - 高级版提供 EmbeddedBackend 实现(Tauri + Rust link evorule crate)
//
// 端点对齐来源:
//   - time-travel-debugger/src/core/api.js (v1.0,49/51 PASS)
//   - evorule-server 自带 INTEGRATION_GUIDE.md(权威 API 规范,2026-08-03 起对齐)
//   (旧 src/lib/api/evorule-server.js 只读 client 已于阶段 C.1 删除)

// ============================================================================
// 1. 数据契约(SPEC §1.1)
// ============================================================================

/** Session 标识(evorule-server 用自增整数) */
export type SessionId = number;

/**
 * reactor 运行态。
 * 字段对齐 evorule-server.js 的 ReactorState;phase 对齐 evorule-reactor 核心库 ReactorPhase。
 *
 * C5 修复(2026-08-03):phase 补全 6 值(核心库 ReactorPhase::as_str()):
 *   - idle:           无任务(启动或上一轮 Stable 后等待第一个 Fact)
 *   - draining:       非阻塞 drain command 通道中所有待处理 Fact
 *   - executing:      持续执行队列指令(pending_io == 0)
 *   - awaiting_io:    阻塞在 IO 等待(pending_io > 0)
 *   - stable:         稳态(级联收敛)
 *   - error:          异常
 */
export interface ReactorState {
  phase: 'idle' | 'draining' | 'executing' | 'awaiting_io' | 'stable' | 'error';
  causal_depth: number;
  current_step: number;
  pending_io_count: number;
  structural_invariant_violations: number;
}

/** session 实时快照(含 reactor 运行态,GET /state 返回) */
export interface SessionState {
  payload: object;
  queue: unknown[];
  reactor: ReactorState;
  version: number;
}

/**
 * 历史快照(rewind / getStateAtVersion 返回)。
 * C6/D2-A 修复(2026-08-03):rewind 是历史快照,语义上无当时的 reactor 运行态,
 *   evorule-server 不返回 reactor 是诚实的(不编造历史运行态)。
 *   故 getStateAtVersion 不再返回 SessionState,改返回 HistoricalState(无 reactor)。
 *   version 对齐 server rewind 的 actual_version(实际回溯版本)。
 */
export interface HistoricalState {
  payload: object;
  queue: unknown[];
  version: number;
}

/**
 * 审计链。
 * 字段对齐 ttd api.js 修复 3: fact_count + verified;对齐 INTEGRATION_GUIDE §3.1。
 * (旧 console 用的是 last_audited_version,已废弃,以本契约为准)
 */
export interface SessionAudit {
  entries: unknown[];
  fact_count: number;
  verified: boolean;
  last_hash?: string;
}

/** verifyAudit 返回值(对齐 ttd api.js 修复 4: verified,不是 valid) */
export interface VerifyResult {
  verified: boolean;
  detail?: string;
}

/**
 * fact log 一条(replay / history 端点返回的完整 fact)。
 * 对齐 evorule-server Fact::to_json:字段为 type / id,其余字段按 type 不同而异,故用 index signature。
 */
export interface Fact {
  type: string;
  id: number;
  [key: string]: unknown;
}

/**
 * 审计条目(audit / causal 端点返回的审计摘要,对齐 INTEGRATION_GUIDE §3.3)。
 * C3 修复(2026-08-03):causal chain 的 entry 不是完整 Fact,字段为 fact_id / fact_type,
 *   语义不同,故独立定义类型,不混用 Fact。
 */
export interface CausalEntry {
  fact_id: number;
  fact_type: string;
  logical_time: number;
  cause?: number | null;
  content_hash?: string;
  prev_hash?: string;
  [key: string]: unknown;
}

/**
 * facts 端点返回的 payload 更新索引(对齐 server session_facts_by_prefix)。
 * C4 修复(2026-08-03):facts 端点返回的是按 path prefix 的 PayloadUpdate 索引,
 *   字段为 fact_id / version / path / value,不是完整 Fact,故独立定义。
 */
export interface FactRecord {
  fact_id: number;
  version: number;
  path: string;
  value: unknown;
}

/**
 * diff 结果。
 * 对齐 ttd api.js 修复 2: items 是数组格式
 *   - 变更: [key, value]      (added, 2 元组)
 *   - 改动: [key, old, new]   (changed, 3 元组)
 * 不是 {key, value} 对象。
 * D1-B 修复(2026-08-03):契约扩展 removed 字段(items 契约只承载 added/changed 语义,
 *   removed 单独返回 [[key, value], ...])。
 */
export interface DiffResult {
  items: Array<[string, unknown] | [string, unknown, unknown]>;
  removed?: Array<[string, unknown]>;
}

/** 因果链(C3:CausalEntry[],不是 Fact[]) */
export interface CausalChain {
  chain: CausalEntry[];
}

/** submitCommand 返回值 */
export interface CommandResult {
  accepted: boolean;
  version?: number;
  error?: string;
}

/**
 * interruptSession / abortSession 返回值(UV-062)。
 * 对齐 evorule-server InterruptResponse:POST interrupt/abort 均返回
 *   { session_id, success, message }。
 */
export interface InterruptResult {
  session_id: SessionId;
  success: boolean;
  message: string;
}

// ============================================================================
// 1.W Wave 2 数据契约(UV-062 W2,对齐 evorule-server 审计导出/自动验证/调试端点)
// ============================================================================

/** 审计链自动验证状态(GET /audit/auto_verify,对齐 server AutoVerifyResponse) */
export interface AutoVerifyStatus {
  session_id: SessionId;
  /** 自动验证是否启用 */
  auto_verify: boolean;
}

/**
 * 审计链自动验证配置结果(POST /audit/auto_verify,
 * 对齐 server AutoVerifyConfigureResponse)。
 */
export interface AutoVerifyConfigResult {
  session_id: SessionId;
  success: boolean;
  auto_verify: boolean;
  /** 验证阈值(0 = 不限制) */
  threshold: number;
  /** 验证间隔(1 = 每次 audit_new 都验证;核心将 0 归一为 1) */
  interval: number;
  message: string;
}

/** 当前执行步数(GET /step,对齐 server StepResponse) */
export interface StepInfo {
  session_id: SessionId;
  current_step: number;
}

/**
 * 反应器完整状态快照(GET /snapshot,对齐 server SnapshotResponse)。
 * server 在反应器已结束/锁中毒时返回 200 + 仅含 { session_id, error },
 * 此时数据字段缺失(缺失 ≠ 隐式 0),调用方须检查 error 展示失败态。
 */
export interface SessionSnapshot {
  session_id: SessionId;
  finished?: boolean;
  phase?: string;
  /** FactsLog 版本号 */
  version?: number;
  steps?: number;
  pending_io_count?: number;
  structural_invariant_violations?: number;
  /** 快照获取失败原因(成功时无此字段) */
  error?: string;
}

/** 调试:当前执行阶段(GET /debug/phase;null = 反应器未启动) */
export interface DebugPhaseInfo {
  session_id: SessionId;
  phase: string | null;
}

/** 调试:待执行队列(GET /debug/queue;server 当前恒返回空数组) */
export interface DebugQueueInfo {
  session_id: SessionId;
  queue: unknown[];
}

/** 调试:悬挂 I/O(GET /debug/pending_io;server 当前恒返回空列表) */
export interface DebugPendingIoInfo {
  session_id: SessionId;
  pending_io_count: number;
  pending_io: unknown[];
}

/** 悬挂 I/O 计数(GET /pending_io_count,对齐 server PendingIoCountResponse) */
export interface PendingIoCountInfo {
  session_id: SessionId;
  pending_io_count: number;
}

/** 因果链深度(GET /causal_depth,对齐 server CausalDepthResponse) */
export interface CausalDepthInfo {
  session_id: SessionId;
  causal_depth: number;
}

// ============================================================================
// 2. ExecutionBackend 抽象接口(SPEC §1.2,28 方法)
// ============================================================================

/**
 * evorule-console 的执行后端抽象接口。
 *
 * evorule-console 的所有视图只依赖此接口,不绑定具体实现。
 * - 大众版: HttpBackend (调 evorule-server HTTP)
 * - 高级版: EmbeddedBackend (Tauri + Rust 直接 link evorule crate,不联网)
 *
 * 28 方法分组:
 *   - 会话管理(5):health / createSession / listSessions / closeSession / getSessionState
 *   - 命令执行(1):submitCommand
 *   - 历史 / 回放(3):getHistory / getReplay / getFacts
 *   - 审计(3):getAudit / verifyAudit / getCausalChain
 *   - 审计导出 / 自动验证(4,UV-062 W2):exportAudit / exportAuditCompressed /
 *     getAutoVerify / setAutoVerify
 *   - 时间旅行(2):getStateAtVersion / getDiff
 *   - What-If(1):forkSession
 *   - 停止 / 中止(2,UV-062):interruptSession / abortSession(abort 条件挂载,见方法注释)
 *   - 调试只读(6,UV-062 W2):getStep / getSessionSnapshot / getDebugPhase /
 *     getDebugQueue / getDebugPendingIo / getPendingIoCount
 *   - 因果深度(1,UV-062 W2):getCausalDepth
 */
export interface ExecutionBackend {
  // === 会话管理 ===
  health(): Promise<boolean>;
  createSession(): Promise<SessionId>;
  listSessions(): Promise<SessionId[]>;
  closeSession(id: SessionId): Promise<void>;
  getSessionState(id: SessionId): Promise<SessionState>;

  // === 命令执行(展现"确定性执行") ===
  submitCommand(id: SessionId, instruction: object): Promise<CommandResult>;

  // === 历史 / 回放(展现"可回放") ===
  getHistory(id: SessionId): Promise<unknown>;
  getReplay(id: SessionId, from?: number, to?: number | null): Promise<Fact[]>;
  getFacts(id: SessionId, prefix?: string): Promise<FactRecord[]>;

  // === 审计(展现"可审计") ===
  getAudit(id: SessionId): Promise<SessionAudit>;
  verifyAudit(id: SessionId): Promise<VerifyResult>;
  getCausalChain(id: SessionId, factId: number): Promise<CausalChain>;

  // === 审计导出 / 自动验证(UV-062 W2) ===
  /**
   * GET /api/sessions/{id}/audit/export — 导出完整审计链 JSON
   * (含完整哈希链,用于跨实例迁移 / 离线分析 / 备份)。
   * server 返回 JSON Value,形状由 audit_export 决定,故以 unknown 透传,
   * 由视图层序列化下载。
   */
  exportAudit(id: SessionId): Promise<unknown>;
  /**
   * GET /api/sessions/{id}/audit/export/compressed — 导出 gzip 压缩审计链。
   * server 返回 application/gzip 二进制(体积约为 JSON 的 5-10%,
   * Content-Disposition 文件名 audit_chain.json.gz),以 Blob 返回,
   * Blob.type 携带实际 content-type;实现必须带 Bearer 请求。
   */
  exportAuditCompressed(id: SessionId): Promise<Blob>;
  /**
   * GET /api/sessions/{id}/audit/auto_verify — 查询审计链实时验证开关状态。
   */
  getAutoVerify(id: SessionId): Promise<AutoVerifyStatus>;
  /**
   * POST /api/sessions/{id}/audit/auto_verify — 设置审计链实时验证开关。
   * threshold / interval 可选:缺省不传(server serde default → threshold=0
   * 不限制,interval=0 被核心归一为 1 即每次验证)。
   * 返回配置结果;success=false 或抛错时调用方必须显式提示(不静默)。
   */
  setAutoVerify(
    id: SessionId,
    enabled: boolean,
    threshold?: number,
    interval?: number
  ): Promise<AutoVerifyConfigResult>;

  // === 时间旅行(展现"可回放"的回溯能力) ===
  getStateAtVersion(id: SessionId, version: number): Promise<HistoricalState>;
  getDiff(id: SessionId, a: number, b: number): Promise<DiffResult>;

  // === What-If 假设分析 ===
  forkSession(parentId: SessionId, version: number): Promise<SessionId>;

  // === 会话停止 / 中止(UV-062) ===
  /**
   * POST /api/sessions/{id}/interrupt — 温和中断。
   * 下一检查点生效,无条件可用;会话不存在 → 404。
   */
  interruptSession(id: SessionId): Promise<InterruptResult>;
  /**
   * POST /api/sessions/{id}/abort — 强制中止反应器任务(破坏性,不等待 checkpoint)。
   * 条件挂载:server 未以 --allow-abort(或 EVORULE_ALLOW_ABORT=1)启动时
   *   端点未挂载 → 404,调用方必须显式提示启用方法(拒绝静默)。
   */
  abortSession(id: SessionId): Promise<InterruptResult>;

  // === 调试只读查询(UV-062 W2,六路独立,一路失败不拖垮其他路) ===
  /** GET /api/sessions/{id}/step — 当前执行步数 */
  getStep(id: SessionId): Promise<StepInfo>;
  /**
   * GET /api/sessions/{id}/snapshot — 反应器完整状态快照。
   * server 在反应器结束/锁中毒时返回 200 + 仅 { session_id, error },
   * 调用方须检查 snapshot.error 展示失败态(不静默)。
   */
  getSessionSnapshot(id: SessionId): Promise<SessionSnapshot>;
  /** GET /api/sessions/{id}/debug/phase — 当前执行阶段(null = 未启动) */
  getDebugPhase(id: SessionId): Promise<DebugPhaseInfo>;
  /** GET /api/sessions/{id}/debug/queue — 待执行队列(server 当前恒为空) */
  getDebugQueue(id: SessionId): Promise<DebugQueueInfo>;
  /** GET /api/sessions/{id}/debug/pending_io — 悬挂 I/O 计数与列表 */
  getDebugPendingIo(id: SessionId): Promise<DebugPendingIoInfo>;
  /** GET /api/sessions/{id}/pending_io_count — 悬挂 I/O 计数 */
  getPendingIoCount(id: SessionId): Promise<PendingIoCountInfo>;

  // === 因果深度(UV-062 W2) ===
  /** GET /api/sessions/{id}/causal_depth — 因果链深度 */
  getCausalDepth(id: SessionId): Promise<CausalDepthInfo>;
}
