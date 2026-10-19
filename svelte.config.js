import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// 部署形态三选一:
// 1) serve 同源嵌入托管 → CONSOLE_BASE=/console/ (值即托管前缀)
// 2) GitHub Pages 子路径部署 → GITHUB_PAGES=true (回落 /evorule-console-cloud)
// 3) 本地开发 / 独立部署 → 两者均未设, 根路径 ''
const consoleBase = process.env.CONSOLE_BASE?.replace(/\/+$/, '') || '';
const githubPages = !consoleBase && process.env.GITHUB_PAGES === 'true';
const repoName = 'evorule-console-cloud';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html'
		}),
		paths: {
			// CONSOLE_BASE 优先;GitHub Pages → /evorule-console-cloud;未设 → ''
			base: consoleBase || (githubPages ? `/${repoName}` : '')
		}
	}
};

export default config;
