// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud e2e 共享 helper — 已登录 + 库元数据 + LLM 配置注入
//
// 为什么需要这个 helper:
//   1. 大众版 nav-tabs 在未登录时 .nav-tabs.hidden → display:none(+layout.svelte:155-158)
//      所有"点 tab 切视图"的测试都会失败
//   2. BusinessRuleLibrary / LLM 按钮 / OnboardingWizard 状态机都依赖 session.loggedIn=true
//   3. /audit 路由有 view_audit_chain 权限检查,需要 auth role=it 或 auditor
//
// localStorage keys(从源码 grep 出来,务必跟 store 同步):
//   - evorule-console-cloud:session  → Session { loggedIn, userId, username }
//   - evorule-console-cloud:auth     → User { id, username, role, displayName, ... }
//   - evorule-console-cloud:db-meta  → DbMeta { dbId, dbName, industry, businessObjects }
//   - evorule-console-cloud:llm-config → LLMConfig(可禁用,避免 .btn-ai 渲染)

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** 默认 mock 用户 — admin(IT 角色,最高权限,含 view_audit_chain) */
export const DEFAULT_USER = {
	id: 'u-admin',
	username: 'admin',
	displayName: '张主任',
	email: 'admin@evorule.demo',
	role: 'it' as const,
	department: '信息科',
	status: 'active' as const
};

/** 默认 db-meta — finance 行业,有 builtin 规则 + schema */
export const DEFAULT_DB_META = {
	dbId: 'default',
	dbName: '测试库',
	industry: 'finance',
	businessObjects: ['expense']
};

/**
 * 注入已登录会话 + 库 + LLM 禁用配置,然后 reload
 * 调用后页面应处于 RealWorkbench 或 OnboardingWizard(取决于 rules store 是否有 builtin)
 *
 * 副作用:
 *   - 清空 localStorage
 *   - 注入 4 个 key
 *   - reload 一次(等 svelte store 重新读取)
 *   - 等 html[data-theme] 出现(说明 hydration 完成)
 */
export async function loginAsAdmin(page: Page): Promise<void> {
	await page.goto('/', { waitUntil: 'networkidle' });
	await page.evaluate(
		({ user, dbMeta }) => {
			localStorage.clear();
			localStorage.setItem(
				'evorule-console-cloud:session',
				JSON.stringify({
					loggedIn: true,
					userId: user.id,
					username: user.username,
					loggedInAt: new Date().toISOString()
				})
			);
			localStorage.setItem(
				'evorule-console-cloud:auth',
				JSON.stringify(user)
			);
			localStorage.setItem(
				'evorule-console-cloud:db-meta',
				JSON.stringify(dbMeta)
			);
			// 禁用 LLM(避免 .btn-ai 渲染干扰需要"关闭时按钮不渲染"的测试)
			localStorage.setItem(
				'evorule-console-cloud:llm-config',
				JSON.stringify({
					enabled: false,
					provider: 'openai',
					apiEndpoint: 'https://api.openai.com/v1/chat/completions',
					apiKey: 'sk-test-mock',
					model: 'gpt-4o-mini'
				})
			);
			// 标记新手引导已完成(否则 TourOverlay 遮罩拦截所有指针事件,
			// Mavis 01 号 7e78180 引入;key 见 stores/onboarding.ts STORAGE_KEY)
			localStorage.setItem(
				'evorule-console-cloud:onboarding',
				JSON.stringify({
					tour: { active: false, step: 0, completed: true, skipped: false },
					checklist: [],
					bannerDismissed: true,
					hints: {}
				})
			);
		},
		{ user: DEFAULT_USER, dbMeta: DEFAULT_DB_META }
	);
	await page.reload({ waitUntil: 'networkidle' });
	await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/, {
		timeout: 10_000
	});
}

/**
 * 注入已登录 + LLM 启用配置(给 assistant-flow 用,需要 .btn-ai 渲染)
 */
export async function loginWithLlm(page: Page, llmConfig: object): Promise<void> {
	await page.goto('/', { waitUntil: 'networkidle' });
	await page.evaluate(
		({ user, dbMeta, llm }) => {
			localStorage.clear();
			localStorage.setItem(
				'evorule-console-cloud:session',
				JSON.stringify({
					loggedIn: true,
					userId: user.id,
					username: user.username,
					loggedInAt: new Date().toISOString()
				})
			);
			localStorage.setItem(
				'evorule-console-cloud:auth',
				JSON.stringify(user)
			);
			localStorage.setItem(
				'evorule-console-cloud:db-meta',
				JSON.stringify(dbMeta)
			);
			localStorage.setItem(
				'evorule-console-cloud:llm-config',
				JSON.stringify(llm)
			);
			// 标记新手引导已完成(同 loginAsAdmin,TourOverlay 遮罩会拦截点击)
			localStorage.setItem(
				'evorule-console-cloud:onboarding',
				JSON.stringify({
					tour: { active: false, step: 0, completed: true, skipped: false },
					checklist: [],
					bannerDismissed: true,
					hints: {}
				})
			);
		},
		{ user: DEFAULT_USER, dbMeta: DEFAULT_DB_META, llm: llmConfig }
	);
	await page.reload({ waitUntil: 'networkidle' });
	await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/, {
		timeout: 10_000
	});
}
