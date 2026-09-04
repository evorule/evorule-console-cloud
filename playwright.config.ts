import { defineConfig, devices } from '@playwright/test';

/**
 * evorule-console-cloud e2e 配置
 * 对齐 evorule-console 内核:单 worker,避免 Vite dev server 冷启动竞态
 */
export default defineConfig({
	testDir: './tests',
	fullyParallel: false,
	workers: 1,
	reporter: 'line',
	use: {
		baseURL: 'http://localhost:5174',
		trace: 'on-first-retry'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],
	webServer: {
		command: 'npm run dev',
		url: 'http://localhost:5174',
		/**
		 * 复用语义(UV-085 ②):!CI 是 Playwright 惯例——CI 环境不复用陈旧 server。
		 * 陷阱:本机 shell 若带 CI=true(如 agent 沙箱),5174 dev server 在跑也
		 * 会被判定为"须自起"→ 端口冲突误报,且测试结束 Playwright 会把复用判定
		 * 为自己的 server 一并带走。显式逃生门 E2E_REUSE_SERVER=1:CI=true 环境
		 * 仍强制复用本地 dev server(用法:CI=true E2E_REUSE_SERVER=1 npx playwright test)。
		 */
		reuseExistingServer: !process.env.CI || process.env.E2E_REUSE_SERVER === '1',
		timeout: 60_000
	}
});
