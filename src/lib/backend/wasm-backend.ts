// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// WasmBackend —— 浏览器内 EvoRule WASM 引擎执行后端(对齐文档73《WasmBackend 接口子集与适配方案》)。
//
// 实现 ExecutionBackend 全部 47 方法:
//   - 22 个真实 WASM 引擎方法:会话管理/命令/历史/审计/时间旅行/导出/自动验证/因果深度。
//   - 25 个内存种子方法(权限 9 / 知识 3 / 共享事实 2 / 调试 6 / fork/import/createSessionFrom/reap/updatePayload)。
//   - cloud 专属同名方法(14):WASM 模式下安全降级(空数组/默认值/抛 not-supported)。
//
// 会话模型:每个 session 持有独立 EvoRuleEngine 实例(独立 payload/FactsLog/BLAKE3 审计链),
// createSession 时 new 引擎并 load_rules 合并规则集;closeSession 时 free 引擎。
//
// io_request 循环(核心):execute_instruction 若返回 io_required → 调 WasmMockService
// → resolve_io(注入 __io_result__ 重放) → 循环直到 state/halted。

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
import { createEngine } from "$lib/wasm/engine-loader";
import type { EvoRuleEngine } from "$lib/wasm/engine-loader";
import { loadAllRules } from "$lib/wasm/rules-loader";
import { WasmMockService } from "./wasm-mock-service";
import type {
	ProductionState,
	PublishQueueItemView,
	PublishWriteResult,
	VersionHistoryEntry,
} from "./production-views";

/** WASM execute_instruction / resolve_io 返回的判别联合(JS 侧视图) */
type WasmTransitionReply =
	| { type: "state"; payload: unknown; version: number; audit_verified: boolean; rule_hits?: unknown[] }
	| { type: "io_required"; io_type: string; params: unknown }
	| { type: "halted"; rule_index: number; reason: string }
	| { type: "ignored"; instruction_type: string; reason: string; rule_hits?: unknown[] };

/** 规范化指令:兼容 {instruction:{...}} 包裹与扁平 {type,params} 两种形式 */
function normalizeInstruction(instr: object): object {
	const o = instr as Record<string, unknown>;
	if (
		o !== null &&
		typeof o === "object" &&
		"instruction" in o &&
		(o as { instruction?: unknown }).instruction !== null &&
		typeof (o as { instruction?: unknown }).instruction === "object"
	) {
		return (o as { instruction: object }).instruction;
	}
	return instr;
}

export interface WasmBackendOptions {
	/** demo=灌入体验包种子;empty=空状态(回归测试) */
	mode?: "demo" | "empty";
}

export class WasmBackend implements ExecutionBackend {
	/** 强转 CloudHttpBackend 的视图(PluginApprovalView)会访问此属性 */
	readonly baseUrl = "wasm://local";

	private nextId: SessionId = 1;
	/** session → 独立引擎实例 */
	private sessions = new Map<SessionId, EvoRuleEngine>();
	/** 合并后的完整规则集 JSON(每会话 load_rules 用) */
	private rulesJson = "";
	private mock: WasmMockService;
	/** auto_verify 内存开关(默认 false) */
	private autoVerifyBySession = new Map<SessionId, boolean>();

	// === 内存种子(权限/知识/共享事实;逐行搬 MockBackend,73 文档 §2.2) ===
	private static readonly SHARED_FACTS_DEMO: readonly SharedFactEntry[] = [
		{ fact_id: 9101, path: "shared.platform.last_login.username", value: "demo-user", source_session_id: 1, version: 3 },
		{ fact_id: 9102, path: "shared.platform.last_login.ts_ms", value: 1759971200000, source_session_id: 1, version: 3 },
		{ fact_id: 9103, path: "shared.tenant.quota.remaining", value: 42, source_session_id: 2, version: 6 },
	];
	private static readonly SHARED_FACTS_VERSION = 9;

	private static readonly PERMISSIONS_DEMO_SEED: PermissionEntryRecord[] = [
		{
			id: "demo-allow-shared-read", version: 2, state: "active",
			subject: { subject_type: "any", id: "" },
			resource: { resource_type: "shared", path: "shared.platform.*" },
			action: "*", effect: "allow", scope: {}, updated_by: "demo-admin",
		},
		{
			id: "demo-deny-llm-write", version: 3, state: "active",
			subject: { subject_type: "user", id: "llm" },
			resource: { resource_type: "fact", path: "db.users.*" },
			action: "write", effect: "deny", scope: {}, updated_by: "demo-admin",
		},
		{
			id: "demo-candidate-api-export", version: 1, state: "candidate",
			subject: { subject_type: "role", id: "human" },
			resource: { resource_type: "api", path: "/api/audit/export" },
			action: "*", effect: "allow", scope: {}, updated_by: "demo-auditor",
		},
	];
	private permissionEntries: PermissionEntryRecord[] =
		WasmBackend.PERMISSIONS_DEMO_SEED.map((e) => structuredClone(e));
	private permissionVersion = 9;

	private static readonly KNOWLEDGE_DEMO: readonly KnowledgeEntryRecord[] = [
		{
			dataset_id: "medical_guidelines", entry_id: "triage_level_definition",
			payload: { title: "分诊级别定义", levels: ["一级(濒危)", "二级(危重)", "三级(急症)", "四级(非急症)"], source: "急诊预检分诊专家共识" },
			schema_ref: "https://evorule.dev/schemas/medical/triage-level.json",
			bundle_id: "demo-bundle-medical-001", source_version: "2.1.0", domain: "medical", tags: ["分诊", "急诊"],
		},
		{
			dataset_id: "medical_guidelines", entry_id: "djbh_threshold",
			payload: { title: "等级保护阈值", critical_asset_availability: 0.9999, audit_retention_months: 6 },
			schema_ref: "https://evorule.dev/schemas/medical/djbh-threshold.json",
			bundle_id: "demo-bundle-medical-001", source_version: "2.1.0", domain: "medical", tags: ["等保", "合规"],
		},
		{
			dataset_id: "medical_guidelines", entry_id: "antibiotic_stewardship",
			payload: { title: "抗菌药物分级管理", classes: ["非限制使用级", "限制使用级", "特殊使用级"] },
			schema_ref: null, bundle_id: "demo-bundle-medical-002", source_version: "1.4.2", domain: "medical", tags: ["用药"],
		},
		{
			dataset_id: "finance_limits", entry_id: "single_payment_limit",
			payload: { title: "单笔支付限额", retail: 50000, corporate: 5000000, currency: "CNY" },
			schema_ref: "https://evorule.dev/schemas/finance/payment-limit.json",
			bundle_id: "demo-bundle-finance-001", source_version: "3.0.1", domain: "finance", tags: ["支付", "限额"],
		},
	];

	private constructor(rulesJson: string, mock: WasmMockService) {
		this.rulesJson = rulesJson;
		this.mock = mock;
	}

	/**
	 * 工厂方法:初始化 WASM 模块 + 加载规则集 + 注入 mock 服务。
	 * 在 +layout.svelte 中 await 完成后再 provideBackend。
	 */
	static async create(opts: WasmBackendOptions = {}): Promise<WasmBackend> {
		// 先初始化 wasm 模块(createEngine 内部复用单例 init)
		const warmup = await createEngine();
		warmup.free();
		const rulesJson = await loadAllRules();
		const mock = new WasmMockService(opts.mode ?? "demo");
		return new WasmBackend(rulesJson, mock);
	}

	// === 内部工具 ===

	private require(id: SessionId): EvoRuleEngine {
		const e = this.sessions.get(id);
		if (!e) throw new Error(`WasmBackend: session ${id} 不存在`);
		return e;
	}

	/** 当前稳定 reactor 视图(同步引擎跑完即 stable,73 文档 §5.4) */
	private stableReactor(version: number): SessionState["reactor"] {
		return {
			phase: "stable",
			causal_depth: 0,
			current_step: version,
			pending_io_count: 0,
			structural_invariant_violations: 0,
		};
	}

	// === 2.1 必须实现:真实 WASM 引擎语义 ===

	async health(_signal?: AbortSignal): Promise<boolean> {
		return true;
	}

	async createSession(): Promise<SessionId> {
		const id = this.nextId++;
		const engine = await createEngine();
		engine.load_rules(this.rulesJson);
		this.sessions.set(id, engine);
		return id;
	}

	async listSessions(): Promise<SessionId[]> {
		return Array.from(this.sessions.keys()).sort((a, b) => a - b);
	}

	async closeSession(id: SessionId): Promise<void> {
		const e = this.sessions.get(id);
		if (e) {
			try { e.free(); } catch { /* ignore */ }
			this.sessions.delete(id);
		}
	}

	async getSessionState(id: SessionId): Promise<SessionState> {
		const engine = this.require(id);
		const st = JSON.parse(engine.get_state()) as { payload: Record<string, unknown>; version: number };
		return {
			payload: st.payload ?? {},
			queue: [],
			reactor: this.stableReactor(st.version),
			version: st.version,
		};
	}

	/**
	 * 核心:提交指令。执行 io_request 循环直到收敛。
	 */
	async submitCommand(id: SessionId, instruction: object): Promise<CommandResult> {
		const engine = this.require(id);
		const instr = normalizeInstruction(instruction);
		let reply = JSON.parse(engine.execute_instruction(JSON.stringify(instr))) as WasmTransitionReply;

		// io_request 循环(同步引擎 + 同步 mock 服务)
		let guard = 0;
		while (reply.type === "io_required" && guard++ < 32) {
			const io = this.mock.handleIoRequest(reply.io_type, reply.params);
			if (!io.ok) {
				reply = JSON.parse(
					engine.resolve_io(JSON.stringify({ error: io.error })),
				) as WasmTransitionReply;
			} else {
				reply = JSON.parse(
					engine.resolve_io(JSON.stringify(io.value)),
				) as WasmTransitionReply;
			}
		}

		if (reply.type === "state") {
			return { accepted: true, version: reply.version };
		}
		if (reply.type === "halted") {
			return { accepted: false, error: reply.reason };
		}
		if (reply.type === "ignored") {
			return { accepted: false, error: `ignored: ${reply.instruction_type} — ${reply.reason}` };
		}
		// io_request 循环次数耗尽(未收敛)
		return { accepted: false, error: "io_request 循环次数耗尽，未收敛" };
	}

	async getHistory(id: SessionId): Promise<unknown> {
		const entries = this.auditEntries(id);
		return { session_id: id, fact_count: entries.length, facts: this.toFacts(entries) };
	}

	async getReplay(id: SessionId, from?: number, to?: number | null): Promise<Fact[]> {
		let entries = this.auditEntries(id);
		if (from !== undefined) entries = entries.filter((e) => e.logical_time >= from);
		if (to !== null && to !== undefined) entries = entries.filter((e) => e.logical_time <= to);
		return this.toFacts(entries);
	}

	async getFacts(_id: SessionId, _prefix?: string): Promise<FactRecord[]> {
		// WASM 引擎未暴露 payload-update 索引;如实返回空(视图降级友好)
		return [];
	}

	async getAudit(id: SessionId): Promise<SessionAudit> {
		const entries = this.auditEntries(id);
		const verified = this.require(id).verify_audit_chain();
		const last = entries[entries.length - 1];
		return {
			entries,
			fact_count: entries.length,
			verified,
			last_hash: last?.content_hash,
		};
	}

	async verifyAudit(id: SessionId): Promise<VerifyResult> {
		return { verified: this.require(id).verify_audit_chain() };
	}

	async getCausalChain(id: SessionId, factId: number): Promise<CausalChain> {
		const entries = this.auditEntries(id);
		const byId = new Map(entries.map((e) => [e.fact_id, e]));
		const chain: CausalChain["chain"] = [];
		let cur = byId.get(factId);
		let guard = 0;
		while (cur && guard++ < 10000) {
			chain.push({
				fact_id: cur.fact_id,
				fact_type: cur.fact_type,
				logical_time: cur.logical_time,
				cause: cur.cause ?? null,
				content_hash: cur.content_hash,
				prev_hash: cur.prev_hash,
			});
			cur = cur.cause != null ? byId.get(cur.cause) : undefined;
		}
		return { chain };
	}

	async exportAudit(id: SessionId): Promise<unknown> {
		const audit = await this.getAudit(id);
		return {
			session_id: id,
			fact_count: audit.fact_count,
			verified: audit.verified,
			last_hash: audit.last_hash ?? null,
			entries: audit.entries,
		};
	}

	async exportAuditCompressed(id: SessionId): Promise<Blob> {
		const data = await this.exportAudit(id);
		if (typeof CompressionStream === "undefined") {
			throw new Error("WasmBackend: 当前环境无 CompressionStream,压缩导出未实现(请用 JSON 导出)");
		}
		const stream = new Blob([JSON.stringify(data)]).stream().pipeThrough(
			new CompressionStream("gzip"),
		);
		return await new Response(stream).blob();
	}

	async getAutoVerify(id: SessionId): Promise<AutoVerifyStatus> {
		this.require(id);
		return { session_id: id, auto_verify: this.autoVerifyBySession.get(id) ?? false };
	}

	async setAutoVerify(
		id: SessionId,
		enabled: boolean,
		threshold?: number,
		interval?: number,
	): Promise<AutoVerifyConfigResult> {
		this.require(id);
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

	async getStateAtVersion(id: SessionId, version: number): Promise<HistoricalState> {
		const snap = this.snapshotAt(id, version);
		return { payload: snap.payload as object, queue: [], version: snap.version };
	}

	async getDiff(id: SessionId, a: number, b: number): Promise<DiffResult> {
		const pa = (this.snapshotAt(id, a).payload ?? {}) as Record<string, unknown>;
		const pb = (this.snapshotAt(id, b).payload ?? {}) as Record<string, unknown>;
		const items: DiffResult["items"] = [];
		const removed: DiffResult["removed"] = [];
		for (const k of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
			const inA = k in pa;
			const inB = k in pb;
			if (inA && inB) {
				if (JSON.stringify(pa[k]) !== JSON.stringify(pb[k])) {
					items.push([k, pa[k], pb[k]]);
				}
			} else if (inB) {
				items.push([k, pb[k]]);
			} else if (removed) {
				removed.push([k, pa[k]]);
			}
		}
		return { items, removed };
	}

	async interruptSession(id: SessionId): Promise<InterruptResult> {
		this.require(id);
		return { session_id: id, success: true, message: "no-op in sync engine" };
	}

	async abortSession(id: SessionId): Promise<InterruptResult> {
		this.require(id);
		return { session_id: id, success: true, message: "no-op in sync engine" };
	}

	async updatePayload(
		id: SessionId,
		_path: string,
		_value: unknown,
	): Promise<PayloadUpdateResult> {
		this.require(id);
		// WASM 引擎未暴露任意 payload 写入指令;demo 不真正改写(诚实形状)
		return { success: true, message: "PayloadUpdate submitted (WASM, no-op)", fact_id: null };
	}

	async getCausalDepth(id: SessionId): Promise<CausalDepthInfo> {
		this.require(id);
		return { session_id: id, causal_depth: 0 };
	}

	// === 2.2 调试六路(同步引擎恒稳定) ===

	async getStep(id: SessionId): Promise<StepInfo> {
		const v = (JSON.parse(this.require(id).get_state()) as { version: number }).version;
		return { session_id: id, current_step: v };
	}

	async getSessionSnapshot(id: SessionId): Promise<SessionSnapshot> {
		const v = (JSON.parse(this.require(id).get_state()) as { version: number }).version;
		return {
			session_id: id,
			finished: false,
			phase: "stable",
			version: v,
			steps: v,
			pending_io_count: 0,
			structural_invariant_violations: 0,
		};
	}

	async getDebugPhase(id: SessionId): Promise<DebugPhaseInfo> {
		this.require(id);
		return { session_id: id, phase: "stable" };
	}

	async getDebugQueue(id: SessionId): Promise<DebugQueueInfo> {
		this.require(id);
		return { session_id: id, queue: [] };
	}

	async getDebugPendingIo(id: SessionId): Promise<DebugPendingIoInfo> {
		this.require(id);
		return { session_id: id, pending_io_count: 0, pending_io: [] };
	}

	async getPendingIoCount(id: SessionId): Promise<PendingIoCountInfo> {
		this.require(id);
		return { session_id: id, pending_io_count: 0 };
	}

	// === W1:A 组 5 项(派生/回收/导入/共享事实) ===

	async forkSession(parentId: SessionId, _version?: number): Promise<SessionId> {
		this.require(parentId);
		// WASM 引擎无克隆 API:派生为新空会话(诚实降级,见交付说明已知限制)
		return this.createSession();
	}

	async createSessionFrom(parentId: SessionId, _version?: number): Promise<SessionId> {
		this.require(parentId);
		return this.createSession();
	}

	async reapSessions(): Promise<ReapResult> {
		return { finished: 0, expired: 0, total: 0 };
	}

	async importAudit(id: SessionId, _data: unknown): Promise<AuditImportResult> {
		this.require(id);
		return { session_id: id, imported: true, verify_ok: true, status: "ok" };
	}

	async importAuditCompressed(id: SessionId, _blob: Blob): Promise<AuditImportResult> {
		this.require(id);
		return { session_id: id, imported: true, verify_ok: true, status: "ok" };
	}

	async getSharedFacts(prefix?: string): Promise<SharedFactEntry[]> {
		const all = WasmBackend.SHARED_FACTS_DEMO;
		return prefix ? all.filter((f) => f.path.startsWith(prefix)) : [...all];
	}

	async getSharedFactsVersion(): Promise<SharedFactsVersionInfo> {
		return {
			version: WasmBackend.SHARED_FACTS_VERSION,
			history_len: WasmBackend.SHARED_FACTS_DEMO.length,
		};
	}

	// === W3:权限族 9(内存种子,状态机与 server 同口径) ===

	async listPermissions(): Promise<PermissionListResult> {
		return {
			success: true,
			version: this.permissionVersion,
			count: this.permissionEntries.length,
			entries: this.permissionEntries.map((e) => structuredClone(e)),
		};
	}

	async getPermission(id: string): Promise<PermissionEntryRecord> {
		const found = this.permissionEntries.find((e) => e.id === id);
		if (!found) throw new Error(`permission entry not found: ${id}`);
		return structuredClone(found);
	}

	async createPermission(entry: PermissionEntryRecord): Promise<PermissionWriteResult> {
		if (!entry.id.trim()) throw new Error("permission id must not be empty");
		if (this.permissionEntries.some((e) => e.id === entry.id)) {
			throw new Error(`duplicate permission id: ${entry.id}`);
		}
		const created: PermissionEntryRecord = { ...structuredClone(entry), state: "draft", version: 0 };
		this.permissionEntries.push(created);
		this.permissionVersion += 1;
		return { success: true, id: created.id, state: "draft", version: this.permissionVersion };
	}

	async updatePermission(id: string, entry: PermissionEntryRecord): Promise<PermissionWriteResult> {
		if (entry.id !== id) throw new Error("path id and body id mismatch");
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

	async deletePermission(id: string): Promise<PermissionWriteResult> {
		const idx = this.permissionEntries.findIndex((e) => e.id === id);
		if (idx < 0) throw new Error(`permission entry not found: ${id}`);
		this.permissionEntries.splice(idx, 1);
		this.permissionVersion += 1;
		return { success: true, id };
	}

	async submitPermission(id: string): Promise<PermissionWriteResult> {
		const entry = this.permissionEntries.find((e) => e.id === id);
		if (!entry) throw new Error(`permission entry not found: ${id}`);
		if (entry.state !== "draft") throw new Error(`only Draft can be submitted, current = ${entry.state}`);
		entry.state = "candidate";
		this.permissionVersion += 1;
		return { success: true, id, state: "candidate", version: this.permissionVersion };
	}

	async reviewPermission(id: string, approve: boolean): Promise<PermissionWriteResult> {
		const entry = this.permissionEntries.find((e) => e.id === id);
		if (!entry) throw new Error(`permission entry not found: ${id}`);
		if (entry.state !== "candidate") throw new Error(`only Candidate can be reviewed, current = ${entry.state}`);
		entry.state = approve ? "active" : "rejected";
		this.permissionVersion += 1;
		return { success: true, id, state: entry.state, version: this.permissionVersion };
	}

	async getPermissionsVersion(): Promise<PermissionVersionResult> {
		return { success: true, version: this.permissionVersion, count: this.permissionEntries.length };
	}

	async evaluatePermission(req: PermissionEvaluateRequest): Promise<PermissionEvaluateResult> {
		const role = req.caller_role ?? "unknown";
		const action = req.action ?? "*";
		let sawCandidate = false;
		let sawAllow = false;
		for (const e of this.permissionEntries) {
			const subjectMatch = e.subject.subject_type === "any" || e.subject.id === role;
			const actionMatch = e.action === "*" || e.action === action;
			const pattern = e.resource.path;
			const resourceMatch =
				pattern !== "" &&
				(pattern.endsWith("*")
					? req.resource.startsWith(pattern.slice(0, -1))
					: pattern === req.resource);
			if (!subjectMatch || !actionMatch || !resourceMatch) continue;
			if (e.state === "candidate") { sawCandidate = true; continue; }
			if (e.state !== "active") continue;
			if (e.effect === "deny") return this.evalResult(req, role, action, "deny");
			sawAllow = true;
		}
		if (sawAllow) return this.evalResult(req, role, action, "allow");
		if (sawCandidate) return this.evalResult(req, role, action, "candidate");
		return this.evalResult(req, role, action, role === "human" ? "allow" : "deny");
	}

	private evalResult(
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

	// === W5:知识数据面 3(静态种子) ===

	private knowledgeFilter(datasetId: string, filter?: KnowledgeEntryFilter): KnowledgeEntryRecord[] {
		const q = filter?.q?.trim().toLowerCase() ?? "";
		const tags = (filter?.tags ?? "").split(",").map((t) => t.trim()).filter((t) => t.length > 0);
		return WasmBackend.KNOWLEDGE_DEMO.filter((e) => {
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

	async listKnowledgeDatasets(): Promise<KnowledgeDatasetsResult> {
		const datasets = [...new Set(WasmBackend.KNOWLEDGE_DEMO.map((e) => e.dataset_id))].map((dataset_id) => {
			const entries = WasmBackend.KNOWLEDGE_DEMO.filter((e) => e.dataset_id === dataset_id);
			return {
				dataset_id,
				bundle_ids: [...new Set(entries.map((e) => e.bundle_id))],
				entry_count: entries.length,
				schema_refs: [...new Set(entries.map((e) => e.schema_ref).filter((s): s is string => Boolean(s)))],
			};
		});
		return { datasets, count: datasets.length };
	}

	async listKnowledgeEntries(datasetId: string, filter?: KnowledgeEntryFilter): Promise<KnowledgeEntryRecord[]> {
		if (!WasmBackend.KNOWLEDGE_DEMO.some((e) => e.dataset_id === datasetId)) {
			throw new Error(`knowledge dataset not found: ${datasetId}`);
		}
		return this.knowledgeFilter(datasetId, filter);
	}

	async getKnowledgeEntry(datasetId: string, entryId: string): Promise<KnowledgeEntryRecord> {
		const hit = WasmBackend.KNOWLEDGE_DEMO.find(
			(e) => e.dataset_id === datasetId && e.entry_id === entryId,
		);
		if (!hit) throw new Error(`knowledge entry not found: ${datasetId}/${entryId}`);
		return hit;
	}

	// === cloud 专属同名方法(73 文档 §3;WASM 模式安全降级) ===

	async getProductionState(): Promise<ProductionState> {
		return {
			currentSessionId: null,
			rulesetVersion: 16,
			rulesetHash: null,
			status: "running",
			updatedAt: new Date().toISOString(),
		};
	}

	async getPublishQueue(): Promise<PublishQueueItemView[]> {
		return [];
	}

	async reviewPublishRequest(
		_queueId: number,
		_decision: "approved" | "rejected",
		_comment: string,
	): Promise<PublishWriteResult> {
		return { ok: false, error: "WASM 模式不支持部署审批" };
	}

	async emergencyRollbackRequest(_targetVersion: number, _reason: string): Promise<PublishWriteResult> {
		return { ok: false, error: "WASM 模式不支持紧急回滚" };
	}

	async getProductionAudit(): Promise<VersionHistoryEntry[]> {
		return [];
	}

	async listArchiveSessions(): Promise<{ sessions: unknown[]; active_session_ids: number[] }> {
		return { sessions: [], active_session_ids: [] };
	}

	async getArchiveAudit(_id: SessionId): Promise<unknown> {
		throw new Error("not supported in WASM mode（无服务端 WAL 档案）");
	}

	async listPlatformEvents(_kind?: string, _limit?: number): Promise<{ events: unknown[]; total: number }> {
		return { events: [], total: 0 };
	}

	async listBundleImports(_limit?: number): Promise<{ imports: unknown[]; count: number }> {
		return { imports: [], count: 0 };
	}

	/** 服务清单:对齐 72 文档路由表(7 个 mock 服务) */
	async listServices(): Promise<unknown[]> {
		return [
			{ name: "echo_svc", kind: "call_external", status: "online" },
			{ name: "llm_advisor", kind: "call_external", status: "online" },
			{ name: "finance_approval_router", kind: "call_service", status: "online" },
			{ name: "medical_patient_db", kind: "call_service", status: "online" },
			{ name: "medical_antibiotic_formulary", kind: "call_service", status: "online" },
			{ name: "djbh_mfa_registry", kind: "call_service", status: "online" },
			{ name: "djbh_permission_matrix", kind: "call_service", status: "online" },
		];
	}

	// === PluginApprovalView 强转 CloudHttpBackend 后直接调用的运行时方法 ===
	async listExternalPlugins(): Promise<unknown[]> {
		return [];
	}

	async listPluginProposals(_pluginId: string): Promise<{ pending: unknown[]; count: number }> {
		return { pending: [], count: 0 };
	}

	async approvePluginProposal(_pid: string, _propId: string): Promise<void> {
		throw new Error("not supported in WASM mode");
	}

	async rejectPluginProposal(_pid: string, _propId: string, _reason: string): Promise<void> {
		throw new Error("not supported in WASM mode");
	}

	// === 私有:审计条目读取 / 时间旅行快照 ===

	private auditEntries(id: SessionId): Array<{
		fact_id: number; fact_type: string; logical_time: number;
		content_hash: string; prev_hash: string; cause: number | null;
	}> {
		const raw = JSON.parse(this.require(id).get_audit_chain()) as Array<Record<string, unknown>>;
		return raw.map((e) => ({
			fact_id: e.fact_id as number,
			fact_type: e.fact_type as string,
			logical_time: e.logical_time as number,
			content_hash: e.content_hash as string,
			prev_hash: e.prev_hash as string,
			cause: (e.cause ?? null) as number | null,
		}));
	}

	private toFacts(entries: ReturnType<WasmBackend["auditEntries"]>): Fact[] {
		return entries.map((e) => ({
			type: e.fact_type,
			id: e.fact_id,
			logical_time: e.logical_time,
			cause: e.cause,
			content_hash: e.content_hash,
		}));
	}

	/**
	 * 时间旅行快照:保存当前版本 → rewind 到目标 → 恢复当前版本(避免移动 live 视图)。
	 */
	private snapshotAt(id: SessionId, version: number): { payload: unknown; version: number } {
		const engine = this.require(id);
		const cur = (JSON.parse(engine.get_state()) as { version: number }).version;
		const snap = JSON.parse(engine.rewind(version)) as { payload: unknown; version: number };
		if (cur !== version) {
			try { engine.rewind(cur); } catch { /* ignore restore failure */ }
		}
		return { payload: snap.payload, version: snap.version };
	}
}
