<script lang="ts">
	/**
	 * WASM 插件类目——一键安装 + 全程透明进度（安装自动化三期）。
	 * 用户原则（2026-10-12 项目方令）：点确认按钮即完成安装；下载/安装全程
	 * 进度可见（下载=字节级进度条；安装=阶段 stepper+各阶段真实耗时回显）。
	 * 职责边界：机器验证在 wasm-host 安装期（enforce），市场不构成信任背书。
	 */
	import {
		marketplacePlugins,
		filteredPlugins,
		pluginSearchQuery,
		pluginSignatureFilter,
		pluginsLoading,
		pluginsError,
		hostInfo,
		loadPlugins,
		downloadPluginPartWithProgress,
		installPlugin,
		uninstallPlugin,
		disablePlugin,
		type MarketplacePlugin,
		type PluginPart,
		type InstallResult,
	} from "$lib/stores/marketplace-plugins";
	import { toastSuccess, toastError } from "$lib/stores/toast";
	import { get } from "svelte/store";

	let downloadingId = $state<string | null>(null);
	let downloadBytes = $state<{ received: number; total: number | null }>({ received: 0, total: null });

	// 安装确认对话框（治理确认：五要素展示后显式放行）
	let confirmTarget = $state<MarketplacePlugin | null>(null);
	let installing = $state(false);
	let installStage = $state<string>("");
	let installStages = $state<InstallResult | null>(null);
	let uninstallingId = $state<string | null>(null);

	const PART_FILES: Record<PluginPart, string> = {
		wasm: ".wasm",
		manifest: ".plugin-module.json",
		signature: ".wasm.sig",
	};
	const INSTALL_STEPS = ["校验签名与清单", "落盘", "编译与加载", "服务注册"] as const;

	function fmtBytes(n: number): string {
		return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
	}

	async function handleDownload(p: MarketplacePlugin, part: PluginPart): Promise<void> {
		downloadingId = `${p.id}:${part}`;
		downloadBytes = { received: 0, total: null };
		try {
			const blob = await downloadPluginPartWithProgress(p.id, part, (received, total) => {
				downloadBytes = { received, total };
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `${p.id}${PART_FILES[part]}`;
			a.click();
			URL.revokeObjectURL(url);
			toastSuccess(`已下载 ${p.id}${PART_FILES[part]}`);
		} catch (e) {
			toastError(e instanceof Error ? e.message : String(e));
		} finally {
			downloadingId = null;
		}
	}

	/** 兼容性三态：compatible / incompatible / unknown（fail-visible，不默认兼容） */
	function compatState(p: MarketplacePlugin): "compatible" | "incompatible" | "unknown" {
		const host = get(hostInfo);
		if (!host.available || host.abi === undefined) return "unknown";
		if (p.abi === undefined) return "unknown";
		return p.abi === host.abi ? "compatible" : "incompatible";
	}

	const hostAbi = $derived($hostInfo.available ? $hostInfo.abi : undefined);

	function openConfirm(p: MarketplacePlugin): void {
		confirmTarget = p;
		installStage = "";
		installStages = null;
	}

	async function doInstall(): Promise<void> {
		const p = confirmTarget;
		if (!p || installing) return;
		installing = true;
		// 阶段指示：请求期间按序推进（各阶段真实耗时在响应后回显）
		for (const step of INSTALL_STEPS) {
			installStage = step;
			await new Promise((r) => setTimeout(r, 350));
			if (installStages) break;
		}
		try {
			const result = await installPlugin(p.id);
			installStages = result;
			installStage = "完成";
			toastSuccess(
				`已安装 ${p.id}（验签 ${result.stages.verify_ms}ms · 编译 ${result.stages.compile_ms}ms · 注册 ${result.stages.swap_ms}ms）`,
			);
			await loadPlugins();
		} catch (e) {
			toastError(e instanceof Error ? e.message : String(e));
			confirmTarget = null;
		} finally {
			installing = false;
		}
	}

	async function handleUninstall(p: MarketplacePlugin): Promise<void> {
		uninstallingId = p.id;
		try {
			await uninstallPlugin(p.id);
			toastSuccess(`已卸载 ${p.id}（三件套已删除）`);
			await loadPlugins();
		} catch (e) {
			toastError(e instanceof Error ? e.message : String(e));
		} finally {
			uninstallingId = null;
		}
	}

	async function handleDisable(p: MarketplacePlugin): Promise<void> {
		uninstallingId = p.id;
		try {
			await disablePlugin(p.id);
			toastSuccess(`已下线 ${p.id}（运行时禁用——文件保留，宿主重启后恢复在役）`);
			await loadPlugins();
		} catch (e) {
			toastError(e instanceof Error ? e.message : String(e));
		} finally {
			uninstallingId = null;
		}
	}
</script>

<div class="pl-section">
	{#if $pluginsLoading}
		<p class="pl-status">正在加载插件列表…</p>
	{:else if $pluginsError}
		<div class="pl-error" role="alert">
			<span>{$pluginsError}</span>
			<button onclick={() => void loadPlugins()}>重试</button>
		</div>
	{:else if $marketplacePlugins.length === 0}
		<p class="pl-status">
			暂无插件。分发物由官方审核后放置（三件套：模块 + 清单 + 签名），
			放置流程见《插件发布指南》。
		</p>
	{:else if $filteredPlugins.length === 0}
		<p class="pl-status">无匹配筛选条件的插件。</p>
	{:else}
		<p class="pl-hint">
			一键安装 = 确认后自动完成校验、落盘、加载与服务注册（全程进度透明）；
			签名与纯度在宿主安装期机器验证（市场陈列不构成信任背书）。
		</p>
		<div class="pl-filters">
			<input
				class="pl-search"
				type="text"
				placeholder="🔍 搜索插件名称/描述..."
				bind:value={$pluginSearchQuery}
			/>
			<select bind:value={$pluginSignatureFilter}>
				<option value="all">全部签名状态</option>
				<option value="signed">已签名</option>
				<option value="unsigned">未签名</option>
			</select>
		</div>
		<div class="pl-grid">
			{#each $filteredPlugins as p (p.id)}
				<article class="pl-card" class:pl-mismatch={p.integrity_mismatch}>
					<header class="pl-head">
						<strong>{p.name}</strong>
						{#if p.version}
							<span class="pl-badge">v{p.version}</span>
						{/if}
					</header>
					{#if p.description}
						<p class="pl-desc">{p.description}</p>
					{/if}
					<div class="pl-chips">
						{#if p.integrity_mismatch}
							<span class="chip chip-bad">哈希不符</span>
						{:else if p.has_signature}
							<span class="chip chip-ok">已签名{p.key_id ? ` · ${p.key_id}` : ""}</span>
						{:else}
							<span class="chip chip-warn">未签名</span>
						{/if}
						<span class="chip">纯度 {p.purity ?? "未声明"}</span>
						{#if p.abi !== undefined}
							<span class="chip">ABI {p.abi}</span>
						{/if}
					</div>
					<footer class="pl-foot">
						<button
						class="pl-primary"
						onclick={() => openConfirm(p)}
						disabled={$hostInfo.available && $hostInfo.install_channel_enabled === false}
						title={$hostInfo.available && $hostInfo.install_channel_enabled === false
							? "宿主未开启安装通道（server 未配置管理凭证）"
							: undefined}
					>
						一键安装
					</button>
						<button
							disabled={downloadingId !== null}
							onclick={() => void handleDownload(p, "wasm")}
							title="仅下载（不安装）"
						>
							下载
						</button>
						<button
							class="pl-danger"
							disabled={uninstallingId !== null}
							onclick={() => void handleDisable(p)}
							title="运行时禁用（文件保留，宿主重启后恢复在役）"
						>
							下线
						</button>
						<button
							class="pl-danger"
							disabled={uninstallingId !== null}
							onclick={() => void handleUninstall(p)}
						>
							卸载
						</button>
						{#if p.download_count !== undefined}
							<span class="pl-count">{p.download_count}</span>
						{/if}
					</footer>
					{#if downloadingId === `${p.id}:wasm` && downloadBytes.received > 0}
						<div class="pl-progress">
							<div
								class="pl-progress-bar"
								style="width: {downloadBytes.total
									? Math.round((downloadBytes.received / downloadBytes.total) * 100)
									: 30}%"
							></div>
							<span class="pl-progress-text">
								下载中 {fmtBytes(downloadBytes.received)}{downloadBytes.total
									? ` / ${fmtBytes(downloadBytes.total)}`
									: ""}
							</span>
						</div>
					{/if}
				</article>
			{/each}
		</div>
	{/if}
</div>

{#if confirmTarget}
	<div
		class="pl-modal-backdrop"
		role="presentation"
		onclick={() => (installing ? null : (confirmTarget = null))}
	>
		<div
			class="pl-modal"
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-label="安装确认"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<h3>安装确认 —— {confirmTarget.name}</h3>
			<p class="pl-modal-warn">
				该操作将向执行面装载代码（WASM 沙箱内运行）。请核对以下要素：
			</p>
			<dl class="pl-facts">
				<dt>签名</dt>
				<dd>
					{confirmTarget.has_signature
						? `已签名（${confirmTarget.key_id ?? "未知钥匙"}）`
						: "未签名"}
				</dd>
				<dt>纯度声明</dt>
				<dd>{confirmTarget.purity ?? "未声明"}</dd>
				<dt>内容哈希</dt>
				<dd class="mono">{confirmTarget.content_hash.slice(0, 24)}…</dd>
				<dt>版本 / ABI</dt>
				<dd>{confirmTarget.version ?? "-"} / {confirmTarget.abi ?? "-"}</dd>
				<dt>兼容性</dt>
				<dd>
					{#if compatState(confirmTarget) === "compatible"}
						<span class="chip chip-ok">与本宿主兼容</span>
					{:else if compatState(confirmTarget) === "incompatible"}
						<span class="chip chip-bad">
							ABI {confirmTarget.abi} 与宿主 {hostAbi ?? "?"} 不兼容——插件需重编译并重签
						</span>
					{:else}
						<span class="chip chip-warn">无法预检（宿主不可达）</span>
					{/if}
				</dd>
				<dt>来源</dt>
				<dd>{confirmTarget.author ?? "官方"}（官方审核制）</dd>
			</dl>
			{#if installing}
				<ol class="pl-steps">
					{#each INSTALL_STEPS as step, i}
						<li class:active={installStage === step} class:done={!!installStages}>
							{step}{installStages
								? `（${
										[
											installStages.stages.verify_ms,
											installStages.stages.persist_ms,
											installStages.stages.compile_ms,
											installStages.stages.swap_ms,
										][i]
									}ms）`
								: ""}
						</li>
					{/each}
				</ol>
			{/if}
			<footer class="pl-modal-foot">
				<button onclick={() => (confirmTarget = null)} disabled={installing}>取消</button>
				<button
					class="pl-primary"
					onclick={() => void doInstall()}
					disabled={installing || compatState(confirmTarget) === "incompatible"}
					title={compatState(confirmTarget) === "incompatible"
						? "与本宿主 ABI 不兼容，需重编译插件"
						: undefined}
				>
					{installing ? "安装中…" : "确认安装"}
				</button>
			</footer>
		</div>
	</div>
{/if}

<style>
	.pl-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.pl-status,
	.pl-hint {
		color: var(--cd-fg-muted, #666);
		font-size: 0.875rem;
	}
	.pl-error {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		color: var(--cd-danger, #b00);
		font-size: 0.875rem;
	}
	.pl-filters {
		display: flex;
		gap: 0.5rem;
	}
	.pl-search {
		flex: 1;
	}
	.pl-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 0.75rem;
	}
	.pl-card {
		border: 1px solid var(--cd-border, #ddd);
		border-radius: 8px;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.pl-mismatch {
		border-color: var(--cd-danger, #b00);
	}
	.pl-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.pl-badge {
		background: var(--cd-accent-soft, #eef);
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
		font-size: 0.75rem;
	}
	.pl-desc {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--cd-fg-muted, #666);
		display: -webkit-box;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.pl-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.chip {
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
		font-size: 0.75rem;
		background: var(--cd-chip-bg, #f4f4f5);
	}
	.chip-ok {
		background: var(--cd-ok-soft, #e6f6e6);
	}
	.chip-warn {
		background: var(--cd-warn-soft, #fdf3e0);
	}
	.chip-bad {
		background: var(--cd-danger-soft, #fde8e8);
		color: var(--cd-danger, #b00);
	}
	.pl-foot {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-top: auto;
	}
	.pl-primary {
		background: var(--cd-accent, #2563eb);
		color: #fff;
	}
	.pl-danger {
		color: var(--cd-danger, #b00);
	}
	.pl-count {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--cd-fg-muted, #999);
	}
	.pl-progress {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.pl-progress-bar {
		height: 4px;
		background: var(--cd-accent, #2563eb);
		border-radius: 2px;
		transition: width 0.15s;
	}
	.pl-progress-text {
		font-size: 0.75rem;
		color: var(--cd-fg-muted, #666);
	}
	.pl-modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 40%);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 50;
	}
	.pl-modal {
		background: var(--cd-bg, #fff);
		border-radius: 10px;
		padding: 1.25rem;
		width: min(30rem, 92vw);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.pl-modal-warn {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--cd-danger, #b00);
	}
	.pl-facts {
		display: grid;
		grid-template-columns: 6rem 1fr;
		gap: 0.25rem 0.5rem;
		font-size: 0.8125rem;
		margin: 0;
	}
	.pl-facts dt {
		color: var(--cd-fg-muted, #666);
	}
	.pl-facts dd {
		margin: 0;
		word-break: break-all;
	}
	.mono {
		font-family: monospace;
	}
	.pl-steps {
		margin: 0;
		padding-left: 1.25rem;
		font-size: 0.8125rem;
		color: var(--cd-fg-muted, #666);
	}
	.pl-steps li.active {
		color: var(--cd-accent, #2563eb);
		font-weight: 600;
	}
	.pl-steps li.done {
		color: var(--cd-ok, #16a34a);
	}
	.pl-modal-foot {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
</style>
