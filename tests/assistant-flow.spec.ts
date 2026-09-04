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
//   - LLM 三方法走审计桥(callChatApiAudited):需 evorule-server 在
//     18080 运行 —— 侧车会话 + SSE + call_external 命令 + io_response
//     (与 scripts/validate-audit-bridge.mjs 同链路);server 不可达时
//     审计桥如实报错(无静默直连兜底)
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

		// UV-067 适配:开发者模式已是占位视图(内核 RuleLibraryView 随 v0.2.0 弃用),
		// "🤖 AI 起草规则" 按钮在业务模式头部渲染(第一个 .btn-ai)
		await page.locator('.btn-ai').first().click();

		// Dialog 出现
		await expect(page.locator('h2#draft-dialog-title')).toBeVisible({ timeout: 5000 });
		await expect(page.locator('#draft-dialog-title')).toHaveText(/AI 辅助创建规则/);

		// 输入自然语言描述
		const descTextarea = page.locator('#draft-description');
		await descTextarea.fill('注册时设置 status=ok');

		// 点击 "生成草案"(LLM 调用走审计桥:server 创建侧车会话 + SSE,
		// 浏览器本地执行 LLM(page.route mock),结果回写 io_response)
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

		// 点击 "采用并加入规则库"(addRule → server workspace)
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

		// UV-067 适配:refreshRules 虽自动选中第一条规则,但 content 懒加载只在
		// 点击卡片(selectRule)时触发 —— ExplainRuleDialog 需要 rule.content,
		// 未加载会报"规则内容未加载,无法解释"。先点第一张规则卡片并等版本拉取完成。
		const versionsLoaded = page.waitForResponse(
			(r) => r.url().includes('/versions') && r.request().method() === 'GET'
		);
		await page.locator('.rule-card').first().click();
		await versionsLoaded;

		// 点击规则详情面板的 "✨ LLM 解释" 按钮(业务模式,选中规则后渲染)
		await page.locator('.btn-ai:has-text("LLM 解释")').first().click();

		// Dialog 出现(挂载即自动触发解释,LLM 走审计桥 + mock)
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

		// UV-067 适配:不再 mock /api/sessions —— 旧 mock 的 POST 响应形状({id:1})
		// 与审计桥协议不符(需 {session_id}),导致"create_session 失败(HTTP 200)"。
		// 现改走真实 evorule-server:LLM 审计桥自建侧车会话(create_session → SSE →
		// call_external → io_response),与 validate-audit-bridge.mjs 同链路;
		// 唯一 mock 是 LLM 端点(beforeEach 的 page.route)。

		// 直接进入执行台(内核 ExecutionPad 的 AI 按钮 only 渲染于 currentSessionId !== null)
		await page.goto('/view/execution', { waitUntil: 'networkidle' });
		await page.evaluate((cfg) => {
			localStorage.setItem('evorule-console-cloud:llm-config', JSON.stringify(cfg));
		}, LLM_CONFIG);
		await page.reload({ waitUntil: 'networkidle' });
		await expect(page.locator('h1')).toHaveText('执行台', { timeout: 5000 });

		// 点击 "+ 新建" 创建真实 session(refreshSessions 自动选中 → AI 按钮渲染)
		await page.locator('button:has-text("+ 新建")').click();
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

		// UV-067 适配:开发者模式已是占位视图(无 .btn-ai),
		// 业务模式头部 "🤖 AI 起草规则" 打开 DraftRuleDialog
		await page.locator('.btn-ai').first().click();
		await expect(page.locator('#draft-dialog-title')).toBeVisible({ timeout: 5000 });

		// 按 Escape
		await page.keyboard.press('Escape');

		// Dialog 关闭
		await expect(page.locator('#draft-dialog-title')).toHaveCount(0, { timeout: 5000 });
	});
});
