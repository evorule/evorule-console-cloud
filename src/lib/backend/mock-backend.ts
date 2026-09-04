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

	/**
	 * UV-084 W1:共享事实演示数据(跨会话广播形态示例:
	 * 平台事件类 + 租户配额类,source_session_id 指向预填 session)。
	 */
	private static readonly SHARED_FACTS_DEMO: readonly SharedFactEntry[] = [
		{
			fact_id: 9101,
			path: "shared.platform.last_login.username",
			value: "demo-user",
			source_session_id: 1,
			version: 3,
		},
		{
			fact_id: 9102,
			path: "shared.platform.last_login.ts_ms",
			value: 1759971200000,
			source_session_id: 1,
			version: 3,
		},
		{
			fact_id: 9103,
			path: "shared.tenant.quota.remaining",
			value: 42,
			source_session_id: 2,
			version: 6,
		},
	];

	/** 共享事实日志版本(mock;任意单调值,演示形状用) */
	private static readonly SHARED_FACTS_VERSION = 9;

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

	/**
	 * UV-084 W1:校验 session 存在,返回其元数据。
	 * 不存在 → 抛错(与 server 404 对齐)。
	 */
	private requireSession(id: SessionId): MockSession {
		const session = this.sessions.get(id);
		if (!session) {
			throw new Error(`MockBackend: session ${id} 不存在`);
		}
		return session;
	}

	// === ExecutionBackend 15 方法 ===

	async health(_signal?: AbortSignal): Promise<boolean> {
		// MockBackend 永远在线(浏览器内,无网络;signal 形参仅为契约对齐)
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

	// === UV-084 W1:A 组 5 项(mock;对齐 server 端点形状,demo 只读语义) ===

	/**
	 * 导入审计链(mock)。demo 只读:不真正覆盖预填数据(保护演示场景),
	 * 校验 session 存在后返回导入成功形状(status="ok")。
	 */
	async importAudit(id: SessionId, _data: unknown): Promise<AuditImportResult> {
		this.requireSession(id);
		return {
			session_id: id,
			imported: true,
			verify_ok: true,
			status: "ok",
		};
	}

	/**
	 * 导入 gzip 压缩审计链(mock)。同 importAudit 语义,demo 不解压不覆盖。
	 */
	async importAuditCompressed(
		id: SessionId,
		_blob: Blob,
	): Promise<AuditImportResult> {
		this.requireSession(id);
		return {
			session_id: id,
			imported: true,
			verify_ok: true,
			status: "ok",
		};
	}

	/**
	 * 从父会话派生新会话(mock)。继承父 session 的数据集(与 forkSession 同
	 * 语义),不校验 version(demo 预填数据无版本分支)。
	 */
	async createSessionFrom(
		parentId: SessionId,
		_version?: number,
	): Promise<SessionId> {
		const parent = this.requireSession(parentId);
		const id = this.nextSessionId++;
		this.sessions.set(id, {
			id,
			dataset: parent.dataset,
			isCompliance: parent.isCompliance,
			createdAt: new Date().toISOString(),
		});
		return id;
	}

	/**
	 * 手动回收会话(mock)。demo 预填 session 均为活跃态(reap 语义只回收
	 * 已结束/已过期),如实返回 0 计数,不静默假装回收。
	 */
	async reapSessions(): Promise<ReapResult> {
		return { finished: 0, expired: 0, total: 0 };
	}

	/**
	 * payload 注入(mock)。demo 只读:不修改预填 payload,返回提交成功形状。
	 */
	async updatePayload(
		id: SessionId,
		_path: string,
		_value: unknown,
	): Promise<PayloadUpdateResult> {
		this.requireSession(id);
		return {
			success: true,
			message: "PayloadUpdate submitted (mock)",
			fact_id: null,
		};
	}

	/** 共享事实查询(mock;前缀过滤,缺省全部) */
	async getSharedFacts(prefix?: string): Promise<SharedFactEntry[]> {
		const all = MockBackend.SHARED_FACTS_DEMO;
		return prefix ? all.filter((f) => f.path.startsWith(prefix)) : [...all];
	}

	/** 共享事实日志版本(mock;与 SHARED_FACTS_DEMO 条数一致) */
	async getSharedFactsVersion(): Promise<SharedFactsVersionInfo> {
		return {
			version: MockBackend.SHARED_FACTS_VERSION,
			history_len: MockBackend.SHARED_FACTS_DEMO.length,
		};
	}

	// === UV-084 W3:A-流权限策略族(mock) ===
	//
	// demo 语义:内存可变条目集(种子 3 条演示数据),生命周期状态机与
	// server 同口径(仅 Draft 可 submit、仅 Candidate 可 review、仅 Active
	// 参与判定);evaluate 忠实复刻治理层语义(deny 即胜 → allow →
	// candidate → 默认策略 human=allow / llm=deny / unknown=deny)。
	// demo 数据本就是本地模拟,写操作不触网、刷新即重置。

	/** demo 权限条目种子(展示三类典型形态:通配允许/精确拒绝/候选待审) */
	private static readonly PERMISSIONS_DEMO_SEED: PermissionEntryRecord[] = [
		{
			id: "demo-allow-shared-read",
			version: 2,
			state: "active",
			subject: { subject_type: "any", id: "" },
			resource: { resource_type: "shared", path: "shared.platform.*" },
			action: "*",
			effect: "allow",
			scope: {},
			updated_by: "demo-admin",
		},
		{
			id: "demo-deny-llm-write",
			version: 3,
			state: "active",
			subject: { subject_type: "user", id: "llm" },
			resource: { resource_type: "fact", path: "db.users.*" },
			action: "write",
			effect: "deny",
			scope: {},
			updated_by: "demo-admin",
		},
		{
			id: "demo-candidate-api-export",
			version: 1,
			state: "candidate",
			subject: { subject_type: "role", id: "human" },
			resource: { resource_type: "api", path: "/api/audit/export" },
			action: "*",
			effect: "allow",
			scope: {},
			updated_by: "demo-auditor",
		},
	];

	/** 内存权限条目集(构造时深拷贝种子,写操作本地生效) */
	private permissionEntries: PermissionEntryRecord[] = MockBackend.PERMISSIONS_DEMO_SEED.map(
		(e) => structuredClone(e),
	);
	/** mock 版本号(每次写操作 +1,演示追加版本语义) */
	private permissionVersion = 9;

	/** GET /api/permissions(mock) */
	async listPermissions(): Promise<PermissionListResult> {
		return {
			success: true,
			version: this.permissionVersion,
			count: this.permissionEntries.length,
			entries: this.permissionEntries.map((e) => structuredClone(e)),
		};
	}

	/** GET /api/permissions/{id}(mock;不存在抛 Error,与 server 404 对齐由调用方提示) */
	async getPermission(id: string): Promise<PermissionEntryRecord> {
		const found = this.permissionEntries.find((e) => e.id === id);
		if (!found) {
			throw new Error(`permission entry not found: ${id}`);
		}
		return structuredClone(found);
	}

	/** POST /api/permissions(mock;强制 Draft,幂等冲突检测与 server 409 对齐) */
	async createPermission(entry: PermissionEntryRecord): Promise<PermissionWriteResult> {
		if (!entry.id.trim()) {
			throw new Error("permission id must not be empty");
		}
		if (this.permissionEntries.some((e) => e.id === entry.id)) {
			throw new Error(`duplicate permission id: ${entry.id}`);
		}
		const created: PermissionEntryRecord = {
			...structuredClone(entry),
			state: "draft",
			version: 0,
		};
		this.permissionEntries.push(created);
		this.permissionVersion += 1;
		return { success: true, id: created.id, state: "draft", version: this.permissionVersion };
	}

	/** PUT /api/permissions/{id}(mock;幂等,已 Active 保持 Active) */
	async updatePermission(
		id: string,
		entry: PermissionEntryRecord,
	): Promise<PermissionWriteResult> {
		if (entry.id !== id) {
			throw new Error("path id and body id mismatch");
		}
		const idx = this.permissionEntries.findIndex((e) => e.id === id);
		const next: PermissionEntryRecord = { ...structuredClone(entry), version: 0 };
		if (idx >= 0) {
			next.state = this.permissionEntries[idx].state;
			this.permissionEntries[idx] = next;
		} else {
			this.permissionEntries.push(next);
		}
		this.permissionVersion += 1;
		return { success: true, id, version: this.permissionVersion };
	}

	/** DELETE /api/permissions/{id}(mock;内存删除,墓碑语义由 server 真实承载) */
	async deletePermission(id: string): Promise<PermissionWriteResult> {
		const idx = this.permissionEntries.findIndex((e) => e.id === id);
		if (idx < 0) {
			throw new Error(`permission entry not found: ${id}`);
		}
		this.permissionEntries.splice(idx, 1);
		this.permissionVersion += 1;
		return { success: true, id };
	}

	/** POST /api/permissions/{id}/submit(mock;仅 Draft 可提交,状态机与 server 对齐) */
	async submitPermission(id: string): Promise<PermissionWriteResult> {
		const entry = this.permissionEntries.find((e) => e.id === id);
		if (!entry) {
			throw new Error(`permission entry not found: ${id}`);
		}
		if (entry.state !== "draft") {
			throw new Error(`only Draft can be submitted, current = ${entry.state}`);
		}
		entry.state = "candidate";
		this.permissionVersion += 1;
		return { success: true, id, state: "candidate", version: this.permissionVersion };
	}

	/** POST /api/permissions/{id}/review(mock;仅 Candidate 可裁决) */
	async reviewPermission(id: string, approve: boolean): Promise<PermissionWriteResult> {
		const entry = this.permissionEntries.find((e) => e.id === id);
		if (!entry) {
			throw new Error(`permission entry not found: ${id}`);
		}
		if (entry.state !== "candidate") {
			throw new Error(`only Candidate can be reviewed, current = ${entry.state}`);
		}
		entry.state = approve ? "active" : "rejected";
		this.permissionVersion += 1;
		return { success: true, id, state: entry.state, version: this.permissionVersion };
	}

	/** GET /api/permissions/version(mock) */
	async getPermissionsVersion(): Promise<PermissionVersionResult> {
		return {
			success: true,
			version: this.permissionVersion,
			count: this.permissionEntries.length,
		};
	}

	/**
	 * POST /api/permissions/evaluate(mock)。
	 * 忠实复刻治理层 PermissionTable::evaluate:遍历条目,
	 * candidate 命中记候选;active 命中 deny 即胜(立即返回)、allow 记允许;
	 * 收尾 allow > candidate > 默认策略(human=allow / llm=deny / unknown=deny)。
	 * 简化边界:conditions 条件求值不模拟(demo 种子无 conditions),如实注释。
	 */
	async evaluatePermission(
		req: PermissionEvaluateRequest,
	): Promise<PermissionEvaluateResult> {
		const role = req.caller_role ?? "unknown";
		const action = req.action ?? "*";
		let sawCandidate = false;
		let sawAllow = false;
		for (const e of this.permissionEntries) {
			const subjectMatch =
				e.subject.subject_type === "any" || e.subject.id === role;
			const actionMatch = e.action === "*" || e.action === action;
			const pattern = e.resource.path;
			const resourceMatch =
				pattern !== "" &&
				(pattern.endsWith("*")
					? req.resource.startsWith(pattern.slice(0, -1))
					: pattern === req.resource);
			if (!subjectMatch || !actionMatch || !resourceMatch) continue;
			if (e.state === "candidate") {
				sawCandidate = true;
				continue;
			}
			if (e.state !== "active") continue;
			if (e.effect === "deny") {
				return this.mockEvaluateResult(req, role, action, "deny");
			}
			sawAllow = true;
		}
		if (sawAllow) {
			return this.mockEvaluateResult(req, role, action, "allow");
		}
		if (sawCandidate) {
			return this.mockEvaluateResult(req, role, action, "candidate");
		}
		// 默认策略(fail-closed:llm/unknown 拒绝,人类允许)
		const fallback = role === "human" ? "allow" : "deny";
		return this.mockEvaluateResult(req, role, action, fallback);
	}

	private mockEvaluateResult(
		req: PermissionEvaluateRequest,
		callerRole: string,
		action: string,
		verdict: "allow" | "deny" | "candidate",
	): PermissionEvaluateResult {
		return {
			success: true,
			caller_role: callerRole,
			resource: req.resource,
			action,
			v_trigger: req.v_trigger ?? this.permissionVersion,
			verdict,
		};
	}

	// === UV-084 W5:知识数据面(mock;静态种子,只读数据面无写操作) ===

	/** demo 知识条目种子(2 数据集 4 条目;domain/tags 差异供过滤演示) */
	private static readonly KNOWLEDGE_DEMO: readonly KnowledgeEntryRecord[] = [
		{
			dataset_id: "medical_guidelines",
			entry_id: "triage_level_definition",
			payload: { title: "分诊级别定义", levels: ["一级(濒危)", "二级(危重)", "三级(急症)", "四级(非急症)"], source: "急诊预检分诊专家共识" },
			schema_ref: "https://evorule.dev/schemas/medical/triage-level.json",
			bundle_id: "demo-bundle-medical-001",
			source_version: "2.1.0",
			domain: "medical",
			tags: ["分诊", "急诊"],
		},
		{
			dataset_id: "medical_guidelines",
			entry_id: "djbh_threshold",
			payload: { title: "等级保护阈值", critical_asset_availability: 0.9999, audit_retention_months: 6 },
			schema_ref: "https://evorule.dev/schemas/medical/djbh-threshold.json",
			bundle_id: "demo-bundle-medical-001",
			source_version: "2.1.0",
			domain: "medical",
			tags: ["等保", "合规"],
		},
		{
			dataset_id: "medical_guidelines",
			entry_id: "antibiotic_stewardship",
			payload: { title: "抗菌药物分级管理", classes: ["非限制使用级", "限制使用级", "特殊使用级"] },
			schema_ref: null,
			bundle_id: "demo-bundle-medical-002",
			source_version: "1.4.2",
			domain: "medical",
			tags: ["用药"],
		},
		{
			dataset_id: "finance_limits",
			entry_id: "single_payment_limit",
			payload: { title: "单笔支付限额", retail: 50000, corporate: 5000000, currency: "CNY" },
			schema_ref: "https://evorule.dev/schemas/finance/payment-limit.json",
			bundle_id: "demo-bundle-finance-001",
			source_version: "3.0.1",
			domain: "finance",
			tags: ["支付", "限额"],
		},
	];

	private knowledgeFilter(datasetId: string, filter?: KnowledgeEntryFilter): KnowledgeEntryRecord[] {
		const q = filter?.q?.trim().toLowerCase() ?? "";
		const tags = (filter?.tags ?? "")
			.split(",")
			.map((t) => t.trim())
			.filter((t) => t.length > 0);
		return MockBackend.KNOWLEDGE_DEMO.filter((e) => {
			if (e.dataset_id !== datasetId) return false;
			if (filter?.domain && e.domain !== filter.domain) return false;
			if (tags.length > 0 && !tags.some((t) => e.tags.includes(t))) return false;
			if (q.length > 0) {
				const hay = `${e.entry_id} ${JSON.stringify(e.payload)}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	}

	/** GET /api/knowledge(mock;由种子聚合,只含已承载数据集) */
	async listKnowledgeDatasets(): Promise<KnowledgeDatasetsResult> {
		const datasets = [...new Set(MockBackend.KNOWLEDGE_DEMO.map((e) => e.dataset_id))].map(
			(dataset_id) => {
				const entries = MockBackend.KNOWLEDGE_DEMO.filter((e) => e.dataset_id === dataset_id);
				return {
					dataset_id,
					bundle_ids: [...new Set(entries.map((e) => e.bundle_id))],
					entry_count: entries.length,
					schema_refs: [
						...new Set(entries.map((e) => e.schema_ref).filter((s): s is string => Boolean(s))),
					],
				};
			},
		);
		return { datasets, count: datasets.length };
	}

	/** GET /api/knowledge/{ds}/entries(mock;404 语义:数据集未承载抛错,不静默空) */
	async listKnowledgeEntries(
		datasetId: string,
		filter?: KnowledgeEntryFilter,
	): Promise<KnowledgeEntryRecord[]> {
		if (!MockBackend.KNOWLEDGE_DEMO.some((e) => e.dataset_id === datasetId)) {
			throw new Error(`knowledge dataset not found: ${datasetId}`);
		}
		return this.knowledgeFilter(datasetId, filter);
	}

	/** GET /api/knowledge/{ds}/entries/{id}(mock;不存在抛错) */
	async getKnowledgeEntry(datasetId: string, entryId: string): Promise<KnowledgeEntryRecord> {
		const hit = MockBackend.KNOWLEDGE_DEMO.find(
			(e) => e.dataset_id === datasetId && e.entry_id === entryId,
		);
		if (!hit) {
			throw new Error(`knowledge entry not found: ${datasetId}/${entryId}`);
		}
		return hit;
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
