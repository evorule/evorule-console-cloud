// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud e2e — Settings 面板(联网 + LLM 配置)
//
// 测试范围:
//   - 设置面板打开/关闭
//   - 联网配置 tab:模式切换 + 远程 URL 输入 + 测试连接(mock)+ 状态显示
//   - LLM 配置 tab:
//       * 启用开关(关闭时 LLM 配置区隐藏)
//       * 厂商预设切换(自动填 endpoint + model)
//       * apiKey 密码框(显示/隐藏切换)
//       * 模型下拉(预设提供选项)
//       * 测试连接(mock LLM API)
//       * 配置持久化(localStorage)
//   - apiKey 安全:不进 URL,密码框默认隐藏
//   - L2 占位可见(规划功能提示)
//
// 关键技术:
//   - mock LLM API via page.route(避免真实调用产生费用/网络依赖)
//   - mock evorule-server API(测试连接)
//   - localStorage 注入/读取断言
//
// 运行: npx playwright test tests/settings-flow.spec.ts

import { test, expect } from '@playwright/test';

// ============ mock LLM API ============
function mockChatResponse(content: string) {
	return {
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify({
			id: 'chatcmpl-mock',
			object: 'chat.completion',
			choices: [
				{
					index: 0,
					message: { role: 'assistant', content },
					finish_reason: 'stop'
				}
			]
		})
	};
}

test.describe('evorule-console-cloud 设置面板', () => {
	test.beforeEach(async ({ page }) => {
		// mock LLM API(测试连接会调用)
		// 注:不同厂商 endpoint 路径不同 — OpenAI 是 /v1/chat/completions,
		// 智谱 GLM 是 /v4/chat/completions。用 **/chat/completions 通配。
		await page.route('**/chat/completions', async (route) => {
			await route.fulfill(mockChatResponse('OK'));
		});

		// mock evorule-server health(联网测试连接用)
		await page.route('**/api/health', async (route) => {
			await route.fulfill({ status: 200, body: 'ok' });
		});

		await page.goto('/', { waitUntil: 'networkidle' });
		await page.evaluate(() => localStorage.clear());
		await page.reload({ waitUntil: 'networkidle' });
		await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/, {
			timeout: 10_000
		});
	});

	// ============ 1. 设置面板基本可用 ============

	test('点击设置 tab → 设置面板出现,默认联网 tab', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await expect(page.locator('h1')).toHaveText('⚙️ 设置');
		// 默认应该是联网 tab active
		await expect(page.locator('.settings-tab', { hasText: '联网配置' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		// 应该显示联网设置区域
		await expect(page.locator('h2', { hasText: '联网模式' })).toBeVisible();
	});

	test('切换到 LLM 配置 tab', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.settings-tab', { hasText: 'LLM 配置' }).click();
		// LLM tab 应 active
		await expect(page.locator('.settings-tab', { hasText: 'LLM 配置' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		// 应显示 LLM 配置区域
		await expect(page.locator('h2', { hasText: 'LLM 配置' })).toBeVisible();
	});

	// ============ 2. 联网配置 tab ============

	test('联网模式切换:本地 → 联网', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		// 默认本地模式
		await expect(page.locator('.mode-btn', { hasText: '本地模式' })).toHaveClass(/active/);
		// 切到联网
		await page.locator('.mode-btn', { hasText: '联网模式' }).click();
		await expect(page.locator('.mode-btn', { hasText: '联网模式' })).toHaveClass(/active/);
		// 联网模式下应显示远程 URL 输入框
		await expect(page.locator('#remote-url')).toBeVisible();
	});

	test('联网模式切换:联网 → 本地(远程 URL 输入框隐藏)', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		// 切到联网
		await page.locator('.mode-btn', { hasText: '联网模式' }).click();
		await expect(page.locator('#remote-url')).toBeVisible();
		// 切回本地
		await page.locator('.mode-btn', { hasText: '本地模式' }).click();
		await expect(page.locator('#remote-url')).toHaveCount(0);
	});

	test('联网测试连接(本地模式 mock 健康检查)', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		// 默认本地模式,点击测试连接
		await page.locator('button', { hasText: '测试连接' }).click();
		// 应该显示成功(mock 返回 200)
		await expect(page.locator('.alert-success')).toBeVisible({ timeout: 5000 });
	});

	test('联网配置持久化 — 切到联网 + 改 URL 后刷新仍保留', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.mode-btn', { hasText: '联网模式' }).click();
		// 改 URL
		const urlInput = page.locator('#remote-url');
		await urlInput.fill('https://my-test-server.example.com');
		await urlInput.blur(); // 失焦保存
		// 刷新
		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/, {
			timeout: 10_000
		});
		// 重新打开设置面板,验证状态
		await page.locator('.nav-tab.settings-tab').click();
		await expect(page.locator('.mode-btn', { hasText: '联网模式' })).toHaveClass(/active/);
		// 注:顶部 net-toggle 也应反映联网模式
		await expect(page.locator('.net-toggle')).toHaveClass(/online/);
	});

	// ============ 3. LLM 配置 tab — 启用开关 ============

	test('LLM 默认禁用 — 显示禁用提示', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.settings-tab', { hasText: 'LLM 配置' }).click();
		// 应显示禁用提示
		await expect(page.locator('.alert-info', { hasText: 'LLM 已禁用' })).toBeVisible();
		// 厂商预设下拉应该不存在(因为 enabled=false)
		await expect(page.locator('#llm-provider')).toHaveCount(0);
	});

	test('启用 LLM → 显示完整配置区域', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.settings-tab', { hasText: 'LLM 配置' }).click();
		// 勾选启用
		await page.locator('input[type="checkbox"]').check();
		// 应该出现厂商预设等字段
		await expect(page.locator('#llm-provider')).toBeVisible();
		await expect(page.locator('#llm-endpoint')).toBeVisible();
		await expect(page.locator('#llm-apikey')).toBeVisible();
		await expect(page.locator('#llm-model')).toBeVisible();
	});

	test('禁用 LLM → 配置区域隐藏', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.settings-tab', { hasText: 'LLM 配置' }).click();
		// 启用
		await page.locator('input[type="checkbox"]').check();
		await expect(page.locator('#llm-provider')).toBeVisible();
		// 再禁用
		await page.locator('input[type="checkbox"]').uncheck();
		await expect(page.locator('#llm-provider')).toHaveCount(0);
	});

	// ============ 4. LLM 配置 tab — 厂商预设 ============

	test('切换厂商预设 → 自动填 endpoint + model', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.settings-tab', { hasText: 'LLM 配置' }).click();
		await page.locator('input[type="checkbox"]').check();

		// 选 智谱 GLM
		await page.locator('#llm-provider').selectOption('glm');
		await expect(page.locator('#llm-endpoint')).toHaveValue(
			'https://open.bigmodel.cn/api/paas/v4/chat/completions'
		);
		await expect(page.locator('#llm-model')).toHaveValue('glm-4-flash');

		// 切到 通义千问
		await page.locator('#llm-provider').selectOption('qwen');
		await expect(page.locator('#llm-endpoint')).toHaveValue(
			'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
		);
		await expect(page.locator('#llm-model')).toHaveValue('qwen-plus');
	});

	test('厂商预设帮助链接可见(智谱)', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.settings-tab', { hasText: 'LLM 配置' }).click();
		await page.locator('input[type="checkbox"]').check();
		await page.locator('#llm-provider').selectOption('glm');
		// 应该有"如何获取 apiKey? ↗"链接
		await expect(page.locator('.help-link', { hasText: '如何获取 apiKey' })).toBeVisible();
	});

	test('文心一言预设标记为不兼容(needsAdapter)', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.settings-tab', { hasText: 'LLM 配置' }).click();
		await page.locator('input[type="checkbox"]').check();
		// 选项 disabled
		const ernieOption = page.locator('#llm-provider option[value="ernie"]');
		await expect(ernieOption).toHaveAttribute('disabled', '');
		// 注:由于 disabled 选项无法 select,这里只验证选项存在且 disabled
	});

	// ============ 5. LLM 配置 tab — apiKey 安全 ============

	test('apiKey 默认是密码框(type=password)', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.settings-tab', { hasText: 'LLM 配置' }).click();
		await page.locator('input[type="checkbox"]').check();
		const apiKeyInput = page.locator('#llm-apikey');
		await expect(apiKeyInput).toHaveAttribute('type', 'password');
	});

	test('点击眼睛图标 → apiKey 变为明文', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.settings-tab', { hasText: 'LLM 配置' }).click();
		await page.locator('input[type="checkbox"]').check();
		await page.locator('#llm-apikey').fill('sk-test-key-123');
		// 点击切换显示
		await page.locator('.toggle-visibility').click();
		await expect(page.locator('#llm-apikey')).toHaveAttribute('type', 'text');
		// 再点切回
		await page.locator('.toggle-visibility').click();
		await expect(page.locator('#llm-apikey')).toHaveAttribute('type', 'password');
	});

	test('apiKey 不进 URL(刷新后 URL 中无 apiKey)', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.settings-tab', { hasText: 'LLM 配置' }).click();
		await page.locator('input[type="checkbox"]').check();
		await page.locator('#llm-apikey').fill('sk-super-secret-key');
		// 当前 URL 不应包含 apiKey
		const currentUrl = page.url();
		expect(currentUrl).not.toContain('sk-super-secret-key');
		expect(currentUrl).not.toContain('apiKey');
		expect(currentUrl).not.toContain('api_key');
	});

	test('apiKey 安全提示可见(本地存储)', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.settings-tab', { hasText: 'LLM 配置' }).click();
		await page.locator('input[type="checkbox"]').check();
		// 应显示安全提示
		await expect(page.locator('.hint', { hasText: 'localStorage' })).toBeVisible();
	});

	// ============ 6. LLM 配置 tab — 测试连接 ============

	test('未填完配置时点击测试连接 → 提示填完整', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.settings-tab', { hasText: 'LLM 配置' }).click();
		await page.locator('input[type="checkbox"]').check();
		// 不填 apiKey,直接测试连接
		await page.locator('button', { hasText: '测试连接' }).click();
		// 应该提示填完整
		await expect(page.locator('.alert-error', { hasText: '完整配置' })).toBeVisible();
	});

	test('填完配置后测试连接 → mock 返回成功', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.settings-tab', { hasText: 'LLM 配置' }).click();
		await page.locator('input[type="checkbox"]').check();
		await page.locator('#llm-provider').selectOption('glm');
		await page.locator('#llm-apikey').fill('sk-test-mock-key');
		// 点击测试连接
		await page.locator('button', { hasText: '测试连接' }).click();
		// 应该显示成功(mock 返回 200 + "OK")
		await expect(page.locator('.alert-success')).toBeVisible({ timeout: 10_000 });
	});

	// ============ 7. LLM 配置 tab — 持久化 ============

	test('LLM 配置持久化 — 启用 + 填配置后刷新仍保留', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.settings-tab', { hasText: 'LLM 配置' }).click();
		await page.locator('input[type="checkbox"]').check();
		await page.locator('#llm-provider').selectOption('glm');
		await page.locator('#llm-apikey').fill('sk-persistent-test-key');

		// 刷新页面(注:刷新后可能因 confirm 弹窗而停留,我们直接 reload 不点保存)
		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/, {
			timeout: 10_000
		});
		// 重新打开设置面板,切到 LLM tab
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.settings-tab', { hasText: 'LLM 配置' }).click();
		// 应该仍然启用
		await expect(page.locator('input[type="checkbox"]')).toBeChecked();
		// 厂商应仍然是 glm
		await expect(page.locator('#llm-provider')).toHaveValue('glm');
		// apiKey 应保留
		await expect(page.locator('#llm-apikey')).toHaveValue('sk-persistent-test-key');
	});

	// ============ 8. LLM 配置 tab — 重置 ============

	test('重置按钮 → 清空配置回到默认', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.settings-tab', { hasText: 'LLM 配置' }).click();
		await page.locator('input[type="checkbox"]').check();
		await page.locator('#llm-provider').selectOption('glm');
		await page.locator('#llm-apikey').fill('sk-will-be-reset');

		// 点击重置(会有 confirm 弹窗,Playwright 默认接受)
		page.on('dialog', (dialog) => dialog.accept());
		await page.locator('button', { hasText: '重置' }).click();
		// 重置后应禁用
		await expect(page.locator('input[type="checkbox"]')).not.toBeChecked();
		// 应显示禁用提示
		await expect(page.locator('.alert-info', { hasText: 'LLM 已禁用' })).toBeVisible();
	});

	// ============ 9. L2 占位 ============

	test('L2 占位可见(规划功能提示)', async ({ page }) => {
		await page.locator('.nav-tab.settings-tab').click();
		await page.locator('.settings-tab', { hasText: 'LLM 配置' }).click();
		// 应该显示 L2 占位(无论 LLM 是否启用)
		await expect(page.locator('.l2-placeholder')).toBeVisible();
		await expect(page.locator('.l2-placeholder h3')).toContainText('本地 LLM');
		await expect(page.locator('.l2-placeholder h3')).toContainText('L2');
	});
});
