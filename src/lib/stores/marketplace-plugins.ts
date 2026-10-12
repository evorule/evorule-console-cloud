/**
 * WASM 插件类目 store（官方审核制只读；分发物材料状态陈列）
 *
 * server 端点族：`GET /api/marketplace/plugins`（列表）/
 * `GET /api/marketplace/plugins/{id}/download?part=wasm|manifest|signature`。
 * 职责边界：本 store 只陈列材料状态（签名在场/哈希比对/纯度声明），
 * 签名与纯度的机器验证在 wasm-host 加载期（enforce 策略）——市场不构成信任背书。
 * 安装语义 = 半自动（下载三件套 + 按《插件发布指南》落盘），市场不做落盘动作。
 */
import { writable, get, derived } from "svelte/store";
import { DEFAULT_LOCAL_BASE_URL } from "$lib/backend/types";
import { netConfig } from "$lib/config/net-config";

// ============================================================================
// 1. 请求基建（惯例对齐 marketplace.ts；该文件三函数模块私有故同形复制）
// ============================================================================

function resolveApiBase(): string {
	const cfg = get(netConfig);
	return cfg.mode === "online" ? cfg.remoteBaseUrl : DEFAULT_LOCAL_BASE_URL;
}

function authHeaders(): Record<string, string> {
	const token = get(netConfig).authToken;
	return token ? { Authorization: `Bearer ${token}` } : {};
}

async function serverErrorMessage(res: Response, fallback: string): Promise<string> {
	const body = (await res.json().catch(() => null)) as { message?: string } | null;
	return body?.message ?? `${fallback}: HTTP ${res.status}`;
}

// ============================================================================
// 2. 类型与 Store
// ============================================================================

/** 插件分发物材料状态（server 端 list_plugins_from 投影） */
export interface MarketplacePlugin {
	id: string;
	name: string;
	version?: string;
	abi?: number;
	purity?: string;
	engine_min?: string;
	key_id?: string;
	has_signature: boolean;
	integrity_mismatch: boolean;
	content_hash: string;
	description?: string;
	author?: string;
	download_count?: number;
	created_at?: string;
}

/** 宿主信息（三态显式建模：available=false=无法预检，不默认兼容） */
export interface HostInfo {
	available: boolean;
	version?: string;
	abi?: number;
	/** server 侧管理凭证已配置（安装通道开启）；与 available 正交 */
	install_channel_enabled?: boolean;
}

export const marketplacePlugins = writable<MarketplacePlugin[]>([]);
export const hostInfo = writable<HostInfo>({ available: false });
export const pluginsLoading = writable<boolean>(false);
export const pluginsError = writable<string | null>(null);

/** 类目筛选（对齐模板 Tab 惯例）：关键词匹配 name/description；签名状态三选；
 *  发行方筛选（多发行方命名空间展示——服务名全局唯一维持，author 仅作归属展示） */
export const pluginSearchQuery = writable<string>("");
export const pluginSignatureFilter = writable<"all" | "signed" | "unsigned">("all");
export const pluginPublisherFilter = writable<string>("all");

// ============================================================================
// 3. 列表与下载
// ============================================================================

export async function loadPlugins(): Promise<void> {
	pluginsLoading.set(true);
	pluginsError.set(null);
	try {
		const res = await fetch(`${resolveApiBase()}/api/marketplace/plugins`, {
			headers: authHeaders(),
		});
		if (!res.ok) {
			throw new Error(await serverErrorMessage(res, "插件列表加载失败"));
		}
		const body = (await res.json()) as {
			plugins?: MarketplacePlugin[];
			host?: HostInfo;
		};
		if (!Array.isArray(body.plugins)) {
			throw new Error("插件列表响应形态异常（plugins 非数组）");
		}
		marketplacePlugins.set(body.plugins);
		hostInfo.set(body.host ?? { available: false });
	} catch (e) {
		// 显式降级：错误原文上屏，保留已加载列表可浏览，拒绝静默
		pluginsError.set(e instanceof Error ? e.message : String(e));
	} finally {
		pluginsLoading.set(false);
	}
}

export type PluginPart = "wasm" | "manifest" | "signature";

/** 筛选后的插件列表（关键词 + 签名状态；server 保证 name 序确定性） */
export const filteredPlugins = derived(
	[marketplacePlugins, pluginSearchQuery, pluginSignatureFilter, pluginPublisherFilter],
	([plugins, q, sigFilter, publisher]) => {
		const needle = q.trim().toLowerCase();
		return plugins.filter((p) => {
			if (
				needle &&
				!`${p.name} ${p.description ?? ""}`.toLowerCase().includes(needle)
			) {
				return false;
			}
			if (sigFilter === "signed" && !p.has_signature) return false;
			if (sigFilter === "unsigned" && p.has_signature) return false;
			if (publisher !== "all" && (p.author ?? "official") !== publisher) return false;
			return true;
		});
	},
);

/** 在架发行方去重清单（发行方筛选下拉事实源；official 恒首） */
export const pluginPublishers = derived([marketplacePlugins], ([plugins]) => {
	const set = new Set<string>("official");
	for (const p of plugins) if (p.author) set.add(p.author);
	return [...set];
});

/** 下载分发物部件（Blob 交给调用方触发浏览器保存） */
export async function downloadPluginPart(
	pluginId: string,
	part: PluginPart,
): Promise<Blob> {
	const res = await fetch(
		`${resolveApiBase()}/api/marketplace/plugins/${encodeURIComponent(pluginId)}/download?part=${part}`,
		{ headers: authHeaders() },
	);
	if (!res.ok) {
		throw new Error(await serverErrorMessage(res, "插件下载失败"));
	}
	bumpPluginDownloadCount(pluginId);
	return await res.blob();
}

/** 下载计数乐观同步（server 为权威，下次 load 收敛） */
function bumpPluginDownloadCount(pluginId: string): void {
	marketplacePlugins.update((list) =>
		list.map((p) =>
			p.id === pluginId
				? { ...p, download_count: (p.download_count ?? 0) + 1 }
				: p,
		),
	);
}

// ============================================================================
// 4. 安装自动化（三期：一键安装/卸载/禁用——server 代理 wasm-host 管理面）
// ============================================================================

/** 安装各阶段耗时（server 透传 wasm-host stage_timings；透明性回显） */
export interface InstallStages {
	verify_ms: number;
	persist_ms: number;
	compile_ms: number;
	swap_ms: number;
}

/** 安装结果（成功含阶段耗时；失败 error 为阶段定位信息） */
export interface InstallResult {
	ok: boolean;
	installed: string;
	stages: InstallStages;
	modules: number;
	integrity?: { state: string; key_id?: string };
	reconciliation?: unknown;
}

async function pluginAction(id: string, action: "install" | "uninstall" | "disable"): Promise<InstallResult> {
	const res = await fetch(
		`${resolveApiBase()}/api/marketplace/plugins/${encodeURIComponent(id)}/${action}`,
		{ method: "POST", headers: authHeaders() },
	);
	const body = (await res.json().catch(() => ({}))) as {
		success?: boolean;
		detail?: InstallResult;
		error?: string;
		message?: string;
	};
	if (!res.ok) {
		throw new Error(body.error ?? body.message ?? `安装动作失败: HTTP ${res.status}`);
	}
	return body.detail ?? { ok: true, installed: id, stages: { verify_ms: 0, persist_ms: 0, compile_ms: 0, swap_ms: 0 }, modules: 0 };
}

export function installPlugin(id: string): Promise<InstallResult> {
	return pluginAction(id, "install");
}

export function uninstallPlugin(id: string): Promise<InstallResult> {
	return pluginAction(id, "uninstall");
}

export function disablePlugin(id: string): Promise<InstallResult> {
	return pluginAction(id, "disable");
}

/**
 * 带字节进度的大文件下载（ReadableStream 流式读取；服务端无 content-length 时
 * 退化为不定进度——进度条显示已收字节）。
 */
export async function downloadPluginPartWithProgress(
	pluginId: string,
	part: PluginPart,
	onProgress: (received: number, total: number | null) => void,
): Promise<Blob> {
	const res = await fetch(
		`${resolveApiBase()}/api/marketplace/plugins/${encodeURIComponent(pluginId)}/download?part=${part}`,
		{ headers: authHeaders() },
	);
	if (!res.ok) {
		throw new Error(await serverErrorMessage(res, "插件下载失败"));
	}
	const totalHeader = res.headers.get("content-length");
	const total = totalHeader ? Number(totalHeader) : null;
	if (!res.body) {
		return await res.blob();
	}
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value);
			received += value.length;
			onProgress(received, total);
		}
	}
	bumpPluginDownloadCount(pluginId);
	return new Blob(chunks as BlobPart[]);
}
