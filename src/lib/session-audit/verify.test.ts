// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// 会话验证器单测 — 契约校验/链验证/first_broken 定位/级联语义/篡改恢复。

import { describe, expect, test } from "vitest";
import { ContractError } from "./types";
import { canonicalJson, importAndVerify, verifySession } from "./verify";
import killerFixture from "./fixtures/agent-killer.json";
import computeFixture from "./fixtures/numeric-compute.json";
import type { AgentSessionFile } from "./types";

const killer = killerFixture as unknown as AgentSessionFile;
const compute = computeFixture as unknown as AgentSessionFile;

describe("canonicalJson(确定性哈希输入)", () => {
	test("键序无关:同内容不同键序序列化一致", () => {
		expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
			canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
		);
	});
	test("无空白紧凑输出", () => {
		expect(canonicalJson({ a: 1 })).toBe('{"a":1}');
	});
});

describe("契约校验(格式不符明确拒绝)", () => {
	test("缺 format 字段拒绝", () => {
		expect(() => importAndVerify({ version: 1 })).toThrow(ContractError);
	});
	test("version 不支持拒绝", () => {
		expect(() =>
			importAndVerify({ ...killer, version: 2 }),
		).toThrow(/version/);
	});
	test("facts 与 chain.entries 条数不一致拒绝", () => {
		expect(() =>
			importAndVerify({ ...killer, facts: killer.facts.slice(0, 3) }),
		).toThrow(/不一致/);
	});
});

describe("内置 fixture 链验证(真实 BLAKE3 链)", () => {
	test("安全护栏线:链完整,root 通过", () => {
		const v = verifySession(killer);
		expect(v.chainIntact).toBe(true);
		expect(v.firstBroken).toBeNull();
		expect(v.rootOk).toBe(true);
		expect(v.factVerdicts.every((f) => f.trusted)).toBe(true);
	});
	test("确定性计算线:链完整", () => {
		const v = verifySession(compute);
		expect(v.chainIntact).toBe(true);
	});
});

describe("篡改语义(first_broken + 级联)", () => {
	test("篡改第 3 条事实 → first_broken=2,其后级联不可信", () => {
		const tampered = structuredClone(killer);
		(tampered.facts[2].trigger as Record<string, unknown>).command =
			"rm -rf /; # 被篡改";
		const v = verifySession(tampered);
		expect(v.chainIntact).toBe(false);
		expect(v.firstBroken).toBe(2);
		// 级联:断点起全部不可信,断点前全部可信
		expect(v.factVerdicts[0].trusted).toBe(true);
		expect(v.factVerdicts[1].trusted).toBe(true);
		expect(v.factVerdicts.slice(2).every((f) => !f.trusted)).toBe(true);
		// 断点前条目哈希仍应吻合(局部性:篡改不污染前史)
		expect(v.factVerdicts[0].hashOk).toBe(true);
		expect(v.factVerdicts[2].hashOk).toBe(false);
	});

	test("篡改首条 → 全链不可信", () => {
		const tampered = structuredClone(compute);
		(tampered.facts[0].payload as Record<string, unknown>).task = "被篡改的任务";
		const v = verifySession(tampered);
		expect(v.firstBroken).toBe(0);
		expect(v.factVerdicts.every((f) => !f.trusted)).toBe(true);
	});

	test("链外作恶:直接改 chain 声明哈希(不改事实)同样被抓获", () => {
		const forged = structuredClone(killer);
		forged.chain.entries[4].fact_hash = "blake3:0000forged";
		const v = verifySession(forged);
		expect(v.chainIntact).toBe(false);
		expect(v.firstBroken).toBe(4);
	});

	test("root 伪造被抓获(末条哈希对但 root 不符)", () => {
		const forged = structuredClone(killer);
		forged.chain.root = "blake3:fake-root";
		const v = verifySession(forged);
		expect(v.chainIntact).toBe(false);
		expect(v.rootOk).toBe(false);
	});
});
