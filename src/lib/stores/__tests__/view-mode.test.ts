// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P11 view-mode store 单测 — 专家/决策者视图切换 + 持久化
//
// 运行: npx vitest run src/lib/stores/__tests__/view-mode.test.ts

import { describe, test, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
	viewModeStore,
	toggleViewMode,
	setViewMode,
	type ViewMode,
} from "../view-mode";

// mock $app/environment:browser=false 让 store 跳过 localStorage
vi.mock("$app/environment", () => ({
	browser: false,
}));

beforeEach(() => {
	setViewMode("expert");
});

describe("P11 view-mode - 初始状态", () => {
	test("默认 expert 模式", () => {
		expect(get(viewModeStore)).toBe("expert");
	});
});

describe("P11 view-mode - toggleViewMode", () => {
	test("expert → decision_maker", () => {
		toggleViewMode();
		expect(get(viewModeStore)).toBe("decision_maker");
	});

	test("decision_maker → expert", () => {
		setViewMode("decision_maker");
		toggleViewMode();
		expect(get(viewModeStore)).toBe("expert");
	});

	test("多次 toggle 来回切换", () => {
		toggleViewMode();
		expect(get(viewModeStore)).toBe("decision_maker");
		toggleViewMode();
		expect(get(viewModeStore)).toBe("expert");
		toggleViewMode();
		expect(get(viewModeStore)).toBe("decision_maker");
	});
});

describe("P11 view-mode - setViewMode", () => {
	test("设置为 decision_maker", () => {
		setViewMode("decision_maker");
		expect(get(viewModeStore)).toBe("decision_maker");
	});

	test("设置为 expert", () => {
		setViewMode("decision_maker");
		setViewMode("expert");
		expect(get(viewModeStore)).toBe("expert");
	});

	test("设置相同值无副作用", () => {
		setViewMode("expert");
		setViewMode("expert");
		expect(get(viewModeStore)).toBe("expert");
	});
});

describe("P11 view-mode - 类型约束", () => {
	test("ViewMode 类型只允许 expert / decision_maker", () => {
		const modes: ViewMode[] = ["expert", "decision_maker"];
		expect(modes).toHaveLength(2);
		for (const m of modes) {
			setViewMode(m);
			expect(get(viewModeStore)).toBe(m);
		}
	});
});
