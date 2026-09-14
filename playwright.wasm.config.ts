// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// WASM 浏览器兼容专用配置 — 在默认 chromium 基础上追加 firefox,
// 只跑 tests/wasm-browser.spec.ts。不改动 playwright.config.ts。
//
// 运行: npx playwright test --config playwright.wasm.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	testMatch: /wasm-browser\.spec\.ts/,
	fullyParallel: false,
	workers: 1,
	reporter: 'line',
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'off'
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }
	],
	// 由外部手动 `npx vite preview --port 4173` 托管,playwright 不自起 webServer
});
