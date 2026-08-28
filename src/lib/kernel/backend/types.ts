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

// ============================================================================
// 2. ExecutionBackend 抽象接口(SPEC §1.2,15 方法)
// ============================================================================

/**
 * evorule-console 的执行后端抽象接口。
 *
 * evorule-console 的所有视图只依赖此接口,不绑定具体实现。
 * - 大众版: HttpBackend (调 evorule-server HTTP)
 * - 高级版: EmbeddedBackend (Tauri + Rust 直接 link evorule crate,不联网)
 *
 * 15 方法分组:
 *   - 会话管理(5):health / createSession / listSessions / closeSession / getSessionState
 *   - 命令执行(1):submitCommand
 *   - 历史 / 回放(3):getHistory / getReplay / getFacts
 *   - 审计(3):getAudit / verifyAudit / getCausalChain
 *   - 时间旅行(2):getStateAtVersion / getDiff
 *   - What-If(1):forkSession
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

  // === 时间旅行(展现"可回放"的回溯能力) ===
  getStateAtVersion(id: SessionId, version: number): Promise<HistoricalState>;
  getDiff(id: SessionId, a: number, b: number): Promise<DiffResult>;

  // === What-If 假设分析 ===
  forkSession(parentId: SessionId, version: number): Promise<SessionId>;
}
