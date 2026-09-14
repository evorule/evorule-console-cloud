// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// WASM 在线模式浏览器兼容测试 — Chromium + Firefox。
//
// 场景(任务子任务3):
//   a. 打开 /?backend=wasm,确认引擎加载成功(无功能性 console error)
//   b. 创建会话并提交差旅 2000 -> allowed
//   c. 提交差旅 5000 -> blocked
//   d. 验证审计链 verifyAudit 返回 verified=true
//   e. Service Worker 已注册(navigator.serviceWorker.controller 非 null)
//
// 运行: npx playwright test --config playwright.wasm.config.ts
import { test, expect, type Page } from '@playwright/test';

/** 收集 console.error + pageerror(非致命警告放行) */
function collectConsoleErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});
	page.on('pageerror', (err) => errors.push(`pageerror: ${String(err)}`));
	return errors;
}

/** 已知非致命噪声白名单(离线/资源加载类,非 WASM 功能性错误) */
const KNOWN_NOISE: ReadonlyArray<RegExp> = [
	/^Failed to load resource:/,
	/^\[layout\] 规则库初始化失败/,
	/favicon/,
	/Loading.*failed.*service-worker/i
];

function assertNoFunctionalErrors(errors: string[], label: string): void {
	const unexpected = errors.filter((e) => !KNOWN_NOISE.some((re) => re.test(e)));
	expect(unexpected, `functional console errors on ${label}:\n${unexpected.join('\n')}`).toEqual([]);
}

test.describe('WASM 在线模式浏览器兼容', () => {
	test.describe.configure({ mode: 'serial' });
	let errors: string[] = [];

	/**
	 * 免登录进入 DemoHome(HomeRouter:未登录 -> 模式 A -> DemoHome -> GuidedTasks -> WasmTour)。
	 * 仅屏蔽 onboarding 遮罩 + 禁用 LLM,不写登录态(WASM 引擎本地自足)。
	 */
	async function gotoWasmDemo(page: Page): Promise<void> {
		const URL = '/?backend=wasm';
		await page.goto(URL, { waitUntil: 'networkidle' });
		await page.evaluate(() => {
			localStorage.clear();
			localStorage.setItem(
				'evorule-console-cloud:llm-config',
				JSON.stringify({ enabled: false, provider: 'openai', apiEndpoint: '', apiKey: '', model: '' })
			);
			localStorage.setItem(
				'evorule-console-cloud:onboarding',
				JSON.stringify({ tour: { active: false, step: 0, completed: true, skipped: true }, checklist: [], bannerDismissed: true, hints: {} })
			);
		});
		await page.goto(URL, { waitUntil: 'networkidle' });
	}

	test('a-e: 引擎加载 / allowed / blocked / 审计验证 / SW 注册', async ({ page }) => {
		errors = collectConsoleErrors(page);
		await gotoWasmDemo(page);

		// WasmTour 挂载,且第 1 步自动体检完成 -> 引擎就绪
		await expect(page.locator('.wasm-tour').first()).toBeVisible({ timeout: 15_000 });
		await expect(page.locator('.wt-step').filter({ hasText: '引擎就绪' }).first()).toContainText(
			/引擎就绪|16 条业务规则/,
			{ timeout: 15_000 }
		);

		// (b) 跑一条放行指令(差旅 2000 -> allowed)
		const runBtn = page.locator('button.wt-btn', { hasText: '运行指令' }).first();
		await expect(runBtn).toBeVisible({ timeout: 10_000 });
		await runBtn.click();
		await expect(page.locator('.wt-step-feedback.ok').first()).toContainText(/allowed|放行/, {
			timeout: 10_000
		});

		// (c) 跑一条阻断指令(差旅 5000 -> blocked)
		const runBtn2 = page.locator('button.wt-btn', { hasText: '运行指令' }).first();
		await runBtn2.click();
		await expect(page.locator('.wt-step-feedback.ok').first()).toContainText(/blocked|阻断/, {
			timeout: 10_000
		});

		// (d) 验证审计链
		const verifyBtn = page.locator('button.wt-btn', { hasText: '验证审计链' }).first();
		await verifyBtn.click();
		await expect(page.locator('.wt-step-feedback.ok').first()).toContainText(/验证通过|未发现篡改/, {
			timeout: 10_000
		});

		// (e) Service Worker 已注册(controller 非 null)
		await page.waitForTimeout(500);
		const swActive = await page.evaluate(() => {
			return !!(navigator.serviceWorker && navigator.serviceWorker.controller);
		});

		await page.waitForTimeout(500);
		assertNoFunctionalErrors(errors, '/?backend=wasm');

		// SW 注册断言单独给出(避免被上面收集噪声掩盖)
		expect(swActive, 'Service Worker controller should be active').toBeTruthy();
	});
});
