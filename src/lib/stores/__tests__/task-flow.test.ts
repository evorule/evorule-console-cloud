// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P10 task-flow store 单测 — 任务流启动/推进/完成/取消 + 上下文保留
//
// 运行: npx vitest run src/lib/stores/__tests__/task-flow.test.ts

import { describe, test, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
	taskFlowStore,
	startTaskFlow,
	nextStep,
	prevStep,
	jumpToStep,
	completeTaskFlow,
	cancelTaskFlow,
	updateContext,
	getCurrentStepDef,
	getCurrentFlowDef,
} from "../task-flow";
import { resetTaskHistory } from "../task-history";
import { resetGuidedTaskProgress } from "../guided-task-progress";

// mock $app/navigation 的 goto(任务流跳转用)
vi.mock("$app/navigation", () => ({
	goto: vi.fn(),
}));

// mock $app/environment:browser=false 让 store 跳过 localStorage(SSR/test 安全)
vi.mock("$app/environment", () => ({
	browser: false,
}));

beforeEach(() => {
	taskFlowStore.set(null);
	resetTaskHistory();
	resetGuidedTaskProgress();
});

describe("P10 task-flow - startTaskFlow", () => {
	test("启动任务流,store 设置为 running 实例", () => {
		startTaskFlow("add_rule");
		const instance = get(taskFlowStore);
		expect(instance).not.toBeNull();
		expect(instance?.flowId).toBe("add_rule");
		expect(instance?.currentStep).toBe(1);
		expect(instance?.status).toBe("running");
		expect(instance?.isDemo).toBe(false);
	});

	test("启动 demo 模式任务流,isDemo=true", () => {
		startTaskFlow("add_rule", true, { ruleId: "R-DEMO-001" });
		const instance = get(taskFlowStore);
		expect(instance?.isDemo).toBe(true);
		expect(instance?.context.ruleId).toBe("R-DEMO-001");
	});

	test("启动新任务流时,若已有运行中的,先取消", () => {
		startTaskFlow("add_rule");
		const firstId = get(taskFlowStore)?.instanceId;
		startTaskFlow("query_issue");
		const secondId = get(taskFlowStore)?.instanceId;
		expect(secondId).not.toBe(firstId);
		expect(get(taskFlowStore)?.flowId).toBe("query_issue");
	});

	test("启动未知任务流抛错", () => {
		expect(() =>
			startTaskFlow("unknown_flow" as never),
		).toThrow(/Unknown task flow/);
	});
});

describe("P10 task-flow - nextStep", () => {
	test("推进到下一步,currentStep 递增", () => {
		startTaskFlow("add_rule");
		nextStep();
		expect(get(taskFlowStore)?.currentStep).toBe(2);
	});

	test("推进时更新上下文", () => {
		startTaskFlow("add_rule");
		nextStep({ ruleId: "R-001" });
		expect(get(taskFlowStore)?.context.ruleId).toBe("R-001");
	});

	test("推进到最后一步后,completeTaskFlow", () => {
		startTaskFlow("add_rule"); // 4 步
		nextStep(); // → 2
		nextStep(); // → 3
		nextStep(); // → 4
		nextStep(); // → 完成
		expect(get(taskFlowStore)?.status).toBe("completed");
	});

	test("没有运行中的任务流时,nextStep 无操作", () => {
		nextStep();
		expect(get(taskFlowStore)).toBeNull();
	});
});

describe("P10 task-flow - prevStep", () => {
	test("回到上一步,currentStep 递减", () => {
		startTaskFlow("add_rule");
		nextStep(); // → 2
		nextStep(); // → 3
		prevStep(); // → 2
		expect(get(taskFlowStore)?.currentStep).toBe(2);
	});

	test("第 1 步时 prevStep 无操作", () => {
		startTaskFlow("add_rule");
		prevStep();
		expect(get(taskFlowStore)?.currentStep).toBe(1);
	});
});

describe("P10 task-flow - jumpToStep", () => {
	test("跳转到指定步骤", () => {
		startTaskFlow("add_rule");
		jumpToStep(3);
		expect(get(taskFlowStore)?.currentStep).toBe(3);
	});

	test("跳转超出范围无操作", () => {
		startTaskFlow("add_rule");
		jumpToStep(99);
		expect(get(taskFlowStore)?.currentStep).toBe(1);
		jumpToStep(0);
		expect(get(taskFlowStore)?.currentStep).toBe(1);
	});
});

describe("P10 task-flow - completeTaskFlow", () => {
	test("完成任务流,status=completed", () => {
		startTaskFlow("add_rule");
		completeTaskFlow();
		expect(get(taskFlowStore)?.status).toBe("completed");
	});

	test("完成时记录 demo 引导任务进度", () => {
		startTaskFlow("add_rule", true);
		completeTaskFlow("try_add");
		// 进度由 guided-task-progress store 记录(异步 setTimeout 后清空 taskFlowStore)
		expect(get(taskFlowStore)?.status).toBe("completed");
	});
});

describe("P10 task-flow - cancelTaskFlow", () => {
	test("取消任务流,status=cancelled", () => {
		startTaskFlow("add_rule");
		cancelTaskFlow(false); // 不跳转
		expect(get(taskFlowStore)?.status).toBe("cancelled");
	});
});

describe("P10 task-flow - updateContext", () => {
	test("更新上下文(非 demo 模式)", () => {
		startTaskFlow("add_rule");
		updateContext({ ruleId: "R-UPDATED" });
		expect(get(taskFlowStore)?.context.ruleId).toBe("R-UPDATED");
	});

	test("demo 模式下 updateContext 无操作(只读)", () => {
		startTaskFlow("add_rule", true, { ruleId: "R-DEMO-001" });
		updateContext({ ruleId: "R-HACK" });
		expect(get(taskFlowStore)?.context.ruleId).toBe("R-DEMO-001");
	});
});

describe("P10 task-flow - 查询函数", () => {
	test("getCurrentStepDef 返回当前步骤定义", () => {
		startTaskFlow("add_rule");
		const step = getCurrentStepDef();
		expect(step).not.toBeNull();
		expect(step?.name).toBe("创建规则");
	});

	test("getCurrentFlowDef 返回当前任务流定义", () => {
		startTaskFlow("query_issue");
		const def = getCurrentFlowDef();
		expect(def).not.toBeNull();
		expect(def?.name).toBe("查问题");
	});

	test("无任务流时返回 null", () => {
		expect(getCurrentStepDef()).toBeNull();
		expect(getCurrentFlowDef()).toBeNull();
	});
});

describe("P10 task-flow - 6 任务流定义覆盖", () => {
	const flowIds = [
		"add_rule",
		"query_issue",
		"edit_rule",
		"review_rule",
		"view_history",
		"compliance_gate",
	] as const;

	for (const flowId of flowIds) {
		test(`任务流 ${flowId} 可启动且 4 步骤`, () => {
			startTaskFlow(flowId);
			const def = getCurrentFlowDef();
			expect(def).not.toBeNull();
			expect(def?.steps).toHaveLength(4);
		});
	}
});
