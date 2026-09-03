// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P10 MockBackend — 浏览器内模拟执行后端(零网络依赖)。
// P10_TASKFLOW_DEMO_DESIGN.md §3.4 定义。
//
// 设计:
//   - 实现 ExecutionBackend 接口的 15 方法
//   - 所有方法返回预填数据(医疗/财务/agent 三套)
//   - SSE 用 setTimeout 模拟(每 2s 推一条 Fact)
//   - 不调用真实 HTTP(零网络依赖)
//   - 用于 GitHub Pages 在线 demo + 本地 demo 模式
//
// 数据切换:根据 demoDatasetStore(medical/finance/agent)返回对应数据集。
// session 管理:固定 4 个基础 session(1-4)+ agent 杀手场景 session(5)。
//
// P2-mock(2026-08-25):新增 agent 数据集(零依赖杀手演示,对应 evorule-agent-demo)。

import type {
	ExecutionBackend,
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
} from "$lib/kernel";
import { get } from "svelte/store";
import { demoDatasetStore, type DemoDataset } from "$lib/stores/demo-dataset";
import {
	MEDICAL_FACTS,
	MEDICAL_AUDIT,
	MEDICAL_VERIFY,
	MEDICAL_CAUSAL_CHAIN,
	MEDICAL_SESSION_STATE,
	MEDICAL_HISTORICAL_STATE,
	MEDICAL_DIFF,
	MEDICAL_FACT_RECORDS,
	MEDICAL_COMPLIANCE_FACTS,
} from "$lib/data/demo-medical";
import {
	FINANCE_FACTS,
	FINANCE_AUDIT,
	FINANCE_VERIFY,
	FINANCE_CAUSAL_CHAIN,
	FINANCE_SESSION_STATE,
	FINANCE_HISTORICAL_STATE,
	FINANCE_DIFF,
	FINANCE_FACT_RECORDS,
	FINANCE_COMPLIANCE_FACTS,
} from "$lib/data/demo-finance";
import {
	AGENT_FACTS,
	AGENT_AUDIT,
	AGENT_VERIFY,
	AGENT_CAUSAL_CHAIN,
	AGENT_SESSION_STATE,
	AGENT_HISTORICAL_STATE,
	AGENT_DIFF,
	AGENT_FACT_RECORDS,
	AGENT_COMPLIANCE_FACTS,
} from "$lib/data/demo-killer-agent";
import type { ProductionState, PublishQueueItemView, PublishWriteResult, VersionHistoryEntry } from "./production-views";

/** MockBackend 专属 session 元数据(区分医疗/财务/agent/合规门禁) */
interface MockSession {
	id: SessionId;
	dataset: DemoDataset;
	isCompliance: boolean;
	createdAt: string;
}

/**
 * MockBackend — 浏览器内执行后端,零网络依赖。
 *
 * 用法(在线 demo / force-demo 模式 / ?mock=1):
 *   const backend = new MockBackend();
 *   provideBackend(backend);
 *
 * session 约定:
 *   - session 1:医疗主场景(6 条 Fact 因果链)
 *   - session 2:财务主场景(6 条 Fact 因果链)
 *   - session 3:医疗合规门禁(2 条 Fact)
 *   - session 4:财务合规门禁(2 条 Fact)
 *   - session 5:agent 杀手场景(代码审查 agent 误放行 → 回退/修复/护栏)
 *   - forkSession 创建的新 session 继承父 session 的数据集
 */
export class MockBackend implements ExecutionBackend {
	private sessions: Map<SessionId, MockSession> = new Map();
	private nextSessionId: SessionId = 6; // 1-5 预填,6+ 动态创建
	/** UV-062 W2:auto_verify 开关内存态(session → enabled;默认 false,对齐 server clap 默认) */
	private autoVerifyBySession: Map<SessionId, boolean> = new Map();

	constructor() {
		// 预填 5 个 session
		const now = new Date().toISOString();
		this.sessions.set(1, {
			id: 1,
			dataset: "medical",
			isCompliance: false,
			createdAt: now,
		});
		this.sessions.set(2, {
			id: 2,
			dataset: "finance",
			isCompliance: false,
			createdAt: now,
		});
		this.sessions.set(3, {
			id: 3,
			dataset: "medical",
			isCompliance: true,
			createdAt: now,
		});
		this.sessions.set(4, {
			id: 4,
			dataset: "finance",
			isCompliance: true,
			createdAt: now,
		});
		this.sessions.set(5, {
			id: 5,
			dataset: "agent",
			isCompliance: false,
			createdAt: now,
		});
	}

	// === 内部工具 ===

	/** 根据当前 demoDatasetStore 选择数据集 */
	private currentDataset(): DemoDataset {
		return get(demoDatasetStore);
	}

	/** 按数据集解析主场景 Facts */
	private factsForDataset(dataset: DemoDataset, isCompliance: boolean): Fact[] {
		if (isCompliance) {
			if (dataset === "medical") return MEDICAL_COMPLIANCE_FACTS;
			if (dataset === "finance") return FINANCE_COMPLIANCE_FACTS;
			return AGENT_COMPLIANCE_FACTS;
		}
		if (dataset === "medical") return MEDICAL_FACTS;
		if (dataset === "finance") return FINANCE_FACTS;
		return AGENT_FACTS;
	}

	/** 根据 session id 获取对应数据集的 Facts */
	private getFactsForSession(id: SessionId): Fact[] {
		const session = this.sessions.get(id);
		if (!session) return [];
		return this.factsForDataset(session.dataset, session.isCompliance);
	}

	/** 根据 session id 获取审计链 */
	private getAuditForSession(id: SessionId): SessionAudit {
		const session = this.sessions.get(id);
		if (!session) {
			return { entries: [], fact_count: 0, verified: false };
		}
		if (session.dataset === "medical") return MEDICAL_AUDIT;
		if (session.dataset === "finance") return FINANCE_AUDIT;
		return AGENT_AUDIT;
	}

	/** 按数据集解析 SessionState */
	private sessionStateForDataset(dataset: DemoDataset): SessionState {
		if (dataset === "medical") return MEDICAL_SESSION_STATE;
		if (dataset === "finance") return FINANCE_SESSION_STATE;
		return AGENT_SESSION_STATE;
	}

	/** 按数据集解析 HistoricalState(rewind 目标快照) */
	private historicalStateForDataset(dataset: DemoDataset): HistoricalState {
		if (dataset === "medical") return MEDICAL_HISTORICAL_STATE;
		if (dataset === "finance") return FINANCE_HISTORICAL_STATE;
		return AGENT_HISTORICAL_STATE;
	}

	/** 按数据集解析 FactRecord 索引 */
	private factRecordsForDataset(dataset: DemoDataset): FactRecord[] {
		if (dataset === "medical") return MEDICAL_FACT_RECORDS;
		if (dataset === "finance") return FINANCE_FACT_RECORDS;
		return AGENT_FACT_RECORDS;
	}

	/** 按数据集解析 VerifyResult */
	private verifyForDataset(dataset: DemoDataset): VerifyResult {
		if (dataset === "medical") return MEDICAL_VERIFY;
		if (dataset === "finance") return FINANCE_VERIFY;
		return AGENT_VERIFY;
	}

	/** 按数据集解析 CausalChain */
	private causalChainForDataset(dataset: DemoDataset): CausalChain {
		if (dataset === "medical") return MEDICAL_CAUSAL_CHAIN;
		if (dataset === "finance") return FINANCE_CAUSAL_CHAIN;
		return AGENT_CAUSAL_CHAIN;
	}

	/** 按数据集解析 DiffResult */
	private diffForDataset(dataset: DemoDataset): DiffResult {
		if (dataset === "medical") return MEDICAL_DIFF;
		if (dataset === "finance") return FINANCE_DIFF;
		return AGENT_DIFF;
	}

	/**
	 * UV-062 W2:取 session 对应数据集的 SessionState。
	 * 不存在 → 抛错(与 server 404 对齐;mock 读路径不静默返回空)。
	 */
	private requireState(id: SessionId): SessionState {
		const session = this.sessions.get(id);
		if (!session) {
			throw new Error(`MockBackend: session ${id} 不存在`);
		}
		return this.sessionStateForDataset(session.dataset);
	}

	// === ExecutionBackend 15 方法 ===

	async health(): Promise<boolean> {
		// MockBackend 永远在线(浏览器内,无网络)
		return true;
	}

	async createSession(): Promise<SessionId> {
		const id = this.nextSessionId++;
		const dataset = this.currentDataset();
		this.sessions.set(id, {
			id,
			dataset,
			isCompliance: false,
			createdAt: new Date().toISOString(),
		});
		return id;
	}

	async listSessions(): Promise<SessionId[]> {
		return Array.from(this.sessions.keys()).sort((a, b) => a - b);
	}

	async closeSession(id: SessionId): Promise<void> {
		this.sessions.delete(id);
	}

	async getSessionState(id: SessionId): Promise<SessionState> {
		const session = this.sessions.get(id);
		if (!session) {
			throw new Error(`MockBackend: session ${id} 不存在`);
		}
		return this.sessionStateForDataset(session.dataset);
	}

	async submitCommand(
		_id: SessionId,
		_instruction: object,
	): Promise<CommandResult> {
		// demo 模式只读:命令被接受但不产生新 Fact(保护预填数据)
		return { accepted: true, version: 6 };
	}

	async getHistory(id: SessionId): Promise<unknown> {
		const facts = this.getFactsForSession(id);
		return {
			session_id: id,
			fact_count: facts.length,
			facts,
		};
	}

	async getReplay(
		id: SessionId,
		from?: number,
		to?: number | null,
	): Promise<Fact[]> {
		let facts = this.getFactsForSession(id);
		if (from !== undefined) {
			facts = facts.filter((f) => Number(f.logical_time ?? 0) >= from);
		}
		if (to !== null && to !== undefined) {
			facts = facts.filter((f) => Number(f.logical_time ?? 0) <= to);
		}
		return facts;
	}

	async getFacts(id: SessionId, prefix?: string): Promise<FactRecord[]> {
		const session = this.sessions.get(id);
		if (!session) return [];
		let records = this.factRecordsForDataset(session.dataset);
		if (prefix) {
			records = records.filter((r) => r.path.startsWith(prefix));
		}
		return records;
	}

	async getAudit(id: SessionId): Promise<SessionAudit> {
		return this.getAuditForSession(id);
	}

	async verifyAudit(id: SessionId): Promise<VerifyResult> {
		const session = this.sessions.get(id);
		if (!session) {
			return { verified: false, detail: "session 不存在" };
		}
		return this.verifyForDataset(session.dataset);
	}

	async getCausalChain(
		id: SessionId,
		_factId: number,
	): Promise<CausalChain> {
		const session = this.sessions.get(id);
		if (!session) return { chain: [] };
		const chain = this.causalChainForDataset(session.dataset);
		// 简化:返回完整链(真实环境按 factId 过滤)
		return chain;
	}

	async getStateAtVersion(
		id: SessionId,
		_version: number,
	): Promise<HistoricalState> {
		const session = this.sessions.get(id);
		if (!session) {
			throw new Error(`MockBackend: session ${id} 不存在`);
		}
		return this.historicalStateForDataset(session.dataset);
	}

	async getDiff(
		id: SessionId,
		_a: number,
		_b: number,
	): Promise<DiffResult> {
		const session = this.sessions.get(id);
		if (!session) return { items: [], removed: [] };
		return this.diffForDataset(session.dataset);
	}

	async forkSession(
		parentId: SessionId,
		_version: number,
	): Promise<SessionId> {
		const parent = this.sessions.get(parentId);
		const id = this.nextSessionId++;
		this.sessions.set(id, {
			id,
			dataset: parent?.dataset ?? this.currentDataset(),
			isCompliance: parent?.isCompliance ?? false,
			createdAt: new Date().toISOString(),
		});
		return id;
	}

	// === 停止 / 中止(UV-062;mock 与 submitCommand 同语义:接受请求,校验 session 存在) ===

	async interruptSession(id: SessionId): Promise<InterruptResult> {
		if (!this.sessions.has(id)) {
			throw new Error(`MockBackend: session ${id} 不存在`);
		}
		return {
			session_id: id,
			success: true,
			message: "Interrupt requested, reactor will respond at next checkpoint",
		};
	}

	async abortSession(id: SessionId): Promise<InterruptResult> {
		if (!this.sessions.has(id)) {
			throw new Error(`MockBackend: session ${id} 不存在`);
		}
		return { session_id: id, success: true, message: "Session aborted" };
	}

	// === UV-062 W2:审计导出 / 自动验证 / 调试只读 / 因果深度 ===

	/** 审计链 JSON 导出(mock:预填审计链组装导出对象,含完整 entries) */
	async exportAudit(id: SessionId): Promise<unknown> {
		const session = this.sessions.get(id);
		if (!session) {
			throw new Error(`MockBackend: session ${id} 不存在`);
		}
		const audit = this.getAuditForSession(id);
		return {
			session_id: id,
			fact_count: audit.fact_count,
			verified: audit.verified,
			last_hash: audit.last_hash ?? null,
			entries: audit.entries,
		};
	}

	/**
	 * 压缩审计链导出(mock:CompressionStream 现场 gzip,与 server
	 * application/gzip 行为一致);环境不支持 CompressionStream 时显式抛错,
	 * 不静默降级为空文件。
	 */
	async exportAuditCompressed(id: SessionId): Promise<Blob> {
		const data = await this.exportAudit(id);
		if (typeof CompressionStream === "undefined") {
			throw new Error(
				"MockBackend: 当前环境无 CompressionStream,压缩导出未实现(请用 JSON 导出)",
			);
		}
		const stream = new Blob([JSON.stringify(data)]).stream().pipeThrough(
			new CompressionStream("gzip"),
		);
		return await new Response(stream).blob();
	}

	/** 查询实时验证开关(mock:内存态,默认 false) */
	async getAutoVerify(id: SessionId): Promise<AutoVerifyStatus> {
		if (!this.sessions.has(id)) {
			throw new Error(`MockBackend: session ${id} 不存在`);
		}
		return {
			session_id: id,
			auto_verify: this.autoVerifyBySession.get(id) ?? false,
		};
	}

	/**
	 * 设置实时验证开关(mock:写内存并回显)。
	 * interval 语义与核心一致:0 归一为 1(每次验证);threshold 原样回显(0 = 不限制)。
	 */
	async setAutoVerify(
		id: SessionId,
		enabled: boolean,
		threshold?: number,
		interval?: number,
	): Promise<AutoVerifyConfigResult> {
		if (!this.sessions.has(id)) {
			throw new Error(`MockBackend: session ${id} 不存在`);
		}
		this.autoVerifyBySession.set(id, enabled);
		return {
			session_id: id,
			success: true,
			auto_verify: enabled,
			threshold: threshold ?? 0,
			interval: interval === undefined ? 1 : Math.max(1, interval),
			message: `Auto-verify ${enabled ? "enabled" : "disabled"}`,
		};
	}

	/** 当前执行步数(mock:数据集 SessionState.reactor.current_step) */
	async getStep(id: SessionId): Promise<StepInfo> {
		return {
			session_id: id,
			current_step: this.requireState(id).reactor.current_step,
		};
	}

	/** 反应器完整状态快照(mock:由数据集 SessionState 映射,恒成功无 error) */
	async getSessionSnapshot(id: SessionId): Promise<SessionSnapshot> {
		const s = this.requireState(id);
		return {
			session_id: id,
			finished: false,
			phase: s.reactor.phase,
			version: s.version,
			steps: s.reactor.current_step,
			pending_io_count: s.reactor.pending_io_count,
			structural_invariant_violations:
				s.reactor.structural_invariant_violations,
		};
	}

	/** 调试:当前执行阶段(mock:数据集 reactor.phase,demo 场景恒 stable) */
	async getDebugPhase(id: SessionId): Promise<DebugPhaseInfo> {
		return { session_id: id, phase: this.requireState(id).reactor.phase };
	}

	/** 调试:待执行队列(mock:与 server 同语义,恒为空数组) */
	async getDebugQueue(id: SessionId): Promise<DebugQueueInfo> {
		this.requireState(id); // 校验 session 存在(404 语义)
		return { session_id: id, queue: [] };
	}

	/** 调试:悬挂 I/O(mock:计数取 reactor.pending_io_count,列表恒空) */
	async getDebugPendingIo(id: SessionId): Promise<DebugPendingIoInfo> {
		const s = this.requireState(id);
		return {
			session_id: id,
			pending_io_count: s.reactor.pending_io_count,
			pending_io: [],
		};
	}

	/** 悬挂 I/O 计数(mock:reactor.pending_io_count) */
	async getPendingIoCount(id: SessionId): Promise<PendingIoCountInfo> {
		return {
			session_id: id,
			pending_io_count: this.requireState(id).reactor.pending_io_count,
		};
	}

	/** 因果链深度(mock:reactor.causal_depth) */
	async getCausalDepth(id: SessionId): Promise<CausalDepthInfo> {
		return {
			session_id: id,
			causal_depth: this.requireState(id).reactor.causal_depth,
		};
	}

	// === Cloud 专属方法(与 CloudHttpBackend 同名,视图层 instanceof 判断) ===

	/**
	 * 拉取生产运行状态(mock)。
	 * demo 模式返回 running 状态,版本 6(对应 6 条 Fact)。
	 */
	async getProductionState(): Promise<ProductionState> {
		const dataset = this.currentDataset();
		const currentSessionId = dataset === "medical" ? 1 : dataset === "finance" ? 2 : 5;
		const rulesetHash =
			dataset === "medical"
				? "f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1"
				: dataset === "finance"
					? "6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a"
					: "k6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7";
		return {
			currentSessionId,
			rulesetVersion: 6,
			rulesetHash,
			status: "running",
			updatedAt: new Date().toISOString(),
		};
	}

	// === F3 发布队列/版本历史 mock(离线模式默认值,与 CloudHttpBackend 同名) ===

	/** 拉取发布队列(mock:空队列,由 localStorage store 提供演示数据)。 */
	async getPublishQueue(): Promise<PublishQueueItemView[]> {
		return [];
	}

	/** 审批发布(mock:本地 store 处理,此处仅确认签名;身份来自 backend actor)。 */
	async reviewPublishRequest(
		_queueId: number,
		_decision: "approved" | "rejected",
		_comment: string,
	): Promise<PublishWriteResult> {
		return { ok: true };
	}

	/** 紧急回滚(mock:本地 store 处理)。 */
	async emergencyRollbackRequest(_targetVersion: number, _reason: string): Promise<PublishWriteResult> {
		return { ok: true };
	}

	/** 拉取版本历史(mock:空,由 localStorage store 提供演示数据)。 */
	async getProductionAudit(): Promise<VersionHistoryEntry[]> {
		return [];
	}
}
