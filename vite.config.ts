import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// === 组件测试基建(仅测试进程生效) ===
	// Svelte 5 mount 仅在 browser 构建可用(server 构建报 lifecycle_function_unavailable),
	// 故 vitest 下注入 browser condition;副作用是 $app/* 的 browser 构建会在无 window 的
	// node 单测里崩(kit client 运行时 import 期即触碰 window)。
	// 修复:enforce:'pre' 插件把 $app/* 指到测试替身(src/lib/testing/app-*.ts)——
	//   - environment:按真实环境(有无 window)判定 browser(node=false/jsdom=true);
	//   - navigation/paths/stores:node/jsdom 皆安全的 no-op/同形最小组件。
	// (不能用 config resolve.alias:kit 的 transform 会先把 $app/* 重写为其运行时
	//  路径再解析,alias 抢不到;resolveId 拦截裸 id 与运行时路径两形。)
	// 组件测试文件约定命名 *.svelte.test.ts(环境用文件头 @vitest-environment jsdom 声明)。
	plugins: [
		...(process.env.VITEST
			? [
					{
						name: 'vitest-app-modules-double',
						enforce: 'pre' as const,
						resolveId(id: string) {
							for (const mod of ['environment', 'navigation', 'paths', 'stores']) {
								if (id === `$app/${mod}` || id.includes(`@sveltejs/kit/src/runtime/app/${mod}`)) {
									return fileURLToPath(
										new URL(`./src/lib/testing/app-${mod}.ts`, import.meta.url)
									);
								}
							}
							return null;
						}
					}
				]
			: []),
		sveltekit()
	],
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
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
		// 治理视图路由(2026-09-06 CORS 环境坑修复):生产下 GovernanceBackend 仍直连
		// evorule-rule :18081(打包参数已配套 --allowed-origins);dev(:5174)下治理连接
		// 默认走 /rule-serve 代理(同源请求,浏览器 CORS 不参与)——rule-serve 无需为
		// dev 端口追加 --allowed-origins 白名单。代理剥离前缀后转发至 18081。
		proxy: {
			'/api': {
				target: 'http://127.0.0.1:18080',
				changeOrigin: true
			},
			'/rule-serve': {
				target: 'http://127.0.0.1:18081',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/rule-serve/, '')
			}
		}
	}
});
