// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud e2e — 导航 + 主题 + 联网徽标(大众版基础回归)
//
// 测试范围:
//   - 5 视图导航切换(回归内核一致行为)
//   - 设置 tab(大众版独有,Phase 6 加入,共 6 个 nav tab)
//   - 主题切换
//   - 连接徽标渲染
//   - 视图持久化
//   - 联网切换按钮(大众版独有,顶部徽标快捷切换;详细配置在 Settings 面板)
//
// 运行: npx playwright test tests/navigation.spec.ts

import { test, expect } from '@playwright/test';

// 5 个视图 tab(对齐内核 VIEW_LIST)
const VIEW_TABS = ['规则库', '执行台', '状态', '审计', '时间旅行'] as const;

const TAB_TO_H1: Record<string, string> = {
	'规则库': '规则库',
	'执行台': '执行台',
	'状态': '状态视图',
	'审计': '审计视图',
	'时间旅行': '时间旅行'
};

test.describe('evorule-console-cloud 导航 + 主题 + 联网徽标', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' });
		await page.evaluate(() => localStorage.clear());
		await page.reload({ waitUntil: 'networkidle' });
		await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/, {
			timeout: 10_000
		});
	});

	test('页面加载 + 顶部品牌可见(大众版标识)', async ({ page }) => {
		await expect(page.locator('.brand-name')).toHaveText('evorule-console-cloud');
		await expect(page.locator('.brand-tag')).toContainText('大众版');
		await expect(page.locator('.brand-tag')).toContainText('联网');
		await expect(page.locator('.brand-tag')).toContainText('云 LLM');
	});

	test('导航包含 6 个 tab(5 视图 + 设置),标签正确', async ({ page }) => {
		const tabs = page.locator('.nav-tab .tab-label');
		await expect(tabs).toHaveCount(6);
		// 前 5 个是视图 tab
		for (let i = 0; i < VIEW_TABS.length; i++) {
			await expect(tabs.nth(i)).toHaveText(VIEW_TABS[i]);
		}
		// 第 6 个是设置 tab
		await expect(tabs.nth(5)).toHaveText('设置');
	});

	test('设置 tab 有视觉分隔(大众版独有,不属于内核 5 视图)', async ({ page }) => {
		const settingsTab = page.locator('.nav-tab.settings-tab');
		await expect(settingsTab).toBeVisible();
		// 设置 tab 应有 settings-tab class(用于视觉分隔样式)
		await expect(settingsTab).toHaveClass(/settings-tab/);
	});

	test('默认视图是规则库(active + h1)', async ({ page }) => {
		const rulesTab = page.locator('.nav-tab', { hasText: '规则库' });
		await expect(rulesTab).toHaveAttribute('aria-pressed', 'true');
		await expect(page.locator('h1')).toHaveText('规则库');
	});

	for (const tab of VIEW_TABS) {
		test(`点击 "${tab}" tab → 切换到对应视图`, async ({ page }) => {
			await page.locator('.nav-tab', { hasText: tab }).click();
			const tabBtn = page.locator('.nav-tab', { hasText: tab });
			await expect(tabBtn).toHaveAttribute('aria-pressed', 'true');
			await expect(page.locator('h1', { hasText: TAB_TO_H1[tab] })).toBeVisible();
		});
	}

	test('点击设置 tab → 打开设置面板', async ({ page }) => {
		const settingsTab = page.locator('.nav-tab.settings-tab');
		await settingsTab.click();
		// 设置 tab 应变为 active
		await expect(settingsTab).toHaveAttribute('aria-pressed', 'true');
		// 设置面板应该出现(含 h1 "⚙️ 设置")
		await expect(page.locator('h1')).toHaveText('⚙️ 设置');
		// 应该有两个子 tab:联网配置 + LLM 配置
		await expect(page.locator('.settings-tab', { hasText: '联网配置' })).toBeVisible();
		await expect(page.locator('.settings-tab', { hasText: 'LLM 配置' })).toBeVisible();
	});

	test('设置面板有"返回"按钮 → 点击回到原视图', async ({ page }) => {
		// 先切到审计视图(避免回到默认规则库难分辨)
		await page.locator('.nav-tab', { hasText: '审计' }).click();
		await expect(page.locator('h1')).toHaveText('审计视图');

		// 打开设置
		await page.locator('.nav-tab.settings-tab').click();
		await expect(page.locator('h1')).toHaveText('⚙️ 设置');

		// 点击返回
		await page.locator('.btn-close').click();
		// 应回到审计视图(h1 恢复)
		await expect(page.locator('h1')).toHaveText('审计视图');
	});

	test('点击视图 tab 时关闭设置面板', async ({ page }) => {
		// 打开设置
		await page.locator('.nav-tab.settings-tab').click();
		await expect(page.locator('h1')).toHaveText('⚙️ 设置');

		// 点击规则库 tab(应触发关闭设置)
		await page.locator('.nav-tab', { hasText: '规则库' }).click();
		await expect(page.locator('h1')).toHaveText('规则库');
		// 设置 tab 应变为非 active
		await expect(page.locator('.nav-tab.settings-tab')).toHaveAttribute('aria-pressed', 'false');
	});

	test('同一时刻只有一个视图 tab active(不含设置)', async ({ page }) => {
		for (const tab of VIEW_TABS) {
			await page.locator('.nav-tab', { hasText: tab }).click();
			const activeCount = await page.locator('.nav-tab[aria-pressed="true"]').count();
			expect(activeCount).toBe(1);
		}
	});

	test('规则库视图离线可用 — 含 builtin 规则', async ({ page }) => {
		await expect(page.locator('h1')).toHaveText('规则库');
		await expect(
			page.getByText('set_basic', { exact: false }).first()
		).toBeVisible({ timeout: 5000 });
	});

	test('主题切换 — 点击切换 light/dark', async ({ page }) => {
		const html = page.locator('html');
		const toggle = page.locator('.theme-toggle');

		await expect(html).toHaveAttribute('data-theme', /.+/, { timeout: 5000 });
		const initialTheme = await html.getAttribute('data-theme');

		await toggle.click();
		await expect(html).toHaveAttribute(
			'data-theme',
			initialTheme === 'dark' ? 'light' : 'dark'
		);

		await toggle.click();
		await expect(html).toHaveAttribute('data-theme', initialTheme ?? 'light');
	});

	test('连接徽标渲染(检测中/已连接/未连接 三态之一)', async ({ page }) => {
		const badge = page.locator('.conn-badge');
		await expect(badge).toBeVisible();
		await expect(badge.locator('.conn-text')).toHaveText(/检测中|已连接|未连接/);
	});

	test('视图选择持久化 — 切到审计后刷新仍恢复审计', async ({ page }) => {
		await page.locator('.nav-tab', { hasText: '审计' }).click();
		await expect(page.locator('.nav-tab', { hasText: '审计' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await page.reload();
		await expect(
			page.locator('.nav-tab', { hasText: '审计' })
		).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
	});

	// === 大众版独有:联网切换按钮(顶部快捷按钮,详细配置在 Settings) ===

	test('联网切换按钮可见(默认 offline)', async ({ page }) => {
		const toggle = page.locator('.net-toggle');
		await expect(toggle).toBeVisible();
		await expect(toggle).toHaveClass(/offline/);
		await expect(toggle.locator('.net-text')).toHaveText('本地');
	});

	test('点击联网切换按钮 → 切到 online', async ({ page }) => {
		const toggle = page.locator('.net-toggle');
		await toggle.click();
		await expect(toggle).toHaveClass(/online/);
		await expect(toggle.locator('.net-text')).toHaveText('联网');
	});

	test('联网模式持久化 — 切到 online 后刷新仍 online', async ({ page }) => {
		await page.locator('.net-toggle').click();
		await expect(page.locator('.net-toggle')).toHaveClass(/online/);
		await page.reload();
		// 等待 hydration 完成
		await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/, { timeout: 10_000 });
		await expect(page.locator('.net-toggle')).toHaveClass(/online/);
	});
});
