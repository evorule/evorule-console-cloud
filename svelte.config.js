import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// P10: GitHub Pages 部署在 /evorule-console-cloud/ 子路径下,
// 通过 GITHUB_PAGES 环境变量动态配置 base(CI 设 true,本地开发留空)
const githubPages = process.env.GITHUB_PAGES === 'true';
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
			// GitHub Pages → /evorule-console-cloud;本地开发 → ''
			base: githubPages ? `/${repoName}` : ''
		}
	}
};

export default config;
