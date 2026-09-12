// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// onboarding store 单测 — UV-179 批次A:Tour 扩步(治理连接/AI 助手)+ 清单扩条 + 旧数据兼容
//
// 运行: npx vitest run src/lib/stores/onboarding.test.ts

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

// ---- localStorage 桩(node 环境无) ----
const localStore = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => localStore.get(k) ?? null,
	setItem: (k: string, v: string) => void localStore.set(k, String(v)),
	removeItem: (k: string) => void localStore.delete(k),
	clear: () => void localStore.clear()
});

import {
	TOUR_STEPS,
	onboardingStore,
	mergeState,
	resetAllOnboarding,
	defaultChecklist,
	completeWelcome,
	dismissWelcomeNotice,
	resetWelcome,
	shouldShowWelcomeNotice
} from './onboarding';

beforeEach(() => {
	localStore.clear();
	resetAllOnboarding();
});

describe('TOUR_STEPS(UV-179 扩步)', () => {
	test('含治理连接步:route 指向 /governance 且明示体验包默认凭据+安全标注', () => {
		const gov = TOUR_STEPS.find((s) => s.id === 'governance');
		expect(gov).toBeDefined();
		expect(gov?.route).toBe('/governance');
		expect(gov?.description).toContain('admin');
		expect(gov?.description).toContain('evorule-demo');
		expect(gov?.description).toContain('正式部署');
	});

	test('含 AI 助手可选步:不强制(route 缺省)且明示跳过不影响使用', () => {
		const ai = TOUR_STEPS.find((s) => s.id === 'ai');
		expect(ai).toBeDefined();
		expect(ai?.route).toBeUndefined();
		expect(ai?.title).toContain('可选');
		expect(ai?.description).toContain('没有 Key');
	});

	test('步骤顺序:治理连接在 connection 之后、library 之前', () => {
		const ids = TOUR_STEPS.map((s) => s.id);
		expect(ids.indexOf('governance')).toBeGreaterThan(ids.indexOf('connection'));
		expect(ids.indexOf('governance')).toBeLessThan(ids.indexOf('library'));
	});
});

describe('上手清单(UV-179 扩条)', () => {
	test('默认清单含「连接治理服务」与「配置 AI 助手(可选)」条目且未完成', () => {
		const items = get(onboardingStore).checklist;
		const gov = items.find((i) => i.id === 'governance');
		const ai = items.find((i) => i.id === 'ai-llm');
		expect(gov?.route).toBe('/governance');
		expect(gov?.done).toBe(false);
		expect(ai?.title).toContain('可选');
		expect(ai?.done).toBe(false);
	});
});

describe('首跑向导状态机(UV-179 批次A /welcome)', () => {
	test('默认未完成未关闭:提示条应显示', () => {
		expect(get(onboardingStore).welcome).toEqual({ completed: false, dismissed: false });
		expect(shouldShowWelcomeNotice()).toBe(true);
	});

	test('completeWelcome 后提示条不再显示;resetWelcome 重跑入口恢复', () => {
		completeWelcome();
		expect(get(onboardingStore).welcome.completed).toBe(true);
		expect(shouldShowWelcomeNotice()).toBe(false);

		resetWelcome();
		expect(get(onboardingStore).welcome).toEqual({ completed: false, dismissed: false });
		expect(shouldShowWelcomeNotice()).toBe(true);
	});

	test('dismissWelcomeNotice(不再提示)关闭提示条但不标记完成;重跑清两态', () => {
		dismissWelcomeNotice();
		expect(get(onboardingStore).welcome.completed).toBe(false);
		expect(get(onboardingStore).welcome.dismissed).toBe(true);
		expect(shouldShowWelcomeNotice()).toBe(false);

		resetWelcome();
		expect(shouldShowWelcomeNotice()).toBe(true);
	});

	test('旧存量(无 welcome 字段)合并后:默认未完成,提示条对老用户可见', () => {
		const base = { ...get(onboardingStore), checklist: defaultChecklist() };
		const legacy = {
			tour: { active: false, step: 0, completed: true, skipped: false },
			checklist: [{ id: 'connect', done: true }],
			bannerDismissed: false,
			hints: {}
		} as Parameters<typeof mergeState>[1];

		const merged = mergeState(base, legacy);
		expect(merged.welcome).toEqual({ completed: false, dismissed: false });
	});

	test('已存 welcome 态(用户已关提示条)合并后保留,不被重置', () => {
		const base = { ...get(onboardingStore), checklist: defaultChecklist() };
		const saved = {
			tour: { active: false, step: 0, completed: true, skipped: false },
			checklist: [],
			bannerDismissed: false,
			hints: {},
			welcome: { completed: true, dismissed: false }
		} as Parameters<typeof mergeState>[1];

		const merged = mergeState(base, saved);
		expect(merged.welcome).toEqual({ completed: true, dismissed: false });
	});
});

describe('旧数据兼容(mergeState,UV-179 扩条不丢老用户标记)', () => {
	test('旧存量(无 governance/ai-llm 条目)合并后:新条目天然补全未完成,存量 done 按 id 恢复', () => {
		const base = { ...get(onboardingStore), checklist: defaultChecklist() };
		// 模拟 UV-179 之前的老用户存量:仅 3 条、connect 已完成、横幅已关
		// (Partial<OnboardingState> 断言:加 welcome 字段后结构性重叠不再充分,经 unknown 中转)
		const legacy = {
			tour: { active: false, step: 0, completed: true, skipped: false },
			checklist: [
				{ id: 'connect', done: true },
				{ id: 'login', done: false },
				{ id: 'library', done: false }
			],
			bannerDismissed: true,
			hints: { governance: '2026-09-01T00:00:00.000Z' }
		} as unknown as Parameters<typeof mergeState>[1];

		const merged = mergeState(base, legacy);
		const byId = (id: string) => merged.checklist.find((i) => i.id === id);
		// 存量标记保留
		expect(byId('connect')?.done).toBe(true);
		expect(byId('login')?.done).toBe(false);
		// 新增条目天然补全(老用户升级后可见新引导项)
		expect(byId('governance')?.done).toBe(false);
		expect(byId('ai-llm')?.done).toBe(false);
		// 其余引导态按存量恢复
		expect(merged.bannerDismissed).toBe(true);
		expect(merged.tour.completed).toBe(true);
	});
});
