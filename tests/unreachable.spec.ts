// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// 运维诚实性 e2e:后端不可达时,数据面板必须出示「连不上」警示,
// 与「没有数据」可区分;mock 模式无后端语义,警示不渲染。

import { test, expect } from '@playwright/test';

test.describe('后端不可达诚实性', () => {
	test('http 模式后端不可达 → 顶栏徽标未连接 + 审计页出示不可达警示条', async ({
		page
	}) => {
		// 环境无关的确定性不可达:net-config 指向必然死端口(online 模式绝对
		// URL 不走 dev 代理,本地 18080 常驻实例/CI 无实例两种环境同样成立)
		await page.goto('/?backend=http', { waitUntil: 'domcontentloaded' });
		await page.evaluate(() => {
			localStorage.setItem(
				'evorule-console-cloud:net-config',
				JSON.stringify({ mode: 'online', remoteBaseUrl: 'http://127.0.0.1:1', authToken: '' })
			);
		});
		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/, { timeout: 10_000 });

		// /audit 受登录守卫 → 演示模式一键登录(纯客户端,无需后端)
		await page.goto('/login?backend=http', { waitUntil: 'networkidle' });
		await page.getByRole('button', { name: /切换到演示模式/ }).click();
		await page.getByRole('button', { name: /刘审计/ }).click();
		await page.getByRole('button', { name: '登录 →' }).click();
		await page.waitForTimeout(1000);

		await page.goto('/audit?backend=http', { waitUntil: 'domcontentloaded' });
		// 警示条:明确区分「连不上」与「没数据」
		await expect(page.locator('[data-testid="backend-unreachable"]')).toBeVisible({
			timeout: 30_000
		});
		await expect(page.locator('[data-testid="backend-unreachable"]')).toContainText(
			'无法连接 evorule-server'
		);
		// 顶栏徽标同步为未连接态
		await expect(page.locator('.conn-status')).toContainText(/未连接|检测中/);
	});

	test('mock 模式(预填数据) → 不可达警示不渲染(无后端语义不造假警告)', async ({
		page
	}) => {
		await page.goto('/audit?backend=mock', { waitUntil: 'domcontentloaded' });
		await page.waitForTimeout(1500);
		await expect(page.locator('[data-testid="backend-unreachable"]')).toHaveCount(0);
	});
});
