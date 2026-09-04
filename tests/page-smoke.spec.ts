// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud e2e — UV-078 W1-E1 page-smoke 骨架(13 路由零功能覆盖补口)
//
// 目的(45 号方案 §E 组):每条路由 goto + 核心元素可见 + 零 console error,一次覆盖
// 13 条无 e2e 功能覆盖的路由;此后每个修复项 DoD 强制含 e2e 锚定。
//
// 路由清单与断言锚点(选择器用稳定 class;标题元素无 class 的用标签+可见性,
// 交互类断言禁文本匹配 —— UV-067 选择器漂移教训):
//   登录态(it,自由可达 10):/monitor /help /export /import-export /marketplace
//     /governance /publish-queue /version-history /view/state /view/timetravel
//   守卫路由(it 无权限,2):/users /roles —— W1-A1 的 e2e 锚定:
//     307 弹回 / + toast「权限不足」引导(不再静默弹回)
//   未登录(1):/login
//
// console error 断言:收集 msg.type()==='error' + pageerror(unhandled rejection)。
// e2e 环境不启 evorule-server(:18080)/治理(:18081),后端不可达走各自 catch 路径
// (conn-card / EmptyState / 离线徽标),预期不产生 console error —— 这正是
// "离线降级不静默崩"的护城河断言。
//
// 运行: npx playwright test tests/page-smoke.spec.ts

import { test, expect, type Page } from '@playwright/test';
import { loginAsAdmin } from './helpers/login';

/** 收集 console error + 未捕获异常(每用例独立数组,test 结束时断言为空) */
function collectConsoleErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});
	page.on('pageerror', (err) => errors.push(`pageerror: ${String(err)}`));
	return errors;
}

/**
 * 网络面 mock:abort 所有后端 API 请求(18080 evorule-server / 18081 rule-serve)。
 *
 * 为什么必须 mock(2026-09-04 首跑取证):
 *   开发机上常驻真实 server 时,page-smoke 会受其状态污染 —— 实测本机 server 的
 *   production_state.current_session_id=1(bootstrap 幻影值) 而 sessions 列表为空,
 *   MonitorDashboard 忠实轮询 session 1 → 4 个 404 console error(server 侧状态
 *   不一致,已登记台账;非前端缺陷)。
 *   mock 为"无后端"后,页面走离线降级路径(conn-card / EmptyState / 离线徽标),
 *   与 CI 干净环境同语义,测试确定性。
 *
 * 分层边界:page-smoke 只验渲染冒烟(路由可达 + 核心元素 + 无运行时崩溃);
 * API 契约(路径/形态防漂移)由 UV-068 补的 openapi 防漂移契约测试守护。
 */
async function mockBackendOffline(page: Page): Promise<void> {
	await page.route('**/api/**', (route) => route.abort());
}

/**
 * 已知离线噪声白名单(e2e 故意 abort 网络面时必然出现,非前端缺陷):
 *   1. /^Failed to load resource:/ —— 浏览器对网络不可达/abort 的固有 console 报告,
 *      恰是"后端不可达被如实记录"的证据(而非静默);API 路径/形态契约由 UV-068
 *      防漂移契约测试单独守护,不在本层重复。
 *   2. /^\[layout\] 规则库初始化失败/ —— 布局 bootstrap 的显式降级日志,
 *      页面同步呈现"请检查 evorule-server 是否已启动"引导(用户可见,非静默吞错)。
 * 其余任何 console error / pageerror(JS 运行时崩溃、渲染异常)都视为失败。
 */
const KNOWN_OFFLINE_NOISE: ReadonlyArray<RegExp> = [
	/^Failed to load resource:/,
	/^\[layout\] 规则库初始化失败/
];

/** 断言无"预期外"console error(白名单外的都算失败) */
function assertNoUnexpectedErrors(errors: string[], path: string): void {
	const unexpected = errors.filter((e) => !KNOWN_OFFLINE_NOISE.some((re) => re.test(e)));
	expect(
		unexpected,
		`unexpected console errors on ${path}:\n${unexpected.join('\n')}`
	).toEqual([]);
}

/** 断言缓冲:元素可见后等一小段,让异步轮询/加载的潜在错误浮出再收口 */
const SETTLE_MS = 600;

// 登录态(it)自由路由:goto + 核心元素可见 + 零 console error
const SMOKE_ROUTES: ReadonlyArray<{ path: string; anchor: string; desc: string }> = [
	{ path: '/monitor', anchor: '.monitor-dashboard', desc: 'L1 监控大屏' },
	{ path: '/help', anchor: 'h1.help-title', desc: '帮助页' },
	{ path: '/export', anchor: '.export-center', desc: '导出中心' },
	{ path: '/import-export', anchor: 'h1.ie-title', desc: '导入/导出/模板市场 3-Tab 中心' },
	{ path: '/marketplace', anchor: 'h1.mp-title', desc: '模板市场' },
	{ path: '/governance', anchor: '.conn-card', desc: '治理中心(未连接面板)' },
	{ path: '/publish-queue', anchor: 'section.publish-queue', desc: '发布队列' },
	{ path: '/version-history', anchor: 'section.version-history', desc: '版本历史' },
	{ path: '/view/state', anchor: '.empty-state', desc: '状态视图(无 session 空态)' },
	{ path: '/view/timetravel', anchor: 'h2.btt-title', desc: '业务时间旅行(无 session 空态)' }
];

test.describe('page-smoke:14 路由 goto + 核心元素 + 零 console error', () => {
	test.describe.configure({ mode: 'serial' });

	for (const { path, anchor, desc } of SMOKE_ROUTES) {
		test(`[${path}] ${desc} 渲染且零 console error`, async ({ page }) => {
			const errors = collectConsoleErrors(page);
			await loginAsAdmin(page);
			await mockBackendOffline(page);
			await page.goto(path);
			await expect(page.locator(anchor).first()).toBeVisible({ timeout: 10_000 });
			await page.waitForTimeout(SETTLE_MS);
			assertNoUnexpectedErrors(errors, path);
		});
	}

	// W1-A1 e2e 锚定:it 角色直连 /users /roles → toast 引导 + 307 弹回 /(不再静默)
	for (const path of ['/users', '/roles']) {
		test(`[${path}] 权限不足 → toast 引导 + 弹回首页(it 无平台管理权限)`, async ({ page }) => {
			const errors = collectConsoleErrors(page);
			await loginAsAdmin(page);
			await mockBackendOffline(page);
			await page.goto(path);
			// 307 弹回 / (+layout.ts 守卫)
			await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
			// toast「权限不足」引导(W1-A1:静默弹回 → 显式提示)
			await expect(page.locator('.toast-title').first()).toHaveText('权限不足', { timeout: 5_000 });
			await page.waitForTimeout(SETTLE_MS);
			assertNoUnexpectedErrors(errors, path);
		});
	}
});

test.describe('page-smoke:未登录路由', () => {
	test('[/login] 登录页渲染且零 console error', async ({ page }) => {
		const errors = collectConsoleErrors(page);
		await page.goto('/login');
		await expect(page.locator('section.login-page')).toBeVisible({ timeout: 10_000 });
		await page.waitForTimeout(SETTLE_MS);
		assertNoUnexpectedErrors(errors, '/login');
	});
});
