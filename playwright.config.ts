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
		reuseExistingServer: !process.env.CI,
		timeout: 60_000
	}
});
