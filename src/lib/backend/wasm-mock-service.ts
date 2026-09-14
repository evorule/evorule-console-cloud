// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// WASM io_request mock 服务 —— 对齐文档72《WASM io_request mock 服务规格设计》。
//
// 在浏览器 WASM 模式下替代 evorule-server 的 ServiceRegistryHandler,为
// call_external / call_service 类 io_request 提供带内存状态的本地 mock。
// 与 evorule-server ServiceRegistryHandler.execute() 语义一一对齐。
//
// 注意:16 条业务规则(20/21/22)全部纯 transform,不触发 io_request。
// 本 mock 服务服务于「用户/自定义规则提交 call_external/call_service 指令」,
// 唯一内置剧本是 10_role13_demo.json(service_name=echo_svc)。

// ============================================================================
// 类型契约(文档72 §3)
// ============================================================================

/** io_request(引擎已把 args 路径解析为真实值) */
export interface IoRequestParams {
	io_type: "call_external" | "call_service";
	service_name: string;
	args: unknown;
}

/** 等价 Result<JsonValue, String> */
export type IoResult = { ok: true; value: unknown } | { ok: false; error: string };

type ServiceHandler = (args: any, ctx: MockServiceContext) => IoResult;

interface MockServiceContext {
	state: MockState;
	trace: (serviceName: string, action: string, detail: unknown) => void;
}

/** 内存状态对象(文档72 §4) */
export interface MockState {
	echoRound: number;
	approvalTable: Array<{ max_amount: number; approver: string; band: string }>;
	patients: Record<
		string,
		{
			patient_id: string;
			name_masked: string;
			age: number;
			gender: "M" | "F";
			allergies: string[];
			has_penicillin_allergy: boolean;
		}
	>;
	formulary: Record<
		string,
		{ tier: "non_restricted" | "restricted" | "special"; rule_ref: string }
	>;
	mfa: Record<string, { enabled: boolean; factor_count: number }>;
	permissions: Record<string, string[]>;
}

// ============================================================================
// 种子数据(文档72 §5)
// ============================================================================

function seedDemoState(): MockState {
	return {
		echoRound: 0,
		approvalTable: [
			{ max_amount: 500, approver: "auto", band: "auto_approved" },
			{ max_amount: 5000, approver: "部门经理", band: "manager_approval" },
			{ max_amount: 30000, approver: "分管副总", band: "director_approval" },
			{
				max_amount: 999999999,
				approver: "总经理办公会集体审批",
				band: "collective_approval",
			},
		],
		patients: {
			"P-001": { patient_id: "P-001", name_masked: "张某", age: 45, gender: "F", allergies: [], has_penicillin_allergy: false },
			"P-002": { patient_id: "P-002", name_masked: "李某", age: 70, gender: "M", allergies: [], has_penicillin_allergy: false },
			"P-003": { patient_id: "P-003", name_masked: "王某", age: 38, gender: "F", allergies: ["penicillin"], has_penicillin_allergy: true },
			"P-004": { patient_id: "P-004", name_masked: "赵某", age: 62, gender: "M", allergies: [], has_penicillin_allergy: false },
			"P-005": { patient_id: "P-005", name_masked: "陈某", age: 29, gender: "F", allergies: [], has_penicillin_allergy: false },
			"P-006": { patient_id: "P-006", name_masked: "刘某", age: 81, gender: "M", allergies: [], has_penicillin_allergy: false },
		},
		formulary: {
			"注射用盐酸万古霉素": { tier: "special", rule_ref: "卫生部令84号第二十七条" },
			"注射用头孢呋辛": { tier: "restricted", rule_ref: "卫生部令84号第二十四条" },
			"阿莫西林胶囊": { tier: "non_restricted", rule_ref: "青霉素类" },
			"阿奇霉素": { tier: "non_restricted", rule_ref: "大环内酯类" },
		},
		mfa: {
			alice: { enabled: true, factor_count: 2 },
			bob: { enabled: true, factor_count: 2 },
			carol: { enabled: false, factor_count: 1 },
		},
		permissions: {
			alice: ["read", "write"],
			admin: ["read", "write", "admin"],
			auditor: ["read"],
		},
	};
}

function seedEmptyState(): MockState {
	return {
		echoRound: 0,
		approvalTable: [],
		patients: {},
		formulary: {},
		mfa: {},
		permissions: {},
	};
}

// ============================================================================
// 各服务处理函数(文档72 §6)
// ============================================================================

function handleEcho(args: any, ctx: MockServiceContext): IoResult {
	const round = ctx.state.echoRound++;
	return {
		ok: true,
		value: {
			echo: args,
			service_name: "echo_svc",
			round,
			ts: new Date().toISOString(),
		},
	};
}

function handleLlmAdvisor(): IoResult {
	return {
		ok: true,
		value: {
			advice: "mock 建议：按规则集判定，无需 LLM",
			routed_to: "demo-advisor",
			confidence: 95,
		},
	};
}

function handleApprovalRouter(args: any, ctx: MockServiceContext): IoResult {
	if (!args || typeof args !== "object") {
		return { ok: false, error: "approval_router: args 不是对象" };
	}
	if (args.op === "route") {
		const amount = Number(args.amount);
		let hit = ctx.state.approvalTable[ctx.state.approvalTable.length - 1];
		for (const seg of ctx.state.approvalTable) {
			if (amount < seg.max_amount) {
				hit = seg;
				break;
			}
		}
		return {
			ok: true,
			value: {
				amount,
				approver: hit.approver,
				band: hit.band,
				ok: true,
			},
		};
	}
	if (args.op === "set_approver") {
		const seg = ctx.state.approvalTable.find(
			(s) => s.max_amount === Number(args.max_amount),
		);
		if (!seg) return { ok: false, error: `set_approver: 未命中段 ${args.max_amount}` };
		seg.approver = String(args.approver);
		return { ok: true, value: { table: ctx.state.approvalTable } };
	}
	return { ok: false, error: `unknown op '${args.op}'` };
}

function handlePatientDb(args: any, ctx: MockServiceContext): IoResult {
	if (!args || typeof args !== "object") {
		return { ok: false, error: "patient_db: args 不是对象" };
	}
	if (args.op === "get_allergy") {
		const p = ctx.state.patients[args.patient_id];
		if (!p) return { ok: false, error: `unknown patient '${args.patient_id}'` };
		return {
			ok: true,
			value: {
				patient_id: p.patient_id,
				allergies: [...p.allergies],
				has_penicillin_allergy: p.has_penicillin_allergy,
			},
		};
	}
	if (args.op === "add_allergy") {
		const p = ctx.state.patients[args.patient_id];
		if (!p) return { ok: false, error: `unknown patient '${args.patient_id}'` };
		if (!p.allergies.includes(args.drug)) p.allergies.push(args.drug);
		if (args.drug === "penicillin") p.has_penicillin_allergy = true;
		return {
			ok: true,
			value: {
				patient_id: p.patient_id,
				allergies: [...p.allergies],
				has_penicillin_allergy: p.has_penicillin_allergy,
			},
		};
	}
	return { ok: false, error: `unknown op '${args.op}'` };
}

function handleFormulary(args: any, ctx: MockServiceContext): IoResult {
	const drug = String(args?.drug_name ?? "");
	const hit = ctx.state.formulary[drug];
	return {
		ok: true,
		value: hit
			? { drug_name: drug, tier: hit.tier, rule_ref: hit.rule_ref }
			: { drug_name: drug, tier: "non_restricted", rule_ref: "未收录" },
	};
}

function handleMfaRegistry(args: any, ctx: MockServiceContext): IoResult {
	if (!args || typeof args !== "object") {
		return { ok: false, error: "mfa_registry: args 不是对象" };
	}
	const uid = String(args.user_id);
	let rec = ctx.state.mfa[uid];
	if (args.op === "enable") {
		rec = { enabled: true, factor_count: 2 };
		ctx.state.mfa[uid] = rec;
	} else if (args.op === "disable") {
		rec = { enabled: false, factor_count: 1 };
		ctx.state.mfa[uid] = rec;
	} else if (args.op === "get") {
		rec = rec ?? { enabled: false, factor_count: 1 };
	} else {
		return { ok: false, error: `unknown op '${args.op}'` };
	}
	return {
		ok: true,
		value: {
			user_id: uid,
			mfa_enabled: rec.enabled,
			factor_count: rec.factor_count,
		},
	};
}

function handlePermissionMatrix(args: any, ctx: MockServiceContext): IoResult {
	if (!args || typeof args !== "object") {
		return { ok: false, error: "permission_matrix: args 不是对象" };
	}
	const uid = String(args.user_id);
	const perm = String(args.permission);
	let list = ctx.state.permissions[uid] ?? [];
	if (args.op === "query") {
		return {
			ok: true,
			value: { user_id: uid, permission: perm, granted: list.includes(perm) },
		};
	}
	if (args.op === "grant") {
		if (!list.includes(perm)) list = [...list, perm];
		ctx.state.permissions[uid] = list;
		return { ok: true, value: { user_id: uid, permission: perm, granted: true } };
	}
	if (args.op === "revoke") {
		list = list.filter((p) => p !== perm);
		ctx.state.permissions[uid] = list;
		return { ok: true, value: { user_id: uid, permission: perm, granted: false } };
	}
	return { ok: false, error: `unknown op '${args.op}'` };
}

const ROUTES: Record<string, ServiceHandler> = {
	echo_svc: handleEcho,
	llm_advisor: handleLlmAdvisor,
	finance_approval_router: handleApprovalRouter,
	medical_patient_db: handlePatientDb,
	medical_antibiotic_formulary: handleFormulary,
	djbh_mfa_registry: handleMfaRegistry,
	djbh_permission_matrix: handlePermissionMatrix,
};

// ============================================================================
// 对外服务类
// ============================================================================

export class WasmMockService {
	private state: MockState;
	private readonly mode: "demo" | "empty";
	/** 调试观察 trace(不入 TCB 事实链) */
	readonly traceLog: Array<{ service: string; action: string; detail: unknown }> = [];

	constructor(mode: "demo" | "empty" = "demo") {
		this.mode = mode;
		this.state = mode === "demo" ? seedDemoState() : seedEmptyState();
	}

	private trace(service: string, action: string, detail: unknown): void {
		this.traceLog.push({ service, action, detail });
	}

	/**
	 * 路由主函数:按 service_name 分发,返回与 server ServiceRegistryHandler 等价的结果。
	 */
	dispatch(p: IoRequestParams): IoResult {
		const ctx: MockServiceContext = {
			state: this.state,
			trace: (s, a, d) => this.trace(s, a, d),
		};
		const h = ROUTES[p.service_name];
		if (!h) {
			return { ok: false, error: `unknown service_name '${p.service_name}' — 服务未注册` };
		}
		try {
			return h(p.args, ctx);
		} catch (e) {
			return { ok: false, error: String(e) };
		}
	}

	/**
	 * 便捷入口:从引擎 io_required 信号直接处理。
	 * @param ioType  io_required.io_type(call_external | call_service)
	 * @param params  io_required.params(含 service_name 与已解析的 args)
	 */
	handleIoRequest(ioType: string, params: unknown): IoResult {
		const p = (params ?? {}) as Record<string, unknown>;
		return this.dispatch({
			io_type:
				ioType === "call_service" ? "call_service" : "call_external",
			service_name: String(p.service_name ?? ""),
			args: p.args,
		});
	}

	/** 恢复初始状态 */
	reset(): void {
		this.state = this.mode === "demo" ? seedDemoState() : seedEmptyState();
		this.traceLog.length = 0;
	}
}
