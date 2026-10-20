// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// onboarding store 单测 — Tour 扩步(治理连接/AI 助手)+ 清单扩条 + 旧数据兼容
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

describe('TOUR_STEPS(关键路径 4 步)', () => {
	test('步骤集合与顺序:welcome → connection → execute → audit', () => {
		const ids = TOUR_STEPS.map((s) => s.id);
		expect(ids).toEqual(['welcome', 'connection', 'execute', 'audit']);
	});

	test('连接步:target 指向顶栏连接徽标', () => {
		const conn = TOUR_STEPS.find((s) => s.id === 'connection');
		expect(conn?.target).toBe('[data-tour="connection"]');
	});

	test('审计步:route 指向 /audit', () => {
		const audit = TOUR_STEPS.find((s) => s.id === 'audit');
		expect(audit?.route).toBe('/audit');
	});
});

describe('上手清单(关键路径 4 条)', () => {
	test('默认清单为 连接/登录/执行/审计 四条且未完成', () => {
		const items = get(onboardingStore).checklist;
		expect(items.map((i) => i.id)).toEqual(['connect', 'login', 'execute', 'audit']);
		expect(items.every((i) => i.done === false)).toBe(true);
	});

	test('登录条目路由指向 /login', () => {
		const login = get(onboardingStore).checklist.find((i) => i.id === 'login');
		expect(login?.route).toBe('/login');
	});
});

describe('首跑向导状态机(/welcome)', () => {
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

describe('旧数据兼容(mergeState,扩条不丢老用户标记)', () => {
	test('旧存量(无 governance/ai-llm 条目)合并后:新条目天然补全未完成,存量 done 按 id 恢复', () => {
		const base = { ...get(onboardingStore), checklist: defaultChecklist() };
		// 模拟扩条之前的老用户存量:仅 3 条、connect 已完成、横幅已关
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
		// 新清单条目天然补全未完成;已裁撤条目(library)不再出现
		expect(byId('execute')?.done).toBe(false);
		expect(byId('audit')?.done).toBe(false);
		expect(byId('library')).toBeUndefined();
		// 其余引导态按存量恢复
		expect(merged.bannerDismissed).toBe(true);
		expect(merged.tour.completed).toBe(true);
	});
});
