// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 新手引导共享底座(P0 / PR1)。
// 统一承载以下四项引导态,供 PR2–PR10 的所有引导 UI 复用,避免各自为政:
//   1. Tour(首启交互式引导)状态机 + 步骤定义
//   2. 上手清单(Getting Started,6 步,可勾选 / 跳转到对应视图)
//   3. 首屏引导横幅(OnboardingBanner)的「已关闭 / 可重显」开关
//   4. 各视图首访提示(GuidedHint)的「已看过」记忆
//
// 持久化:localStorage(key: evorule-console-cloud:onboarding),整体序列化。
// 风格对齐现有 store(home-mode.ts / session.ts / guided-task-progress.ts):
//   - 用 svelte/store writable
//   - 用 $app/environment 的 browser 守卫,SSR/预渲染时不触 localStorage
//   - 订阅时写回 localStorage,异常静默
//
// 设计要点:
//   - 单一结构对象,便于整体读写与「重置全部引导」
//   - 与既有 OnboardingBanner 的旧键(evrule-console-cloud:onboarding-banner)解耦,
//     PR4 会把横幅改为读本 store 的 bannerDismissed,届时旧键自然废弃
//   - 路由跳转由 UI 层(goto)完成,store 只存 route 字符串,不耦合 $app/navigation

import { writable, get } from "svelte/store";
import { browser } from "$app/environment";

// ============================================================
// 类型定义
// ============================================================

/** Tour 步骤标识(同时作为 step 的语义键) */
export type TourStepId =
	| "welcome"
	| "connection"
	| "library"
	| "rule"
	| "execute"
	| "audit";

/** 一条 Tour 步骤(数据驱动,UI 组件只负责渲染) */
export interface TourStep {
	/** 步骤标识 */
	id: TourStepId;
	/** 标题 */
	title: string;
	/** 说明(可含一句话指引) */
	description: string;
	/**
	 * 高亮目标 DOM 选择器(best-effort)。
	 * 由对应视图在元素上打 data-tour="<id>";找不到则 spotlight 居中显示。
	 * 为空表示非锚定步骤(如纯叙述)。
	 */
	target?: string;
	/** 显示该步骤前应跳转到的路由(可选,由 UI 层执行) */
	route?: string;
}

/** 上手清单条目 */
export interface ChecklistItem {
	/** 条目标识 */
	id: string;
	/** 标题 */
	title: string;
	/** 一句说明 */
	description: string;
	/** 点击「去做」时跳转的路由 */
	route: string;
	/** 是否可由应用检测自动标记完成(否则仅手动勾选) */
	autoCompletable: boolean;
	/** 是否已完成 */
	done: boolean;
}

/** 引导整体状态 */
export interface OnboardingState {
	tour: {
		/** 是否正在播放 Tour */
		active: boolean;
		/** 当前步骤索引(对应 TOUR_STEPS) */
		step: number;
		/** 是否至少完整看过一次 */
		completed: boolean;
		/** 用户是否显式跳过 */
		skipped: boolean;
	};
	/** 上手清单 */
	checklist: ChecklistItem[];
	/** 首屏引导横幅是否已关闭(关闭后不再自动显示) */
	bannerDismissed: boolean;
	/** 各视图首访提示记忆:viewKey -> 已看过的 ISO 时间 */
	hints: Record<string, string>;
}

// ============================================================
// 默认数据(集中定义,便于「重置」还原)
// ============================================================

/** Tour 步骤(顺序即播放顺序) */
export const TOUR_STEPS: TourStep[] = [
	{
		id: "welcome",
		title: "欢迎使用 evorule",
		description:
			"evorule 是给 AI 装上的「行车记录仪 + 红绿灯」——记录每一步、守住安全边界。下面用 5 步带你跑通第一条规则。",
	},
	{
		id: "connection",
		title: "第 1 步 · 让后端连上来",
		description:
			"顶部状态条显示 evorule-server 连接情况。若「未连接」,点它即可看诊断与排障。先确保状态变绿。",
		target: '[data-tour="connection"]',
		route: "/",
	},
	{
		id: "library",
		title: "第 2 步 · 建立你的知识库",
		description:
			"首次进入会启动 5 步建库向导(选类型、加载模板、命名)。跟着向导走即可,也能随时跳过。",
		target: '[data-tour="library"]',
		route: "/",
	},
	{
		id: "rule",
		title: "第 3 步 · 添加第一条规则",
		description:
			"在「治理中心」加一条业务规则,或用任务流 4 步体验完整链路。规则就是 evorule 要守护的行为约定。",
		target: '[data-tour="rule"]',
		route: "/governance",
	},
	{
		id: "execute",
		title: "第 4 步 · 在执行台跑一条命令",
		description:
			"「工作台」是极简 dashboard,任何时候都能进。在这里发起一次执行,看 evorule 如何实时守护。",
		target: '[data-tour="execute"]',
		route: "/workbench",
	},
	{
		id: "audit",
		title: "第 5 步 · 查看审计链",
		description:
			"「审计记录」里是 BLAKE3 防篡改审计链与因果回溯。每步操作都可验证、可追溯。到这里你就入门了!",
		target: '[data-tour="audit"]',
		route: "/audit",
	},
];

function defaultChecklist(): ChecklistItem[] {
	return [
		{
			id: "connect",
			title: "连接 evorule-server",
			description: "确保顶部状态条显示「已连接」(本地 127.0.0.1:18080 或你的远程服务)。",
			route: "/",
			autoCompletable: true,
			done: false,
		},
		{
			id: "login",
			title: "登录账号",
			description: "点击右上角登录,以获得规则库与审计等需授权的能力。",
			route: "/login",
			autoCompletable: false,
			done: false,
		},
		{
			id: "library",
			title: "建立知识库",
			description: "首次进入的 5 步向导会帮你建好第一个规则库(可跳过)。",
			route: "/",
			autoCompletable: true,
			done: false,
		},
		{
			id: "rule",
			title: "添加第一条规则",
			description: "在治理中心加一条业务规则,或用任务流向导 4 步跑通。",
			route: "/governance",
			autoCompletable: true,
			done: false,
		},
		{
			id: "execute",
			title: "在执行台跑一条命令",
			description: "进入工作台,发起一次执行,观察 evorule 的实时守护。",
			route: "/workbench",
			autoCompletable: true,
			done: false,
		},
		{
			id: "audit",
			title: "查看审计链",
			description: "打开审计记录,看到 BLAKE3 防篡改审计链即算跑通闭环。",
			route: "/audit",
			autoCompletable: true,
			done: false,
		},
	];
}

function defaultState(): OnboardingState {
	return {
		tour: { active: false, step: 0, completed: false, skipped: false },
		checklist: defaultChecklist(),
		bannerDismissed: false,
		hints: {},
	};
}

// ============================================================
// 持久化(对齐现有 store 约定)
// ============================================================

const STORAGE_KEY = "evorule-console-cloud:onboarding";

/** 把已存数据合并进默认结构,抵御字段缺失/旧 schema */
function mergeState(
	base: OnboardingState,
	raw: Partial<OnboardingState> | null | undefined
): OnboardingState {
	if (!raw) return base;
	const tour = raw.tour ?? base.tour;
	const checklistSeed = defaultChecklist();
	const savedChecklist = Array.isArray(raw.checklist) ? raw.checklist : [];
	// 以默认条目的顺序与文案为准,仅恢复 done 标记;新增条目天然补全
	const checklist = checklistSeed.map((item) => {
		const saved = savedChecklist.find((s) => s && s.id === item.id);
		return saved ? { ...item, done: saved.done === true } : item;
	});
	return {
		tour: {
			active: tour.active === true,
			step: typeof tour.step === "number" ? tour.step : 0,
			completed: tour.completed === true,
			skipped: tour.skipped === true,
		},
		checklist,
		bannerDismissed: raw.bannerDismissed === true,
		hints:
			raw.hints && typeof raw.hints === "object" ? (raw.hints as Record<string, string>) : {},
	};
}

function load(): OnboardingState {
	if (!browser) return defaultState();
	try {
		const rawStr = localStorage.getItem(STORAGE_KEY);
		if (!rawStr) return defaultState();
		return mergeState(defaultState(), JSON.parse(rawStr) as Partial<OnboardingState>);
	} catch {
		return defaultState();
	}
}

export const onboardingStore = writable<OnboardingState>(load());

onboardingStore.subscribe((s) => {
	if (!browser) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
	} catch {
		// 配额异常等:静默,不影响主流程
	}
});

// ============================================================
// Tour 状态机
// ============================================================

/** 启动 Tour(从第一步开始;不清除「已完成」记忆,仅标记 active) */
export function startTour(): void {
	onboardingStore.update((s) => ({
		...s,
		tour: { ...s.tour, active: true, step: 0, skipped: false },
	}));
}

/** 结束 Tour,标记为已完成 */
export function endTour(): void {
	onboardingStore.update((s) => ({
		...s,
		tour: { ...s.tour, active: false, completed: true },
	}));
}

/** 显式跳过 Tour(不再自动启动) */
export function skipTour(): void {
	onboardingStore.update((s) => ({
		...s,
		tour: { ...s.tour, active: false, skipped: true, completed: true },
	}));
}

/** 进入下一步;若已是最后一步则结束 */
export function nextTourStep(): void {
	onboardingStore.update((s) => {
		const last = TOUR_STEPS.length - 1;
		if (s.tour.step >= last) {
			return { ...s, tour: { ...s.tour, active: false, completed: true } };
		}
		return { ...s, tour: { ...s.tour, step: s.tour.step + 1 } };
	});
}

/** 上一步;已在第一步则不变 */
export function prevTourStep(): void {
	onboardingStore.update((s) => ({
		...s,
		tour: { ...s.tour, step: Math.max(0, s.tour.step - 1) },
	}));
}

/** 跳到指定步骤索引(越界则夹紧) */
export function goToTourStep(index: number): void {
	onboardingStore.update((s) => ({
		...s,
		tour: {
			...s.tour,
			step: Math.min(Math.max(0, index), TOUR_STEPS.length - 1),
		},
	}));
}

/** 当前步骤对象(供 UI 渲染,越界回退到第一步) */
export function currentTourStep() {
	const s = get(onboardingStore);
	return TOUR_STEPS[Math.min(s.tour.step, TOUR_STEPS.length - 1)] ?? TOUR_STEPS[0];
}

/**
 * 是否应自动启动 Tour(首启判定)。
 * 仅当既未完成也未跳过时返回 true;供首页 onMount 调用。
 */
export function shouldAutoStartTour(): boolean {
	const s = get(onboardingStore);
	return !s.tour.completed && !s.tour.skipped;
}

/** 重置 Tour 状态(用于设置「重新显示引导」) */
export function resetTour(): void {
	onboardingStore.update((s) => ({
		...s,
		tour: { active: false, step: 0, completed: false, skipped: false },
	}));
}

// ============================================================
// 上手清单
// ============================================================

/** 切换某条目完成态 */
export function toggleChecklistItem(id: string): void {
	onboardingStore.update((s) => ({
		...s,
		checklist: s.checklist.map((it) =>
			it.id === id ? { ...it, done: !it.done } : it
		),
	}));
}

/** 标记某条目完成(val 默认 true) */
export function completeChecklistItem(id: string, val = true): void {
	onboardingStore.update((s) => ({
		...s,
		checklist: s.checklist.map((it) =>
			it.id === id ? { ...it, done: val } : it
		),
	}));
}

/** 清单完成进度 { done, total } */
export function checklistProgress(): { done: number; total: number } {
	const s = get(onboardingStore);
	return {
		done: s.checklist.filter((it) => it.done).length,
		total: s.checklist.length,
	};
}

/** 清单是否已全部完成 */
export function isChecklistComplete(): boolean {
	const s = get(onboardingStore);
	return s.checklist.length > 0 && s.checklist.every((it) => it.done);
}

/** 重置清单为默认(全部未完成) */
export function resetChecklist(): void {
	onboardingStore.update((s) => ({
		...s,
		checklist: defaultChecklist(),
	}));
}

// ============================================================
// 首屏引导横幅(OnboardingBanner)
// ============================================================

/** 关闭横幅(不再自动显示) */
export function dismissBanner(): void {
	onboardingStore.update((s) => ({ ...s, bannerDismissed: true }));
}

/** 重置横幅(供设置「重新显示引导」调用,使横幅重新出现) */
export function resetBanner(): void {
	onboardingStore.update((s) => ({ ...s, bannerDismissed: false }));
}

/** 横幅当前是否应显示 */
export function shouldShowBanner(): boolean {
	return !get(onboardingStore).bannerDismissed;
}

// ============================================================
// 视图首访提示(GuidedHint)记忆
// ============================================================

/** 标记某视图首访提示已看过 */
export function markViewHintSeen(viewKey: string): void {
	onboardingStore.update((s) => ({
		...s,
		hints: { ...s.hints, [viewKey]: new Date().toISOString() },
	}));
}

/** 某视图首访提示是否已看过 */
export function isViewHintSeen(viewKey: string): boolean {
	return Boolean(get(onboardingStore).hints[viewKey]);
}

/** 重置所有视图首访提示记忆 */
export function resetViewHints(): void {
	onboardingStore.update((s) => ({ ...s, hints: {} }));
}

// ============================================================
// 总重置(调试 / 设置「重置全部引导」)
// ============================================================

/** 重置全部引导态到出厂默认 */
export function resetAllOnboarding(): void {
	onboardingStore.set(defaultState());
}
