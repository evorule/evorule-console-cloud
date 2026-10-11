<script lang="ts">
	/**
	 * WASM 插件类目（官方审核制只读）——分发物材料状态陈列 + 三件套下载。
	 * 职责边界：签名与纯度的机器验证在 wasm-host 加载期（enforce 策略），
	 * 本分区不构成信任背书；安装 = 半自动（下载 + 按《插件发布指南》落盘）。
	 */
	import {
		marketplacePlugins,
		pluginsLoading,
		pluginsError,
		loadPlugins,
		downloadPluginPart,
		type MarketplacePlugin,
		type PluginPart,
	} from "$lib/stores/marketplace-plugins";
	import { toastSuccess, toastError } from "$lib/stores/toast";

	let downloadingId = $state<string | null>(null);

	const PART_FILES: Record<PluginPart, string> = {
		wasm: ".wasm",
		manifest: ".plugin-module.json",
		signature: ".wasm.sig",
	};

	async function handleDownload(p: MarketplacePlugin, part: PluginPart): Promise<void> {
		downloadingId = `${p.id}:${part}`;
		try {
			const blob = await downloadPluginPart(p.id, part);
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
	{:else}
		<p class="pl-hint">
			安装 = 下载三件套后按《插件发布指南》落盘至 wasm 插件目录并重启宿主；
			签名与纯度在宿主加载期机器验证（市场陈列不构成信任背书）。
		</p>
		<div class="pl-grid">
			{#each $marketplacePlugins as p (p.id)}
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
							disabled={downloadingId !== null}
							onclick={() => void handleDownload(p, "wasm")}
						>
							{downloadingId === `${p.id}:wasm` ? "下载中…" : "下载模块"}
						</button>
						<button
							disabled={downloadingId !== null}
							onclick={() => void handleDownload(p, "manifest")}
						>
							清单
						</button>
						{#if p.has_signature}
							<button
								disabled={downloadingId !== null}
								onclick={() => void handleDownload(p, "signature")}
							>
								签名
							</button>
						{/if}
						{#if p.download_count !== undefined}
							<span class="pl-count">{p.download_count} 次下载</span>
						{/if}
					</footer>
				</article>
			{/each}
		</div>
	{/if}
</div>

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
	.pl-count {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--cd-fg-muted, #999);
	}
</style>
