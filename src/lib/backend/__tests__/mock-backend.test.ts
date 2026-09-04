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

	test("listSessions() 返回 5 个预填 session(含 agent 杀手场景)", async () => {
		const sessions = await backend.listSessions();
		expect(sessions).toHaveLength(5);
		expect(sessions).toEqual([1, 2, 3, 4, 5]);
	});

	test("createSession() 创建新 session(id 从 6 开始)", async () => {
		const id = await backend.createSession();
		expect(id).toBe(6);
		const sessions = await backend.listSessions();
		expect(sessions).toHaveLength(6);
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

describe("P2-mock MockBackend - agent 杀手数据集(session 5)", () => {
	beforeEach(() => {
		setDemoDataset("agent");
	});

	test("getReplay(5) 返回 6 条 agent Fact,含 step3_BAD 自动放行", async () => {
		const facts = await backend.getReplay(5);
		expect(facts).toHaveLength(6);
		expect(facts[0].type).toBe("task_received");
		expect(facts[2].type).toBe("rule_triggered");
		// step3_BAD:agent 自动放行 rm -rf(无人工),result 在 Fact 顶层(与 demo-medical 一致)
		const bad = facts[2] as { result?: string };
		expect(bad.result).toBe("allowed");
	});

	test("getAudit(5) 返回 agent 审计链且 verified", async () => {
		const audit = await backend.getAudit(5);
		expect(audit.fact_count).toBe(6);
		expect(audit.verified).toBe(true);
	});

	test("getDiff(5, 3, 6) 返回决策模式变更(diff)", async () => {
		const diff = await backend.getDiff(5, 3, 6);
		expect(diff.items.length).toBeGreaterThan(0);
	});

	test("getStateAtVersion(5, 3) 返回危险步骤历史快照", async () => {
		const state = await backend.getStateAtVersion(5, 3);
		expect(state.version).toBe(3);
		expect((state.payload as { risk?: string }).risk).toBe("high");
	});

	test("getCausalChain(5) 返回因果链", async () => {
		const chain = await backend.getCausalChain(5, 3);
		expect(chain.chain.length).toBeGreaterThan(0);
		expect(chain.chain[0].fact_type).toBe("guardrail_activated");
	});

	test("getProductionState agent 数据集 currentSessionId=5", async () => {
		const state = await backend.getProductionState();
		expect(state.currentSessionId).toBe(5);
		expect(state.status).toBe("running");
	});
});

describe("P10 MockBackend - forkSession", () => {
	test("forkSession 继承父 session 数据集", async () => {
		const newId = await backend.forkSession(1, 3);
		expect(newId).toBe(6);
		const facts = await backend.getReplay(newId);
		// fork 后继承医疗数据
		expect(facts[0].type).toBe("patient_visit");
	});

	test("forkSession 不存在的 parent 用当前数据集", async () => {
		const newId = await backend.forkSession(999, 1);
		expect(newId).toBeGreaterThanOrEqual(6);
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

// ============================================================================
// UV-062 W2:审计导出 / 自动验证 / 调试只读 / 因果深度(mock 扩充)
// ============================================================================

describe("UV-062 W2 MockBackend - 审计导出", () => {
	test("exportAudit(1) 返回含完整审计链的导出对象", async () => {
		const data = (await backend.exportAudit(1)) as {
			session_id: number;
			fact_count: number;
			entries: unknown[];
		};
		expect(data.session_id).toBe(1);
		expect(data.fact_count).toBe(6);
		expect(data.entries).toHaveLength(6);
	});

	test("exportAudit 不存在的 session 抛错(不静默返回空)", async () => {
		await expect(backend.exportAudit(999)).rejects.toThrow(/不存在/);
	});

	test("exportAuditCompressed(1) 返回 gzip Blob(CompressionStream 可用时)", async () => {
		if (typeof CompressionStream === "undefined") {
			// 环境不支持时显式抛错也是契约的一部分(不静默降级为空文件)
			await expect(backend.exportAuditCompressed(1)).rejects.toThrow(
				/CompressionStream/,
			);
			return;
		}
		const blob = await backend.exportAuditCompressed(1);
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.size).toBeGreaterThan(0);
	});

	test("exportAuditCompressed 不存在的 session 抛错", async () => {
		await expect(backend.exportAuditCompressed(999)).rejects.toThrow(/不存在/);
	});
});

describe("UV-062 W2 MockBackend - auto_verify 开关", () => {
	test("getAutoVerify 默认关闭", async () => {
		const status = await backend.getAutoVerify(1);
		expect(status).toEqual({ session_id: 1, auto_verify: false });
	});

	test("setAutoVerify(true) 后 getAutoVerify 反映新状态", async () => {
		const result = await backend.setAutoVerify(1, true);
		expect(result.success).toBe(true);
		expect(result.auto_verify).toBe(true);

		const status = await backend.getAutoVerify(1);
		expect(status.auto_verify).toBe(true);
	});

	test("setAutoVerify interval 语义:未传归一为 1,传 0 归一为 1(与核心一致)", async () => {
		const r1 = await backend.setAutoVerify(1, true);
		expect(r1.interval).toBe(1);
		const r2 = await backend.setAutoVerify(1, true, undefined, 0);
		expect(r2.interval).toBe(1);
	});

	test("setAutoVerify threshold 缺省回显 0(不限制)", async () => {
		const result = await backend.setAutoVerify(1, false);
		expect(result.threshold).toBe(0);
	});

	test("auto_verify 状态按 session 隔离", async () => {
		await backend.setAutoVerify(1, true);
		const status2 = await backend.getAutoVerify(2);
		expect(status2.auto_verify).toBe(false);
	});

	test("getAutoVerify / setAutoVerify 不存在的 session 抛错", async () => {
		await expect(backend.getAutoVerify(999)).rejects.toThrow(/不存在/);
		await expect(backend.setAutoVerify(999, true)).rejects.toThrow(/不存在/);
	});
});

describe("UV-062 W2 MockBackend - 调试只读六路", () => {
	test("getStep(1) 返回数据集 reactor.current_step", async () => {
		const step = await backend.getStep(1);
		expect(step).toEqual({ session_id: 1, current_step: 6 });
	});

	test("getSessionSnapshot(1) 返回完整快照字段", async () => {
		const snapshot = await backend.getSessionSnapshot(1);
		expect(snapshot.session_id).toBe(1);
		expect(snapshot.finished).toBe(false);
		expect(snapshot.phase).toBe("stable");
		expect(snapshot.version).toBe(6);
		expect(snapshot.steps).toBe(6);
		expect(snapshot.pending_io_count).toBe(0);
		expect(snapshot.structural_invariant_violations).toBe(0);
		expect(snapshot.error).toBeUndefined();
	});

	test("getDebugPhase(1) 返回数据集 reactor.phase", async () => {
		const info = await backend.getDebugPhase(1);
		expect(info).toEqual({ session_id: 1, phase: "stable" });
	});

	test("getDebugQueue(1) 恒为空数组(与 server 同语义)", async () => {
		const q = await backend.getDebugQueue(1);
		expect(q).toEqual({ session_id: 1, queue: [] });
	});

	test("getDebugPendingIo(1) 计数取 reactor,列表恒空", async () => {
		const p = await backend.getDebugPendingIo(1);
		expect(p.pending_io_count).toBe(0);
		expect(p.pending_io).toEqual([]);
	});

	test("getPendingIoCount(1) 返回计数", async () => {
		const c = await backend.getPendingIoCount(1);
		expect(c).toEqual({ session_id: 1, pending_io_count: 0 });
	});

	test("六路对不存在的 session 全部抛错(与 server 404 对齐)", async () => {
		await expect(backend.getStep(999)).rejects.toThrow(/不存在/);
		await expect(backend.getSessionSnapshot(999)).rejects.toThrow(/不存在/);
		await expect(backend.getDebugPhase(999)).rejects.toThrow(/不存在/);
		await expect(backend.getDebugQueue(999)).rejects.toThrow(/不存在/);
		await expect(backend.getDebugPendingIo(999)).rejects.toThrow(/不存在/);
		await expect(backend.getPendingIoCount(999)).rejects.toThrow(/不存在/);
	});
});

describe("UV-062 W2 MockBackend - 因果深度", () => {
	test("getCausalDepth(1) 返回数据集 reactor.causal_depth", async () => {
		const info = await backend.getCausalDepth(1);
		expect(info).toEqual({ session_id: 1, causal_depth: 6 });
	});

	test("getCausalDepth 不存在的 session 抛错", async () => {
		await expect(backend.getCausalDepth(999)).rejects.toThrow(/不存在/);
	});
});

describe("UV-084 W1 MockBackend - A 组 5 项", () => {
        test("importAudit(1) demo 只读,返回导入成功形状", async () => {
                const r = await backend.importAudit(1, { entries: [] });
                expect(r).toEqual({
                        session_id: 1,
                        imported: true,
                        verify_ok: true,
                        status: "ok",
                });
        });

        test("importAuditCompressed(1) 同 importAudit 语义", async () => {
                const r = await backend.importAuditCompressed(1, new Blob([new Uint8Array([0x1f, 0x8b])]));
                expect(r.imported).toBe(true);
                expect(r.status).toBe("ok");
        });

        test("importAudit 不存在的 session 抛错(与 server 404 对齐)", async () => {
                await expect(backend.importAudit(999, {})).rejects.toThrow(/不存在/);
        });

        test("createSessionFrom(1) 继承父数据集,id 从 6 开始", async () => {
                const id = await backend.createSessionFrom(1);
                expect(id).toBe(6);
                // 继承医疗数据集:派生会话状态可查
                const state = await backend.getSessionState(6);
                expect(state.reactor.phase).toBe("stable");
        });

        test("createSessionFrom 不存在的父会话抛错", async () => {
                await expect(backend.createSessionFrom(999)).rejects.toThrow(/不存在/);
        });

        test("reapSessions() demo 会话均活跃,如实返回 0 计数", async () => {
                const r = await backend.reapSessions();
                expect(r).toEqual({ finished: 0, expired: 0, total: 0 });
        });

        test("updatePayload(1) demo 只读,返回提交成功形状", async () => {
                const r = await backend.updatePayload(1, "shared.tenant.quota", 42);
                expect(r.success).toBe(true);
                expect(r.fact_id).toBeNull();
        });

        test("updatePayload 不存在的 session 抛错", async () => {
                await expect(backend.updatePayload(999, "p", 1)).rejects.toThrow(/不存在/);
        });

        test("getSharedFacts() 缺省返回全部演示数据", async () => {
                const facts = await backend.getSharedFacts();
                expect(facts.length).toBeGreaterThanOrEqual(3);
                expect(facts[0].path).toContain("shared.");
        });

        test("getSharedFacts(prefix) 前缀过滤", async () => {
                const facts = await backend.getSharedFacts("shared.platform.");
                expect(facts).toHaveLength(2);
                facts.forEach((f) => expect(f.path.startsWith("shared.platform.")).toBe(true));
        });

        test("getSharedFactsVersion() 返回版本与历史长度", async () => {
                const info = await backend.getSharedFactsVersion();
                expect(info.version).toBeGreaterThan(0);
                expect(info.history_len).toBeGreaterThanOrEqual(3);
        });
});

describe("UV-084 W3 MockBackend - A-流权限策略族", () => {
	test("listPermissions() 返回 3 条种子条目(含版本与计数)", async () => {
		const r = await backend.listPermissions();
		expect(r.success).toBe(true);
		expect(r.count).toBe(3);
		expect(r.version).toBeGreaterThan(0);
		expect(r.entries.map((e) => e.id)).toEqual([
			"demo-allow-shared-read",
			"demo-deny-llm-write",
			"demo-candidate-api-export",
		]);
	});

	test("getPermission(存在) 返回单条;不存在抛错(与 server 404 对齐)", async () => {
		const e = await backend.getPermission("demo-allow-shared-read");
		expect(e.effect).toBe("allow");
		expect(e.state).toBe("active");
		await expect(backend.getPermission("nope")).rejects.toThrow(/not found/);
	});

	test("createPermission 强制 Draft 态 + 版本推进;重复 id 抛错(与 server 409 对齐)", async () => {
		const r = await backend.createPermission({
			id: "mock-new-entry",
			version: 99,
			state: "active",
			subject: { subject_type: "user", id: "human" },
			resource: { resource_type: "api", path: "/api/x" },
			action: "*",
			effect: "deny",
			scope: {},
			updated_by: "test",
		});
		// 状态强制 draft、version 重置(与 server create_permission 同口径)
		expect(r.state).toBe("draft");
		const list = await backend.listPermissions();
		const created = list.entries.find((e) => e.id === "mock-new-entry");
		expect(created?.state).toBe("draft");
		expect(created?.version).toBe(0);
		// 重复 id 冲突
		await expect(
			backend.createPermission({
				id: "mock-new-entry",
				version: 0,
				state: "draft",
				subject: { subject_type: "any", id: "" },
				resource: { resource_type: "shared", path: "s.*" },
				action: "*",
				effect: "allow",
				scope: {},
				updated_by: "test",
			}),
		).rejects.toThrow(/duplicate/);
	});

	test("生命周期状态机:Draft → submit → Candidate → review(approve) → Active", async () => {
		await backend.createPermission({
			id: "lifecycle-test",
			version: 0,
			state: "draft",
			subject: { subject_type: "any", id: "" },
			resource: { resource_type: "shared", path: "shared.test.*" },
			action: "*",
			effect: "allow",
			scope: {},
			updated_by: "test",
		});
		const s1 = await backend.submitPermission("lifecycle-test");
		expect(s1.state).toBe("candidate");
		// 非 Draft 不可重复提交(与 server 400 对齐)
		await expect(backend.submitPermission("lifecycle-test")).rejects.toThrow(
			/only Draft can be submitted/,
		);
		// 非 Candidate 不可裁决的镜像:先拒绝路径
		const r1 = await backend.reviewPermission("lifecycle-test", true);
		expect(r1.state).toBe("active");
		// Active 后不可再裁决
		await expect(backend.reviewPermission("lifecycle-test", false)).rejects.toThrow(
			/only Candidate can be reviewed/,
		);
	});

	test("review(reject) → Rejected;不参与判定", async () => {
		await backend.createPermission({
			id: "reject-test",
			version: 0,
			state: "draft",
			subject: { subject_type: "any", id: "" },
			resource: { resource_type: "shared", path: "shared.reject.*" },
			action: "*",
			effect: "allow",
			scope: {},
			updated_by: "test",
		});
		await backend.submitPermission("reject-test");
		const r = await backend.reviewPermission("reject-test", false);
		expect(r.state).toBe("rejected");
	});

	test("updatePermission 幂等替换,已 Active 保持 Active", async () => {
		const r = await backend.updatePermission("demo-allow-shared-read", {
			id: "demo-allow-shared-read",
			version: 0,
			state: "draft",
			subject: { subject_type: "any", id: "" },
			resource: { resource_type: "shared", path: "shared.platform.*" },
			action: "read",
			effect: "allow",
			scope: {},
			updated_by: "test",
		});
		expect(r.success).toBe(true);
		const e = await backend.getPermission("demo-allow-shared-read");
		expect(e.state).toBe("active");
		expect(e.action).toBe("read");
		// path/body id 不一致抛错(与 server 400 对齐)
		await expect(
			backend.updatePermission("other-id", {
				id: "mismatch",
				version: 0,
				state: "draft",
				subject: { subject_type: "any", id: "" },
				resource: { resource_type: "shared", path: "s" },
				action: "*",
				effect: "allow",
				scope: {},
				updated_by: "test",
			}),
		).rejects.toThrow(/mismatch/);
	});

	test("deletePermission 内存删除 + 版本推进;不存在抛错", async () => {
		const r = await backend.deletePermission("demo-candidate-api-export");
		expect(r.success).toBe(true);
		const list = await backend.listPermissions();
		expect(list.entries.find((e) => e.id === "demo-candidate-api-export")).toBeUndefined();
		await expect(backend.deletePermission("nope")).rejects.toThrow(/not found/);
	});

	test("getPermissionsVersion() 返回版本与条目数", async () => {
		const v = await backend.getPermissionsVersion();
		expect(v.success).toBe(true);
		expect(v.count).toBe(3);
		expect(v.version).toBeGreaterThan(0);
	});

	test("evaluate:deny 即胜(种子 demo-deny-llm-write 命中 llm + db.users.* + write)", async () => {
		const r = await backend.evaluatePermission({
			resource: "db.users.table1",
			action: "write",
			caller_role: "llm",
		});
		expect(r.verdict).toBe("deny");
		expect(r.caller_role).toBe("llm");
	});

	test("evaluate:通配 allow 命中(demo-allow-shared-read:any + shared.platform.*)", async () => {
		const r = await backend.evaluatePermission({
			resource: "shared.platform.anything",
			action: "read",
			caller_role: "unknown",
		});
		expect(r.verdict).toBe("allow");
	});

	test("evaluate:candidate 命中(待审批条目匹配,无 active 命中)", async () => {
		const r = await backend.evaluatePermission({
			resource: "/api/audit/export",
			action: "*",
			caller_role: "human",
		});
		expect(r.verdict).toBe("candidate");
	});

	test("evaluate:默认策略 fail-closed(无任何命中:human=allow,llm/unknown=deny)", async () => {
		const human = await backend.evaluatePermission({
			resource: "nowhere.matching",
			caller_role: "human",
		});
		expect(human.verdict).toBe("allow");
		const llm = await backend.evaluatePermission({
			resource: "nowhere.matching",
			caller_role: "llm",
		});
		expect(llm.verdict).toBe("deny");
		const unknown = await backend.evaluatePermission({
			resource: "nowhere.matching",
			caller_role: "unknown",
		});
		expect(unknown.verdict).toBe("deny");
	});
});
