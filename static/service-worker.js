// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// evorule-console-cloud 在线 demo Service Worker —— 离线缓存。
//
// 设计目标:
//   1. 在线 demo 首次加载后,后续(含离线)可直接打开 WASM 规则引擎,
//      无需再次访问网络拉取 .wasm / JS / CSS / 规则 JSON。
//   2. HTML 导航请求走 Network-First(尽量拿到最新 SPA 外壳,离线回退缓存)。
//   3. 静态 immutable 资产(_app/immutable/*,内容带 hash)走 Cache-First,
//      长期缓存;规则 JSON 文件名稳定,也走 Cache-First。
//
// 作用域:由注册点决定(BASE_URL/service-worker.js → scope = BASE_URL)。
// 本文件不硬编码 base,运行时从 self.registration.scope 推导。

const VERSION = 'v1';
const CACHE_NAME = `evorule-demo-${VERSION}`;

// 安装时预缓存:SPA 外壳(index) + 5 个规则 JSON(WASM 引擎启动必需)。
// 带 hash 的 _app/immutable/* 资产由运行时缓存按需填充(文件名随构建变,
// 不在这里硬编码,避免每次发版都要改 SW)。
function precacheUrls() {
	const base = self.registration.scope; // 以 / 结尾,如 https://host/evorule-console-cloud/
	return [
		base, // start_url / index.html
		new URL('rules/core_eval.json', base).href,
		new URL('rules/20_finance_rules.json', base).href,
		new URL('rules/21_medical_rules.json', base).href,
		new URL('rules/22_djbh_rules.json', base).href,
		new URL('rules/10_role13_demo.json', base).href,
	];
}

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => cache.addAll(precacheUrls()))
			.then(() => self.skipWaiting())
			.catch((err) => {
				// 预缓存失败(如某文件 404)不应阻塞 SW 激活;运行时缓存会兜底。
				console.warn('[sw] 预缓存部分失败:', err);
			})
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((k) => k.startsWith('evorule-demo-') && k !== CACHE_NAME)
						.map((k) => caches.delete(k))
				)
			)
			.then(() => self.clients.claim())
	);
});

/** 判断是否为同源 GET 且属于静态可缓存资产 */
function isStaticAsset(url) {
	if (url.origin !== self.location.origin) return false;
	const path = url.pathname;
	// Vite 产物:内容 hash,可长期缓存
	if (path.includes('/_app/immutable/')) return true;
	// 规则 JSON(稳定文件名)
	if (path.includes('/rules/') && path.endsWith('.json')) return true;
	// 常见静态后缀
	if (/\.(?:wasm|js|css|json|png|jpg|jpeg|svg|gif|webp|ico|woff2?)$/.test(path)) return true;
	return false;
}

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;

	const url = new URL(req.url);

	// 仅处理同源请求;跨源(CDN/字体/LLM 端点等)一律放行
	if (url.origin !== self.location.origin) return;

	// 1) 导航请求(SPA 深链接/首次进入):Network-First,离线回退缓存外壳
	if (req.mode === 'navigate') {
		event.respondWith(
			fetch(req)
				.then((resp) => {
					const copy = resp.clone();
					caches.open(CACHE_NAME).then((c) => c.put(req, copy));
					return resp;
				})
				.catch(async () => {
					const cache = await caches.open(CACHE_NAME);
					// 深链接回退到 SPA 外壳(等同 404.html 复制 index.html 的效果)
					return (
						(await cache.match(req)) ||
						(await cache.match(self.registration.scope)) ||
						(await caches.match(self.registration.scope))
					);
				})
		);
		return;
	}

	// 2) 静态资产:Cache-First,未命中则网络并写缓存
	if (isStaticAsset(url)) {
		event.respondWith(
			caches.match(req).then(
				(cached) =>
					cached ||
					fetch(req).then((resp) => {
						if (resp && resp.ok) {
							const copy = resp.clone();
							caches.open(CACHE_NAME).then((c) => c.put(req, copy));
						}
						return resp;
					})
			)
		);
		return;
	}

	// 其余(同源 API 探测等)默认放行,不干预
});
