import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	},
	server: {
		port: 5174,
		// strictPort: true — 端口被占时直接报错，而非静默切到其他端口。
		// 常见占用源：playwright e2e 测试后残留的僵尸 node 进程。
		// 修复：npm run clean && npm run dev
		strictPort: true,
		// D4-C 修复(2026-08-03):offline 模式本地开发零配置 CORS。
		// 把 /api 请求代理到 evorule-server(本项目调试实例 127.0.0.1:18080,loopback 免鉴权),避免跨端口 CORS 问题。
		// 用法:net-config 的 localBaseUrl 留空(同源),请求自动走 proxy。
		// 注意:仅 dev/preview 生效;静态部署需配置反向代理(如 nginx)或用 online 模式。
		// 治理视图(GovernanceBackend)直连 evorule-rule :18081,不走此 proxy。
		proxy: {
			'/api': {
				target: 'http://127.0.0.1:18080',
				changeOrigin: true
			}
		}
	}
});
