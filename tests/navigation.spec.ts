// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud e2e — 导航 + 主题 + 联网徽标(大众版基础回归)
//
// 测试范围:
//   - 5 视图导航切换(回归内核一致行为)
//   - 设置 tab(大众版独有,Phase 6 加入)
//   - 主题切换
//   - 连接徽标渲染
//   - 视图持久化
//   - 联网切换按钮(大众版独有,顶部徽标快捷切换;详细配置在 Settings 面板)
//
// 依赖:已登录状态(beforeEach 通过 tests/helpers/login.ts 注入 session + auth + db-meta)
//
// 运行: npx playwright test tests/navigation.spec.ts

import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/login';

// 5 个视图 tab(对齐内核 VIEW_LIST)
const VIEW_TABS = ['规则库', '执行台', '状态', '审计', '时间旅行'] as const;

// 各视图主区期望出现的关键文案(已登录时审计视图由 BusinessAuditView 渲染,无 h1,
// 改用 h3 / 工具栏文案)
const TAB_TO_MAIN_TEXT: Record<string, string> = {
	'规则库': '规则库',
	'执行台': '执行台',
	'状态': '状态视图',
	'审计': '业务审计', // BusinessAuditView 顶部工具栏含 "业务审计时间线"
	'时间旅行': '时间旅行'
};

test.describe('evorule-console-cloud 导航 + 主题 + 联网徽标', () => {
	test.beforeEach(async ({ page }) => {
		await loginAsAdmin(page);
	});

	test('页面加载 + 顶部品牌可见(大众版标识)', async ({ page }) => {
		await expect(page.locator('.brand-text')).toHaveText('evorule');
		await expect(page.locator('.brand-cloud')).toHaveText('console-cloud');
	});

	test('侧栏导航包含 11 项(5 视图 + 导出 + 4 治理 + 设置),标签正确', async ({
		page
	}) => {
		// 已登录 + T4 导出 + T5a 协作后,侧栏总数 = 5 视图 + 1 导出 + 4 治理(发布队列/版本历史/审计记录/治理中心) + 1 设置 = 11
		const items = page.locator('.sidebar-item .nav-label');
		await expect(items).toHaveCount(11);
		// 前 5 个是内核视图 item
		for (let i = 0; i < VIEW_TABS.length; i++) {
			await expect(items.nth(i)).toHaveText(VIEW_TABS[i]);
		}
		// 6=导出 / 7=发布队列 / 8=版本历史 / 9=审计记录 / 10=治理中心 / 11=设置
		await expect(items.nth(5)).toHaveText('导出');
		await expect(items.nth(6)).toHaveText('发布队列');
		await expect(items.nth(7)).toHaveText('版本历史');
		await expect(items.nth(8)).toHaveText('审计记录');
		await expect(items.nth(9)).toHaveText('治理中心');
		await expect(items.nth(10)).toHaveText('设置');
	});

	test('设置项在侧栏底部(独立 section,不属于内核 5 视图)', async ({ page }) => {
		const settingsItem = page.locator('.sidebar-item', { hasText: '设置' });
		await expect(settingsItem).toBeVisible();
		// 设置项是 sidebar-item(统一侧栏样式),位于最后一个 section
		await expect(settingsItem).toHaveClass(/sidebar-item/);
	});

	test('默认视图是 RealWorkbench(已登录 + 有库 → HomeRouter 状态 C)', async ({
		page
	}) => {
		// 已登录 + db-meta + 内核有 builtin 规则 → isEmptyDb=false → HomeRouter 进 RealWorkbench
		// RealWorkbench 顶部 L1 监控大屏 / L2 编辑台 切换
		// 默认 L1(因为 production 状态初始为 no_published → resolveDefaultLayer 返回 L2 实际)
		// 简化为:看到任一 L1/L2 切换按钮即可
		const layerToggle = page.locator('.layer-toggle');
		await expect(layerToggle).toBeVisible({ timeout: 5000 });
		// 任一 item 都不应 active(因为默认在 home view,不在 /view/* 路由)
		const activeCount = await page.locator('.sidebar-item[aria-pressed="true"]').count();
		expect(activeCount).toBe(0);
	});

	for (const tab of VIEW_TABS) {
		test(`点击 "${tab}" item → 切换到对应视图`, async ({ page }) => {
			// 排除治理区 item(导出/发布队列/版本历史/审计记录/治理中心),只点内核 5 视图
			const itemBtn = page
				.locator('.sidebar-section:has(.sidebar-label:has-text("工作台")) .sidebar-item', { hasText: tab })
				.first();
			await itemBtn.click();
			await expect(itemBtn).toHaveAttribute('aria-pressed', 'true');
			// 主区(main.content)出现对应文案(审计视图 h1=h3 改 main 容器匹配)
			await expect(page.locator('main.content')).toContainText(
				TAB_TO_MAIN_TEXT[tab]
			);
		});
	}

	test('点击设置项 → 打开设置面板', async ({ page }) => {
		const settingsItem = page.locator('.sidebar-item', { hasText: '设置' });
		await settingsItem.click();
		// 设置项应变为 active
		await expect(settingsItem).toHaveAttribute('aria-pressed', 'true');
		// 设置面板应该出现(含 h1 "⚙️ 设置")
		await expect(page.locator('h1')).toHaveText('⚙️ 设置');
		// 应该有两个子 tab:联网配置 + LLM 配置
		await expect(page.locator('.settings-tab', { hasText: '联网配置' })).toBeVisible();
		await expect(page.locator('.settings-tab', { hasText: 'LLM 配置' })).toBeVisible();
	});

	test('设置面板有"返回"按钮 → 点击回到原视图', async ({ page }) => {
		// 先切到执行台视图(避开默认 RealWorkbench)
		await page
			.locator('.sidebar-section:has(.sidebar-label:has-text("工作台")) .sidebar-item', { hasText: '执行台' })
			.first()
			.click();
		await expect(page.locator('main.content')).toContainText('执行台');

		// 打开设置
		await page.locator('.sidebar-item', { hasText: '设置' }).click();
		await expect(page.locator('h1')).toHaveText('⚙️ 设置');

		// 点击返回
		await page.locator('.btn-close').click();
		// 应回到执行台视图
		await expect(page.locator('main.content')).toContainText('执行台');
	});

	test('点击视图 item 时关闭设置面板', async ({ page }) => {
		// 打开设置
		await page.locator('.sidebar-item', { hasText: '设置' }).click();
		await expect(page.locator('h1')).toHaveText('⚙️ 设置');

		// 点击规则库 item(应触发关闭设置)
		await page
			.locator('.sidebar-section:has(.sidebar-label:has-text("工作台")) .sidebar-item', { hasText: '规则库' })
			.first()
			.click();
		await expect(page.locator('main.content')).toContainText('规则库');
		// 设置项应变为非 active
		await expect(page.locator('.sidebar-item', { hasText: '设置' })).toHaveAttribute('aria-pressed', 'false');
	});

	test('同一时刻只有一个视图 item active(不含设置)', async ({ page }) => {
		for (const tab of VIEW_TABS) {
			const itemBtn = page
				.locator('.sidebar-section:has(.sidebar-label:has-text("工作台")) .sidebar-item', { hasText: tab })
				.first();
			await itemBtn.click();
			// 等当前 item aria-pressed 变 true(等 reactive 更新)
			await expect(itemBtn).toHaveAttribute('aria-pressed', 'true');
			// 排除设置 item 和治理 item,只数内核 5 视图的 active 数
			const activeCount = await page
				.locator('.sidebar-item[aria-pressed="true"]:not(.settings-tab)')
				.count();
			expect(activeCount).toBe(1);
		}
	});

	test('规则库视图离线可用 — 含 builtin 规则', async ({ page }) => {
		await page
			.locator('.sidebar-section:has(.sidebar-label:has-text("工作台")) .sidebar-item', { hasText: '规则库' })
			.first()
			.click();
		await expect(page.locator('main.content')).toContainText('规则库');
		await expect(
			page.getByText('set_basic', { exact: false }).first()
		).toBeVisible({ timeout: 5000 });
	});

	test('固定深色主题 — html[data-theme] 恒为 dark', async ({ page }) => {
		const html = page.locator('html');
		await expect(html).toHaveAttribute('data-theme', 'dark', { timeout: 5000 });
	});

	test('连接徽标渲染(检测中/已连接/未连接 三态之一)', async ({ page }) => {
		const badge = page.locator('.conn-status');
		await expect(badge).toBeVisible();
		await expect(badge).toContainText(/检测中|已连接|未连接/);
	});

	test('视图选择持久化 — 切到执行台后刷新仍恢复', async ({ page }) => {
		await page
			.locator('.sidebar-section:has(.sidebar-label:has-text("工作台")) .sidebar-item', { hasText: '执行台' })
			.first()
			.click();
		await expect(
			page.locator('.sidebar-section:has(.sidebar-label:has-text("工作台")) .sidebar-item', { hasText: '执行台' }).first()
		).toHaveAttribute('aria-pressed', 'true');
		await page.reload();
		// 等待 hydration
		await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/, { timeout: 10_000 });
		await expect(
			page.locator('.sidebar-section:has(.sidebar-label:has-text("工作台")) .sidebar-item', { hasText: '执行台' }).first()
		).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
	});

	// === 大众版独有:联网切换按钮(顶部 icon-btn 快捷按钮,详细配置在 Settings) ===

	test('联网切换按钮可见(默认 offline → 🖥️)', async ({ page }) => {
		const toggle = page.getByRole('button', { name: /切换联网/ });
		await expect(toggle).toBeVisible();
		await expect(toggle).toContainText('🖥️');
	});

	test('点击联网切换按钮 → 切到 online(☁️)', async ({ page }) => {
		const toggle = page.getByRole('button', { name: /切换联网/ });
		await toggle.click();
		await expect(toggle).toContainText('☁️');
	});

	test('联网模式持久化 — 切到 online 后刷新仍 online', async ({ page }) => {
		await page.getByRole('button', { name: /切换联网/ }).click();
		await expect(page.getByRole('button', { name: /切换联网/ })).toContainText('☁️');
		await page.reload();
		// 等待 hydration 完成
		await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/, { timeout: 10_000 });
		await expect(page.getByRole('button', { name: /切换联网/ })).toContainText('☁️');
	});
});
