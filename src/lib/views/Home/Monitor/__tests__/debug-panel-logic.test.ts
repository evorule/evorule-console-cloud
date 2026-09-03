// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// UV-062 W2 接线3 单测:DebugPanel 纯逻辑层。
//
// 覆盖点:
//   D1: 通道定义完整性(六路 key,标签齐全,顺序无重复)
//   D2: createInitialChannels 全 idle
//   D3: parseSessionIdInput(正整数/空/小数/负数/非数字)
//   D4: isSnapshotFailed(200+error 语义失败态;无 error = 成功)
//   D5: formatPhase(null = 未启动,非 null 透传)
//   D6: formatQueue / formatPendingIoList(空列表明示,非空 JSON 化)
//   D7: formatSnapshotSummary(字段齐全;缺失字段显示 "—" 而非 0)
//   D8: channelSemanticError(仅 snapshot 有内嵌失败态)
//   D9: formatChannelValue(六路 ok 态格式化)
//   D10: fetchDebugChannel(六路分发到对应 backend 方法)
//
// 运行: npx vitest run src/lib/views/Home/Monitor/__tests__/debug-panel-logic.test.ts

import { describe, test, expect, vi } from "vitest";
import {
	type DebugChannelKey,
	DEBUG_CHANNEL_LABELS,
	DEBUG_CHANNEL_ORDER,
	createInitialChannels,
	parseSessionIdInput,
	isSnapshotFailed,
	formatPhase,
	formatQueue,
	formatPendingIoList,
	formatSnapshotSummary,
	channelSemanticError,
	formatChannelValue,
	fetchDebugChannel,
} from "../debug-panel-logic";
import type { ExecutionBackend } from "$lib/kernel";

// === D1: 通道定义完整性 ===
describe("D1 通道定义完整性", () => {
	test("DEBUG_CHANNEL_ORDER 六路且无重复", () => {
		expect(DEBUG_CHANNEL_ORDER).toHaveLength(6);
		expect(new Set(DEBUG_CHANNEL_ORDER).size).toBe(6);
	});

	test("六路 key 与预期一致", () => {
		expect(DEBUG_CHANNEL_ORDER).toEqual([
			"step",
			"phase",
			"snapshot",
			"queue",
			"pending_io",
			"pending_io_count",
		]);
	});

	test("每路都有非空标签", () => {
		for (const key of DEBUG_CHANNEL_ORDER) {
			expect(DEBUG_CHANNEL_LABELS[key].length).toBeGreaterThan(0);
		}
	});
});

// === D2: 初始状态 ===
describe("D2 createInitialChannels", () => {
	test("六路全部 idle 且无数据无错误", () => {
		const channels = createInitialChannels();
		for (const key of DEBUG_CHANNEL_ORDER) {
			expect(channels[key]).toEqual({
				status: "idle",
				data: null,
				error: null,
			});
		}
	});
});

// === D3: session id 输入解析 ===
describe("D3 parseSessionIdInput", () => {
	test("正整数字符串有效(含前后空白)", () => {
		expect(parseSessionIdInput("5")).toBe(5);
		expect(parseSessionIdInput(" 12 ")).toBe(12);
	});

	test("前导零的纯数字有效", () => {
		expect(parseSessionIdInput("007")).toBe(7);
	});

	test("空串返回 null", () => {
		expect(parseSessionIdInput("")).toBeNull();
		expect(parseSessionIdInput("   ")).toBeNull();
	});

	test("小数返回 null", () => {
		expect(parseSessionIdInput("3.14")).toBeNull();
	});

	test("负数与零返回 null", () => {
		expect(parseSessionIdInput("-1")).toBeNull();
		expect(parseSessionIdInput("0")).toBeNull();
	});

	test("非纯数字返回 null(含科学计数法/十六进制/字母)", () => {
		expect(parseSessionIdInput("abc")).toBeNull();
		expect(parseSessionIdInput("1e3")).toBeNull();
		expect(parseSessionIdInput("0x1f")).toBeNull();
	});
});

// === D4: snapshot 失败态判定 ===
describe("D4 isSnapshotFailed", () => {
	test("有 error 字段 = 失败(server 反应器结束/锁中毒,200+error)", () => {
		expect(
			isSnapshotFailed({ session_id: 1, error: "reactor finished" }),
		).toBe(true);
	});

	test("无 error 字段 = 成功(数据字段缺失 ≠ 失败)", () => {
		expect(isSnapshotFailed({ session_id: 1, phase: "stable" })).toBe(false);
	});

	test("空字符串 error = 成功", () => {
		expect(isSnapshotFailed({ session_id: 1, error: "" })).toBe(false);
	});
});

// === D5: phase 格式化 ===
describe("D5 formatPhase", () => {
	test("null 显示未启动文案(不留白)", () => {
		expect(formatPhase(null)).toBe("未启动(反应器不存在)");
	});

	test("非 null 透传", () => {
		expect(formatPhase("stable")).toBe("stable");
		expect(formatPhase("awaiting_io")).toBe("awaiting_io");
	});
});

// === D6: 空列表明示 ===
describe("D6 formatQueue / formatPendingIoList", () => {
	test("空队列明示(空)而非无内容", () => {
		expect(formatQueue([])).toBe("(空队列)");
	});

	test("非空队列 JSON 化", () => {
		expect(formatQueue([{ type: "io_request" }])).toBe(
			'[{"type":"io_request"}]',
		);
	});

	test("空悬挂 IO 明示(无)", () => {
		expect(formatPendingIoList([])).toBe("(无悬挂 I/O)");
	});

	test("非空悬挂 IO JSON 化", () => {
		expect(formatPendingIoList([{ io: 1 }])).toBe('[{"io":1}]');
	});
});

// === D7: snapshot 摘要(缺失字段 ≠ 隐式 0) ===
describe("D7 formatSnapshotSummary", () => {
	test("字段齐全时逐字段展示", () => {
		const s = {
			session_id: 1,
			finished: false,
			phase: "stable",
			version: 6,
			steps: 42,
			pending_io_count: 0,
			structural_invariant_violations: 0,
		};
		const text = formatSnapshotSummary(s);
		expect(text).toContain("phase=stable");
		expect(text).toContain("steps=42");
		expect(text).toContain("pending_io=0");
		expect(text).toContain("violations=0");
		expect(text).toContain("version=6");
		expect(text).toContain("finished=false");
	});

	test("字段缺失显示 — 而非 0", () => {
		const text = formatSnapshotSummary({ session_id: 1 });
		expect(text).toContain("phase=—");
		expect(text).toContain("steps=—");
		expect(text).not.toContain("steps=0");
	});
});

// === D8: 数据内嵌失败态 ===
describe("D8 channelSemanticError", () => {
	test("snapshot 带 error → 返回错误文本", () => {
		expect(
			channelSemanticError("snapshot", {
				session_id: 1,
				error: "lock poisoned",
			}),
		).toBe("lock poisoned");
	});

	test("snapshot 无 error → null", () => {
		expect(
			channelSemanticError("snapshot", { session_id: 1, phase: "idle" }),
		).toBeNull();
	});

	test("其他通道无内嵌失败态", () => {
		expect(channelSemanticError("step", { session_id: 1 })).toBeNull();
		expect(
			channelSemanticError("phase", { session_id: 1, phase: null }),
		).toBeNull();
	});

	test("snapshot data=null → null(不算失败)", () => {
		expect(channelSemanticError("snapshot", null)).toBeNull();
	});
});

// === D9: ok 态格式化 ===
describe("D9 formatChannelValue", () => {
	test("step", () => {
		expect(
			formatChannelValue("step", { session_id: 1, current_step: 7 }),
		).toBe("current_step = 7");
	});

	test("phase(null → 未启动文案)", () => {
		expect(
			formatChannelValue("phase", { session_id: 1, phase: null }),
		).toBe("未启动(反应器不存在)");
	});

	test("phase(非 null)", () => {
		expect(
			formatChannelValue("phase", { session_id: 1, phase: "executing" }),
		).toBe("executing");
	});

	test("snapshot(成功态摘要)", () => {
		const text = formatChannelValue("snapshot", {
			session_id: 1,
			phase: "stable",
			steps: 3,
			pending_io_count: 0,
			structural_invariant_violations: 0,
			version: 6,
			finished: false,
		});
		expect(text).toContain("phase=stable");
		expect(text).toContain("steps=3");
	});

	test("snapshot(防御:失败态 snapshot 不编造数值)", () => {
		const text = formatChannelValue("snapshot", {
			session_id: 1,
			error: "reactor finished",
		});
		expect(text).toBe("快照失败: reactor finished");
	});

	test("queue(空 → 空队列文案)", () => {
		expect(
			formatChannelValue("queue", { session_id: 1, queue: [] }),
		).toBe("(空队列)");
	});

	test("pending_io(计数 + 列表)", () => {
		expect(
			formatChannelValue("pending_io", {
				session_id: 1,
				pending_io_count: 2,
				pending_io: [{ id: 1 }, { id: 2 }],
			}),
		).toBe('计数 2  [{"id":1},{"id":2}]');
	});

	test("pending_io_count", () => {
		expect(
			formatChannelValue("pending_io_count", {
				session_id: 1,
				pending_io_count: 4,
			}),
		).toBe("pending_io_count = 4");
	});
});

// === D10: 通道 → backend 方法分发 ===
describe("D10 fetchDebugChannel 分发", () => {
	function makeBackend(): {
		backend: ExecutionBackend;
		calls: string[];
	} {
		const calls: string[] = [];
		const backend = {
			getStep: vi.fn(async () => {
				calls.push("getStep");
				return { session_id: 1, current_step: 0 };
			}),
			getSessionSnapshot: vi.fn(async () => {
				calls.push("getSessionSnapshot");
				return { session_id: 1 };
			}),
			getDebugPhase: vi.fn(async () => {
				calls.push("getDebugPhase");
				return { session_id: 1, phase: null };
			}),
			getDebugQueue: vi.fn(async () => {
				calls.push("getDebugQueue");
				return { session_id: 1, queue: [] };
			}),
			getDebugPendingIo: vi.fn(async () => {
				calls.push("getDebugPendingIo");
				return { session_id: 1, pending_io_count: 0, pending_io: [] };
			}),
			getPendingIoCount: vi.fn(async () => {
				calls.push("getPendingIoCount");
				return { session_id: 1, pending_io_count: 0 };
			}),
		} as unknown as ExecutionBackend;
		return { backend, calls };
	}

	const cases: Array<[DebugChannelKey, string]> = [
		["step", "getStep"],
		["snapshot", "getSessionSnapshot"],
		["phase", "getDebugPhase"],
		["queue", "getDebugQueue"],
		["pending_io", "getDebugPendingIo"],
		["pending_io_count", "getPendingIoCount"],
	];

	test.each(cases)("%s → backend.%s", async (key, method) => {
		const { backend, calls } = makeBackend();
		await fetchDebugChannel(backend, 3, key);
		expect(calls).toEqual([method]);
	});
});
