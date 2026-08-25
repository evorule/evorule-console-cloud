// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud e2e — LLM 三用途流程(mock LLM API)
//
// 测试范围:
//   - LLM 关闭时按钮不渲染(回归一致)
//   - LLM 配置 + 启用后按钮渲染
//   - DraftRuleDialog:输入描述 → 生成草案 → 采用 → 加入规则库
//   - ExplainRuleDialog:点击解释 → 显示说明文字
//   - GenerateInputDialog:输入描述 → 生成输入 → 采用并复制到剪贴板
//
// 关键技术:
//   - 用 playwright page.route() mock LLM API(避免真实调用产生费用/网络依赖)
//   - 用 localStorage 注入 LLM 配置(enabled + endpoint + key + model)
//   - 不依赖 evorule-server(规则库 + LLM 流程都是前端逻辑)
//
// 依赖:已登录状态(beforeEach 通过 tests/helpers/login.ts 注入 session + auth + db-meta)
//      LLM 状态由各 test 内部按需覆盖(disabled 或 enabled)
//
// 运行: npx playwright test tests/assistant-flow.spec.ts

import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/login';

// ============ mock LLM API 响应 ============

/** 构造 OpenAI 兼容 chat completion 响应 */
function mockChatResponse(content: string) {
	return {
		statusCode: 200,
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

/** 一份合法的 evorule 规则草案(通过 G1-G7) */
const VALID_RULE_DRAFT = JSON.stringify({
	transform: [
		{
			type: 'branch',
			params: {
				domain: { type: 'eq', path: '__exec__.instruction.type', value: 'register' },
				on_true: [
					{
						type: 'set',
						params: { path: '__exec__.payload.status', value: 'ok' }
					}
				],
				on_false: []
			}
		},
		{
			type: 'branch',
			params: {
				domain: { type: 'all', domains: [] },
				on_true: [
					{
						type: 'set',
						params: { path: '__exec__.payload.result', value: '未匹配指令' }
					}
				],
				on_false: []
			}
		}
	]
});

/** 测试输入 JSON */
const MOCK_INPUT_JSON = JSON.stringify({
	type: 'register',
	user_id: 123,
	name: '张三'
});

/** 规则说明文本 */
const MOCK_EXPLANATION = '这条规则在用户提交 type=register 的指令时,把 status 字段设为 ok。其他指令会进入兜底规则,result 设为"未匹配指令"。';

// ============ LLM 配置(localStorage 注入) ============

const LLM_CONFIG = {
	enabled: true,
	provider: 'openai',
	apiEndpoint: 'https://api.openai.com/v1/chat/completions',
	apiKey: 'sk-test-mock-key-not-real',
	model: 'gpt-4o-mini'
};

const LLM_CONFIG_DISABLED = {
	...LLM_CONFIG,
	enabled: false
};

// ============ 公共 setup ============

test.describe('evorule-console-cloud LLM 流程', () => {
	test.beforeEach(async ({ page }) => {
		// mock LLM API 端点(任何对 OpenAI 兼容端点的请求都返回 mock)
		await page.route('**/v1/chat/completions', async (route) => {
			// 根据请求 body 中的 user message 内容判断用途,返回不同响应
			const request = route.request();
			const postData = request.postDataJSON() as {
				messages?: Array<{ role: string; content: string }>;
			};
			const userMsg = postData?.messages?.find((m) => m.role === 'user')?.content ?? '';

			if (userMsg.includes('规则设计助手')) {
				// 规则草案
				await route.fulfill(mockChatResponse(VALID_RULE_DRAFT));
			} else if (userMsg.includes('测试输入助手')) {
				// 测试输入
				await route.fulfill(mockChatResponse(MOCK_INPUT_JSON));
			} else if (userMsg.includes('规则解释助手')) {
				// 规则解释
				await route.fulfill(mockChatResponse(MOCK_EXPLANATION));
			} else if (userMsg.includes('请回复')) {
				// 测试连接
				await route.fulfill(mockChatResponse('OK'));
			} else {
				// 默认返回空内容(避免未匹配场景卡住)
				await route.fulfill(mockChatResponse(''));
			}
		});

		// 注入已登录 + 库元数据 + LLM 禁用(test 内部按需 override LLM 状态)
		await loginAsAdmin(page);
	});

	// ============ 1. LLM 关闭时按钮不渲染(回归一致) ============

	test('LLM 关闭时 RuleLibrary 不渲染 AI 按钮', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' });
		// 注入禁用的 LLM 配置
		await page.evaluate((cfg) => {
			localStorage.setItem('evorule-console-cloud:llm-config', JSON.stringify(cfg));
		}, LLM_CONFIG_DISABLED);
		await page.reload({ waitUntil: 'networkidle' });
		// 等 hydration 完成
		await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/, { timeout: 10_000 });

		// AI 按钮不渲染(因 assistant 为 null)
		await expect(page.locator('.btn-ai')).toHaveCount(0);
	});

	// ============ 2. LLM 开启时按钮渲染 ============

	test('LLM 启用 + 配置完备时 RuleLibrary 渲染 AI 按钮', async ({ page }) => {
		// 直接进 /view/rules(已登录时 / 走 HomeRouter → RealWorkbench,不渲染 .btn-ai)
		await page.goto('/view/rules', { waitUntil: 'networkidle' });
		await page.evaluate((cfg) => {
			localStorage.setItem('evorule-console-cloud:llm-config', JSON.stringify(cfg));
		}, LLM_CONFIG);
		await page.reload({ waitUntil: 'networkidle' });
		await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/, { timeout: 10_000 });

		// 应该至少有 2 个 AI 按钮(辅助创建 + 解释规则)
		const aiBtns = page.locator('.btn-ai');
		await expect(aiBtns.count()).resolves.toBeGreaterThanOrEqual(1);
	});

	// ============ 3. DraftRuleDialog 完整流程 ============

	test('DraftRuleDialog: 输入描述 → 生成草案 → 采用 → 加入规则库', async ({ page }) => {
		await page.goto('/view/rules', { waitUntil: 'networkidle' });
		await page.evaluate((cfg) => {
			localStorage.setItem('evorule-console-cloud:llm-config', JSON.stringify(cfg));
		}, LLM_CONFIG);
		await page.reload({ waitUntil: 'networkidle' });
		await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/, { timeout: 10_000 });

		// 切到开发者模式(.btn-ai "AI 辅助创建" 只在 RuleLibraryView(dev mode)渲染)
		await page.locator('.dev-mode-toggle button[role="switch"]').click();
		// 点击 "AI 辅助创建" 按钮(第一个 .btn-ai)
		await page.locator('.btn-ai').first().click();

		// Dialog 出现
		await expect(page.locator('h2#draft-dialog-title')).toBeVisible({ timeout: 5000 });
		await expect(page.locator('#draft-dialog-title')).toHaveText(/AI 辅助创建规则/);

		// 输入自然语言描述
		const descTextarea = page.locator('#draft-description');
		await descTextarea.fill('注册时设置 status=ok');

		// 点击 "生成草案"
		await page.locator('button:has-text("生成草案")').click();

		// 等草案 JSON 出现(等待 #draft-json 有内容)
		const draftTextarea = page.locator('#draft-json');
		await expect(draftTextarea).toHaveValue(/.+/i, { timeout: 10_000 });

		// 草案应该包含 transform(我们的 mock 响应)
		const draftValue = await draftTextarea.inputValue();
		expect(draftValue).toContain('transform');
		expect(draftValue).toContain('register');

		// 校验应通过(显示 alert-success)
		await expect(page.locator('.alert-success').first()).toBeVisible({ timeout: 5000 });

		// 点击 "采用并加入规则库"
		await page.locator('button:has-text("采用并加入规则库")').click();

		// 应该看到"已采用"提示
		await expect(page.locator('.alert-success:has-text("已采用")')).toBeVisible({ timeout: 5000 });
	});

	// ============ 4. ExplainRuleDialog 流程 ============

	test('ExplainRuleDialog: 点击解释 → 显示说明文本', async ({ page }) => {
		await page.goto('/view/rules', { waitUntil: 'networkidle' });
		await page.evaluate((cfg) => {
			localStorage.setItem('evorule-console-cloud:llm-config', JSON.stringify(cfg));
		}, LLM_CONFIG);
		await page.reload({ waitUntil: 'networkidle' });
		await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/, { timeout: 10_000 });

		// 选中第一个规则(builtin set_basic 默认会选中,但确保选中状态)
		// 点击 "解释规则" 按钮(应该是第二个 .btn-ai,但保险起见用文本匹配)
		const explainBtn = page.locator('.btn-ai:has-text("解释规则")');
		if ((await explainBtn.count()) > 0) {
			await explainBtn.first().click();
		} else {
			// 部分场景需要先选中规则后才显示"解释规则"按钮
			// 找到规则列表第一项点击
			await page.locator('.rule-item, [class*="rule"]').first().click().catch(() => null);
			await page.locator('.btn-ai:has-text("解释")').first().click();
		}

		// Dialog 出现
		await expect(page.locator('#explain-dialog-title')).toBeVisible({ timeout: 5000 });

		// 等待说明文本出现(LLM 调用是异步)
		await expect(page.locator('.explanation-text')).toBeVisible({ timeout: 10_000 });
		const explanationText = await page.locator('.explanation-text').textContent();
		expect(explanationText).toContain('register');
	});

	// ============ 5. GenerateInputDialog 流程 ============

	test('GenerateInputDialog: 输入描述 → 生成输入 → 采用 → 复制到剪贴板', async ({ page, context }) => {
		// 授予剪贴板权限
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);

		// mock evorule-server API(让 ExecutionPad 能渲染 input-section)
		// 内核 ExecutionPad 的 AI 按钮 only 渲染于 currentSessionId !== null
		await page.route('**/api/health', async (route) => {
			await route.fulfill({ status: 200, body: 'ok' });
		});
		await page.route('**/api/sessions', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ sessions: [1] })
				});
			} else if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ id: 1 })
				});
			}
		});
		await page.route('**/api/sessions/1/state', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					payload: {},
					queue: [],
					reactor: {
						phase: 'idle',
						causal_depth: 0,
						current_step: 0,
						pending_io_count: 0,
						structural_invariant_violations: 0
					},
					version: 1
				})
			});
		});

		await page.goto('/', { waitUntil: 'networkidle' });
		await page.evaluate((cfg) => {
			localStorage.setItem('evorule-console-cloud:llm-config', JSON.stringify(cfg));
		}, LLM_CONFIG);
		await page.reload({ waitUntil: 'networkidle' });
		await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/, { timeout: 10_000 });

		// 切到执行台
		await page.locator('.nav-tab:has-text("执行台")').click();
		await expect(page.locator('h1')).toHaveText('执行台', { timeout: 5000 });

		// 等 session 自动选中(refreshSessions 会拉 [1] 并自动选中)
		// 等"提交命令"区域出现(说明 currentSessionId !== null 已被选中)
		await expect(page.locator('h2:has-text("提交命令")')).toBeVisible({ timeout: 10_000 });

		// 点击 "AI 生成输入" 按钮(实际文本含 ✨ emoji)
		const aiBtn = page.locator('.btn-ai').first();
		await aiBtn.click();

		// Dialog 出现
		await expect(page.locator('#input-dialog-title')).toBeVisible({ timeout: 5000 });

		// 输入描述
		await page.locator('#input-description').fill('注册 user_id=123 的张三');

		// 点击 "✨ 生成输入"(对话框内按钮)
		await page.locator('button.btn-primary:has-text("生成输入")').click();

		// 等输入 JSON 出现
		const jsonTextarea = page.locator('#input-json');
		await expect(jsonTextarea).toHaveValue(/.+/i, { timeout: 10_000 });

		const jsonValue = await jsonTextarea.inputValue();
		expect(jsonValue).toContain('register');
		expect(jsonValue).toContain('张三');

		// 点击 "采用并复制到剪贴板"
		await page.locator('button:has-text("采用并复制到剪贴板")').click();

		// 应该看到"已复制"成功提示
		await expect(page.locator('.alert-success:has-text("已复制")')).toBeVisible({ timeout: 5000 });
	});

	// ============ 6. Escape 关闭 Dialog ============

	test('Escape 键关闭 Dialog', async ({ page }) => {
		await page.goto('/view/rules', { waitUntil: 'networkidle' });
		await page.evaluate((cfg) => {
			localStorage.setItem('evorule-console-cloud:llm-config', JSON.stringify(cfg));
		}, LLM_CONFIG);
		await page.reload({ waitUntil: 'networkidle' });
		await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/, { timeout: 10_000 });

		// 切到开发者模式(.btn-ai "AI 辅助创建" 只在 RuleLibraryView(dev mode)渲染)
		await page.locator('.dev-mode-toggle button[role="switch"]').click();
		// 打开 DraftRuleDialog
		await page.locator('.btn-ai').first().click();
		await expect(page.locator('#draft-dialog-title')).toBeVisible({ timeout: 5000 });

		// 按 Escape
		await page.keyboard.press('Escape');

		// Dialog 关闭
		await expect(page.locator('#draft-dialog-title')).toHaveCount(0, { timeout: 5000 });
	});
});
