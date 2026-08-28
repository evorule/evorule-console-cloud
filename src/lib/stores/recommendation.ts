// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// PR8 · 角色视图默认推荐（轻量推断 + 可手动覆盖）。
// 纯前端推断,基于「已登录 / 是否空库 / 规则数 / 审计权限 / 决策者模式」,
// 给出「下一步最该看的视图」,用户可一键覆盖或关闭(记忆于 localStorage)。
//
// 设计同 onboarding.ts:writable + browser 守卫 + 订阅时写回 localStorage。

import { writable, get } from "svelte/store";
import { browser } from "$app/environment";

/** 可被推荐的视图 */
export type RecommendedView =
	| "login"
	| "library"
	| "governance"
	| "execution"
	| "audit"
	| "workbench";

export interface Recommendation {
	view: RecommendedView;
	title: string;
	reason: string;
	/** CTA 跳转路由 */
	route: string;
}

/** 推断所需上下文(由各视图在渲染时传入) */
export interface RecContext {
	loggedIn: boolean;
	isEmptyDb: boolean;
	ruleCount: number;
	canAudit: boolean;
	isDecisionMaker: boolean;
}

/** 推荐视图 → 跳转路由 */
const ROUTE_MAP: Record<RecommendedView, string> = {
	login: "/login",
	library: "/",
	governance: "/governance",
	execution: "/view/execution",
	audit: "/audit",
	workbench: "/workbench",
};

/** 推荐视图 → 中文标签(供「换成」下拉使用) */
export const VIEW_LABELS: Record<RecommendedView, string> = {
	login: "登录",
	library: "建库向导",
	governance: "治理中心",
	execution: "执行台",
	audit: "审计记录",
	workbench: "工作台",
};

/**
 * 基于上下文的轻量推断。
 * 优先级:未登录 → 空库 → 审计角色 → 决策者 → 已有规则的执行台。
 */
export function inferRecommendation(ctx: RecContext): Recommendation {
	if (!ctx.loggedIn) {
		return {
			view: "login",
			title: "先登录账号",
			reason: "登录后可获得规则库、审计等需授权的能力。",
			route: ROUTE_MAP.login,
		};
	}
	if (ctx.isEmptyDb) {
		return {
			view: "library",
			title: "建立你的第一个规则库",
			reason: "还没有规则,先按向导建好第一个库(可跳过)。",
			route: ROUTE_MAP.library,
		};
	}
	if (ctx.canAudit) {
		return {
			view: "audit",
			title: "查看审计链",
			reason: "你是审计角色,先看 BLAKE3 不可篡改审计链与因果回溯。",
			route: ROUTE_MAP.audit,
		};
	}
	if (ctx.isDecisionMaker) {
		return {
			view: "workbench",
			title: "回到工作台总览",
			reason: "决策者模式,先看一屏全貌最省心。",
			route: ROUTE_MAP.workbench,
		};
	}
	return {
		view: "execution",
		title: "去执行台跑一条命令",
		reason: "已有规则,在执行台发起一次执行,看 evorule 如何实时守护。",
		route: ROUTE_MAP.execution,
	};
}

// ============================================================
// 用户覆盖 / 关闭记忆
// ============================================================

interface RecPref {
	/** 是否关闭了推荐(不再显示) */
	dismissed: boolean;
	/** 手动覆盖的视图(null 表示用自动推断) */
	override: RecommendedView | null;
}

const STORAGE_KEY = "evorule-console-cloud:recommendation";
const DEFAULT_PREF: RecPref = { dismissed: false, override: null };

function loadPref(): RecPref {
	if (!browser) return { ...DEFAULT_PREF };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULT_PREF };
		const p = JSON.parse(raw) as Partial<RecPref>;
		return {
			dismissed: p.dismissed === true,
			override: p.override ?? null,
		};
	} catch {
		return { ...DEFAULT_PREF };
	}
}

export const recommendationPref = writable<RecPref>(loadPref());

recommendationPref.subscribe((p) => {
	if (!browser) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
	} catch {
		// 配额/隐私模式:静默
	}
});

/** 关闭推荐(不再显示) */
export function dismissRecommendation(): void {
	recommendationPref.update((p) => ({ ...p, dismissed: true }));
}

/** 手动覆盖推荐视图 */
export function overrideRecommendation(view: RecommendedView): void {
	recommendationPref.update((p) => ({ ...p, override: view }));
}

/** 恢复自动推荐(清覆盖 + 取消关闭) */
export function resetRecommendation(): void {
	recommendationPref.set({ ...DEFAULT_PREF });
}

/**
 * 结合上下文与用户覆盖,得到最终推荐。
 * 关闭则返回 null(组件据此隐藏)。
 */
export function resolveRecommendation(ctx: RecContext): Recommendation | null {
	const pref = get(recommendationPref);
	if (pref.dismissed) return null;
	const base = inferRecommendation(ctx);
	if (pref.override && pref.override !== base.view) {
		return {
			view: pref.override,
			title: `已设为「${VIEW_LABELS[pref.override]}」`,
			reason: "你曾手动切换过推荐视图,可随时改回。",
			route: ROUTE_MAP[pref.override],
		};
	}
	return base;
}
