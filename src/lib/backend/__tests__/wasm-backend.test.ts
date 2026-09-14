// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// WasmBackend 单元测试 — 在 Node 下加载真实 wasm32 产物(initSync),
// 验证 submitCommand -> getSessionState 与「直接调用 EvoRuleEngine」一致,
// 以及 getAudit / verifyAudit 形状正确。
//
// 运行: npx vitest run src/lib/backend/__tests__/wasm-backend.test.ts
//
// 说明:engine-loader / rules-loader 依赖浏览器(?url / $app/paths / fetch),
// 这里用 vi.mock 把它们替换为 Node 等价实现(直接读 src/lib/wasm 与 static/rules)。

import { describe, test, expect, beforeAll, vi } from "vitest";
import { pathToFileURL } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// ---- mock engine-loader:真实 wasm32 产物,Node 同步 init ----
vi.mock("$lib/wasm/engine-loader", () => {
	const wasmDir = path.resolve(process.cwd(), "src/lib/wasm");
	let mod: any = null;
	async function loadMod(): Promise<any> {
		if (mod) return mod;
		const glue = await import(pathToFileURL(path.join(wasmDir, "evorule_wasm_demo.js")).href);
		const bytes = readFileSync(path.join(wasmDir, "evorule_wasm_demo_bg.wasm"));
		glue.initSync({ module: bytes });
		mod = glue;
		return glue;
	}
	return {
		createEngine: async () => {
			const m = await loadMod();
			return new m.EvoRuleEngine();
		},
		loadWasm: loadMod,
	};
});

// ---- mock rules-loader:与浏览器同序合并 static/rules ----
vi.mock("$lib/wasm/rules-loader", () => {
	const RULE_FILES = [
		"core_eval.json",
		"20_finance_rules.json",
		"21_medical_rules.json",
		"22_djbh_rules.json",
		"10_role13_demo.json",
	];
	return {
		loadAllRules: async (): Promise<string> => {
			const dir = path.resolve(process.cwd(), "static/rules");
			const merged: unknown[] = [];
			for (const f of RULE_FILES) {
				const obj = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
				const arr = Array.isArray(obj) ? obj : (obj as { transform: unknown[] }).transform;
				merged.push(...(arr as unknown[]));
			}
			return JSON.stringify(merged);
		},
	};
});

import { WasmBackend } from "../wasm-backend";

const travel1000 = { type: "finance_expense_limit_check", params: { expense: { type: "travel", amount: 1000 } } };
const travel5000 = { type: "finance_expense_limit_check", params: { expense: { type: "travel", amount: 5000 } } };

let backend: WasmBackend;

beforeAll(async () => {
	backend = await WasmBackend.create({ mode: "empty" });
});

describe("WasmBackend - submitCommand / getSessionState 一致性", () => {
	test("createSession 返回 session id 且可列出", async () => {
		const id = await backend.createSession();
		expect(typeof id).toBe("number");
		expect(await backend.listSessions()).toContain(id);
	});

	test("差旅 1000 -> allowed, version=1", async () => {
		const id = await backend.createSession();
		const res = await backend.submitCommand(id, travel1000);
		expect(res.accepted).toBe(true);
		expect(res.version).toBe(1);

		const st = await backend.getSessionState(id);
		expect(st.version).toBe(1);
		const decision = (st.payload as any)?.data?.result?.decision;
		expect(decision).toBe("allowed");
		expect(st.reactor.phase).toBe("stable");
	});

	test("差旅 5000 -> blocked, version=2(累积)", async () => {
		const id = await backend.createSession();
		await backend.submitCommand(id, travel1000);
		const res = await backend.submitCommand(id, travel5000);
		expect(res.accepted).toBe(true);
		expect(res.version).toBe(2);

		const st = await backend.getSessionState(id);
		expect(st.version).toBe(2);
		const decision = (st.payload as any)?.data?.result?.decision;
		expect(decision).toBe("blocked");
	});

	test("getAudit / verifyAudit 返回正确形状", async () => {
		const id = await backend.createSession();
		await backend.submitCommand(id, travel1000);
		await backend.submitCommand(id, travel5000);

		const audit = await backend.getAudit(id);
		expect(audit.verified).toBe(true);
		expect(audit.fact_count).toBeGreaterThan(0);
		expect(Array.isArray(audit.entries)).toBe(true);
		const last = audit.entries[audit.entries.length - 1] as { content_hash: string };
		expect(audit.last_hash).toBe(last.content_hash);
		for (const e of audit.entries) {
			expect(e).toHaveProperty("fact_id");
			expect(e).toHaveProperty("fact_type");
			expect(e).toHaveProperty("content_hash");
			expect(e).toHaveProperty("prev_hash");
		}

		const v = await backend.verifyAudit(id);
		expect(v.verified).toBe(true);
	});

	test("与直接调用 WASM 引擎输出一致(payload 逐字段)", async () => {
		// 直接驱动引擎(与 WasmBackend 同规则同指令)
		const { createEngine } = await import("$lib/wasm/engine-loader");
		const { loadAllRules } = await import("$lib/wasm/rules-loader");
		const rulesJson = await loadAllRules();

		const id = await backend.createSession();
		const res = await backend.submitCommand(id, travel5000);
		const st = await backend.getSessionState(id);

		const direct = await createEngine();
		direct.load_rules(rulesJson);
		const reply = JSON.parse(direct.execute_instruction(JSON.stringify(travel5000)));
		direct.free();

		expect(res.version).toBe(reply.version);
		expect((st.payload as any)).toEqual(reply.payload);
	});
});

describe("WasmBackend - 已知限制(预期降级形状)", () => {
	test("getFacts 返回空数组", async () => {
		const id = await backend.createSession();
		await backend.submitCommand(id, travel1000);
		const facts = await backend.getFacts(id);
		expect(Array.isArray(facts)).toBe(true);
		expect(facts.length).toBe(0);
	});

	test("forkSession 派生为新空会话(version=0)", async () => {
		const parent = await backend.createSession();
		await backend.submitCommand(parent, travel1000);
		const child = await backend.forkSession(parent);
		expect(child).not.toBe(parent);
		const st = await backend.getSessionState(child);
		expect(st.version).toBe(0);
	});

	test("updatePayload 为 no-op 成功形状", async () => {
		const id = await backend.createSession();
		const r = await backend.updatePayload(id, "data.x", 1);
		expect(r.success).toBe(true);
		expect(r.fact_id).toBeNull();
	});

	test("cloud 专属写操作 getArchiveAudit 抛 not supported", async () => {
		const id = await backend.createSession();
		await expect(backend.getArchiveAudit(id)).rejects.toThrow(/not supported in WASM mode/);
	});

	test("listServices 列出 7 个 mock 服务", async () => {
		const svcs = await backend.listServices();
		expect(svcs.length).toBe(7);
	});

	test("role13_demo io 循环在 32 次护栏后优雅返回未收敛(不死循环)", async () => {
		const id = await backend.createSession();
		const t0 = Date.now();
		const res = await backend.submitCommand(id, {
			type: "role13_demo",
			params: { args: { ping: "hi" } },
		});
		const dt = Date.now() - t0;
		// 命名空间 __io_result__(注入) vs __io_results__(规则读取)不匹配 -> 永不收敛
		expect(res.accepted).toBe(false);
		expect(String((res as any).error || "")).toMatch(/未收敛/);
		// 32 次同步 io 迭代必须毫秒级返回,远不会死循环
		expect(dt).toBeLessThan(5000);
	});

	test("16 条纯 transform 业务规则不受 role13 io 问题影响", async () => {
		const id = await backend.createSession();
		const res = await backend.submitCommand(id, travel1000);
		expect(res.accepted).toBe(true);
		const st = await backend.getSessionState(id);
		expect((st.payload as any)?.data?.result?.decision).toBe("allowed");
	});
});
