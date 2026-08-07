// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P10 MockBackend 单测 — 验证 15 方法返回预填数据,零网络依赖
//
// 运行: npx vitest run src/lib/backend/__tests__/mock-backend.test.ts

import { describe, test, expect, beforeEach } from "vitest";
import { MockBackend } from "../mock-backend";
import { demoDatasetStore, setDemoDataset } from "$lib/stores/demo-dataset";

let backend: MockBackend;

beforeEach(() => {
	backend = new MockBackend();
	setDemoDataset("medical");
});

describe("P10 MockBackend - 基础方法", () => {
	test("health() 永远返回 true(零网络依赖)", async () => {
		expect(await backend.health()).toBe(true);
	});

	test("listSessions() 返回 4 个预填 session", async () => {
		const sessions = await backend.listSessions();
		expect(sessions).toHaveLength(4);
		expect(sessions).toEqual([1, 2, 3, 4]);
	});

	test("createSession() 创建新 session(id 从 5 开始)", async () => {
		const id = await backend.createSession();
		expect(id).toBe(5);
		const sessions = await backend.listSessions();
		expect(sessions).toHaveLength(5);
	});

	test("closeSession() 删除 session", async () => {
		await backend.closeSession(1);
		const sessions = await backend.listSessions();
		expect(sessions).not.toContain(1);
	});

	test("closeSession() 不存在的 session 不报错", async () => {
		await expect(backend.closeSession(999)).resolves.toBeUndefined();
	});
});

describe("P10 MockBackend - 医疗数据集", () => {
	test("getSessionState(1) 返回医疗 session 状态", async () => {
		const state = await backend.getSessionState(1);
		expect(state.reactor.phase).toBe("stable");
		expect(state.version).toBe(6);
		expect(state.reactor.causal_depth).toBe(6);
	});

	test("getReplay(1) 返回 6 条医疗 Fact", async () => {
		const facts = await backend.getReplay(1);
		expect(facts).toHaveLength(6);
		expect(facts[0].type).toBe("patient_visit");
		expect(facts[5].type).toBe("decision");
	});

	test("getReplay(1, 3, 5) 按版本范围过滤", async () => {
		const facts = await backend.getReplay(1, 3, 5);
		expect(facts).toHaveLength(3);
		expect(facts[0].logical_time).toBe(3);
		expect(facts[2].logical_time).toBe(5);
	});

	test("getAudit(1) 返回医疗审计链", async () => {
		const audit = await backend.getAudit(1);
		expect(audit.fact_count).toBe(6);
		expect(audit.verified).toBe(true);
		expect(audit.last_hash).toBeTruthy();
	});

	test("verifyAudit(1) 返回 verified=true", async () => {
		const result = await backend.verifyAudit(1);
		expect(result.verified).toBe(true);
	});

	test("getCausalChain(1, 3) 返回因果链", async () => {
		const chain = await backend.getCausalChain(1, 3);
		expect(chain.chain.length).toBeGreaterThan(0);
		expect(chain.chain[0].fact_type).toBe("rule_triggered");
	});

	test("getFacts(1) 返回 FactRecord 数组", async () => {
		const records = await backend.getFacts(1);
		expect(records).toHaveLength(6);
		expect(records[0].fact_id).toBe(1);
	});

	test("getStateAtVersion(1, 3) 返回历史快照", async () => {
		const state = await backend.getStateAtVersion(1, 3);
		expect(state.version).toBe(3);
		expect(state.payload).toBeDefined();
	});

	test("getDiff(1, 3, 6) 返回 diff", async () => {
		const diff = await backend.getDiff(1, 3, 6);
		expect(diff.items.length).toBeGreaterThan(0);
	});

	test("submitCommand() demo 模式只读,返回 accepted", async () => {
		const result = await backend.submitCommand(1, { type: "test" });
		expect(result.accepted).toBe(true);
	});

	test("getHistory(1) 返回含 fact_count", async () => {
		const history = (await backend.getHistory(1)) as {
			fact_count: number;
			facts: unknown[];
		};
		expect(history.fact_count).toBe(6);
		expect(history.facts).toHaveLength(6);
	});
});

describe("P10 MockBackend - 财务数据集", () => {
	beforeEach(() => {
		setDemoDataset("finance");
	});

	test("getSessionState(2) 返回财务 session 状态", async () => {
		const state = await backend.getSessionState(2);
		expect(state.reactor.phase).toBe("stable");
		expect(state.version).toBe(6);
	});

	test("getReplay(2) 返回 6 条财务 Fact", async () => {
		const facts = await backend.getReplay(2);
		expect(facts).toHaveLength(6);
		expect(facts[0].type).toBe("expense_submit");
	});

	test("getAudit(2) 返回财务审计链", async () => {
		const audit = await backend.getAudit(2);
		expect(audit.fact_count).toBe(6);
		expect(audit.verified).toBe(true);
	});
});

describe("P10 MockBackend - 合规门禁 session", () => {
	test("session 3 = 医疗合规门禁,返回 2 条 Fact", async () => {
		const facts = await backend.getReplay(3);
		expect(facts).toHaveLength(2);
		expect(facts[0].type).toBe("tool_call");
		expect(facts[1].type).toBe("gate_blocked");
	});

	test("session 4 = 财务合规门禁,返回 2 条 Fact", async () => {
		setDemoDataset("finance");
		const facts = await backend.getReplay(4);
		expect(facts).toHaveLength(2);
		expect(facts[1].type).toBe("gate_blocked");
	});
});

describe("P10 MockBackend - forkSession", () => {
	test("forkSession 继承父 session 数据集", async () => {
		const newId = await backend.forkSession(1, 3);
		expect(newId).toBe(5);
		const facts = await backend.getReplay(newId);
		// fork 后继承医疗数据
		expect(facts[0].type).toBe("patient_visit");
	});

	test("forkSession 不存在的 parent 用当前数据集", async () => {
		const newId = await backend.forkSession(999, 1);
		expect(newId).toBeGreaterThanOrEqual(5);
	});
});

describe("P10 MockBackend - getProductionState", () => {
	test("医疗数据集返回 running 状态 + 版本 6", async () => {
		setDemoDataset("medical");
		const state = await backend.getProductionState();
		expect(state.status).toBe("running");
		expect(state.rulesetVersion).toBe(6);
		expect(state.currentSessionId).toBe(1);
	});

	test("财务数据集返回 running 状态 + 版本 6", async () => {
		setDemoDataset("finance");
		const state = await backend.getProductionState();
		expect(state.status).toBe("running");
		expect(state.currentSessionId).toBe(2);
	});
});

describe("P10 MockBackend - 错误处理", () => {
	test("getSessionState 不存在的 session 抛错", async () => {
		await expect(backend.getSessionState(999)).rejects.toThrow(/不存在/);
	});

	test("getStateAtVersion 不存在的 session 抛错", async () => {
		await expect(backend.getStateAtVersion(999, 1)).rejects.toThrow(
			/不存在/,
		);
	});
});
