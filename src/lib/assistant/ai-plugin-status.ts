// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — ai-plugin 激活状态检测(UV-177)
//
// 职责:
//   - 消费既有 GET /api/health 的 plugins 节(server.rs:启动期挂载事实 enabled
//     + 探活任务合并的运行时 liveness),无侵入判定 ai-plugin 三态
//   - 纯函数 parseAiPluginStatus 可单测锁定;fetchAiPluginStatus 只做取数
//
// 三态语义(引导卡呈现):
//   disabled    — plugins 节无 ai-plugin 条目或 enabled !== true → 三步引导
//   unreachable — enabled 但探活 offline / 尚无存活快照 → 拉起进程指引
//   ready       — 探活 online → 就绪
//   no_probe    — 探活 no_probe(插件未实现 /health;ai-plugin 已实现,仅容错兜底)
//   unknown     — /api/health 本身不可达或响应不可解析(server 未启动/网络不通)

/** ai-plugin 的 plugins 节键名(= plugin_manifest.json 登记的插件 id) */
export const AI_PLUGIN_ID = 'ai-plugin';

export type AiPluginStatus =
	| { state: 'disabled' }
	| { state: 'unreachable'; lastError?: string }
	| { state: 'ready' }
	| { state: 'no_probe' }
	| { state: 'unknown' };

/**
 * 从 /api/health 响应解析 ai-plugin 激活状态。
 *
 * 响应形态(server.rs HealthResponse):
 *   { success, message, plugins?: { "ai-plugin": { enabled, external?, services?,
 *     status?, last_error? } } }
 * status/last_error 由探活任务 merge_liveness_into_plugins 合并;探活任务未运行
 * (空表)时缺省——enabled 插件此时归入 unreachable(进程存活未知)。
 * 任何形态漂移都如实归入 unknown/disabled,不虚构就绪。
 */
export function parseAiPluginStatus(health: unknown): AiPluginStatus {
	if (typeof health !== 'object' || health === null) return { state: 'unknown' };
	const plugins = (health as Record<string, unknown>)['plugins'];
	if (typeof plugins !== 'object' || plugins === null) return { state: 'unknown' };

	const node = (plugins as Record<string, unknown>)[AI_PLUGIN_ID];
	if (node === undefined) return { state: 'disabled' };
	if (typeof node !== 'object' || node === null) return { state: 'unknown' }; // 清单形态漂移,如实不判定
	const m = node as Record<string, unknown>;

	if (m['enabled'] !== true) return { state: 'disabled' };

	const status = typeof m['status'] === 'string' ? m['status'] : undefined;
	if (status === 'online') return { state: 'ready' };
	if (status === 'no_probe') return { state: 'no_probe' };
	// offline 或尚无存活快照(探活未运行/首轮未完成):统一"进程未达"
	const lastError = typeof m['last_error'] === 'string' && m['last_error'].length > 0
		? m['last_error']
		: undefined;
	return { state: 'unreachable', lastError };
}

/**
 * 拉取并解析 ai-plugin 状态。
 * baseUrl 为 evorule-server 基址(如 http://127.0.0.1:18080,不带尾斜杠);
 * authToken 可选(server 开启 --auth-token 时需要);网络/HTTP/解析失败如实
 * 返回 unknown,不抛错(引导卡自行呈现"无法检测")。
 */
export async function fetchAiPluginStatus(
	baseUrl: string,
	authToken?: string,
	signal?: AbortSignal
): Promise<AiPluginStatus> {
	try {
		const headers: Record<string, string> = {};
		if (authToken && authToken.trim().length > 0) {
			headers['Authorization'] = `Bearer ${authToken.trim()}`;
		}
		const r = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/health`, {
			headers,
			signal
		});
		if (!r.ok) return { state: 'unknown' };
		return parseAiPluginStatus(await r.json());
	} catch {
		return { state: 'unknown' };
	}
}
