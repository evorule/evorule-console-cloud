<script lang="ts">
	/**
	 * 锚点链与时钟面板（审计工作台,G-A2 接线）
	 *
	 * - 锚点链：列表 / 立即封条 / 验证（BLAKE3 哈希链 + ed25519 签名锚点）
	 * - 时钟旁路：版本↔墙钟映射 record/lookup（设计约束:仅索引,不进审计链哈希）
	 * - 权限:页面级 view_audit_chain 守卫已在 /audit 路由;此处不做二次鉴权
	 */
	import { currentSessionId } from '$lib/kernel/stores/session';
	import { useBackendOrNull } from '$lib/kernel/backend/backend-context';
	import { CloudHttpBackend } from '$lib/backend/cloud-http-backend';
	import { toastSuccess, toastError } from '$lib/stores/toast';

	const backend = $derived(useBackendOrNull() as CloudHttpBackend | null);

	let anchorsJson = $state<string>('');
	let anchorCount = $state<number | null>(null);
	let verifyResult = $state<string>('');
	let sealing = $state(false);
	let verifying = $state(false);

	let clockVersion = $state<number | null>(null);
	let clockWall = $state<string>('');
	let clockSource = $state<string>('');
	let clockLookupFrom = $state<number | null>(null);
	let clockLookupTo = $state<number | null>(null);
	let clockResult = $state<string>('');

	$effect(() => {
		if ($currentSessionId !== null) void refreshAnchors();
	});

	async function refreshAnchors(): Promise<void> {
		if (!backend) return;
		const sid = $currentSessionId;
		if (sid === null) return;
		try {
			const r = (await backend.listAnchors(sid)) as {
				count: number;
				anchors: unknown[];
			};
			anchorCount = r.count;
			anchorsJson = JSON.stringify(r.anchors, null, 2);
		} catch (e) {
			toastError(e instanceof Error ? e.message : String(e), '锚点链');
		}
	}

	async function handleSeal(): Promise<void> {
		const sid = $currentSessionId;
		if (sid === null || sealing || !backend) return;
		sealing = true;
		try {
			await backend.sealAnchorNow(sid);
			toastSuccess('锚点封条完成', '审计');
			await refreshAnchors();
		} catch (e) {
			toastError(e instanceof Error ? e.message : String(e), '锚点封条');
		} finally {
			sealing = false;
		}
	}

	async function handleVerify(): Promise<void> {
		const sid = $currentSessionId;
		if (sid === null || verifying || !backend) return;
		verifying = true;
		verifyResult = '';
		try {
			const r = await backend.verifyAnchors(sid);
			verifyResult = JSON.stringify(r, null, 2);
			toastSuccess('锚点链验证通过', '审计');
		} catch (e) {
			toastError(e instanceof Error ? e.message : String(e), '锚点验证');
		} finally {
			verifying = false;
		}
	}

	async function handleRecordClock(): Promise<void> {
		const sid = $currentSessionId;
		if (sid === null || clockVersion === null || !clockWall || !backend) {
			toastError('需填写版本号与墙钟时间', '时钟');
			return;
		}
		try {
			await backend.recordClock(sid, clockVersion, clockWall, clockSource || undefined);
			toastSuccess(`已记录 v${clockVersion} ↔ ${clockWall}`, '时钟');
			clockResult = JSON.stringify({ version: clockVersion, wall_clock: clockWall });
		} catch (e) {
			toastError(e instanceof Error ? e.message : String(e), '时钟');
		}
	}

	async function handleLookupClock(): Promise<void> {
		const sid = $currentSessionId;
		if (sid === null || !backend) return;
		try {
			const q = new URLSearchParams();
			if (clockLookupFrom !== null) q.set('from_version', String(clockLookupFrom));
			if (clockLookupTo !== null) q.set('to_version', String(clockLookupTo));
			const qs = q.toString();
			const r = await fetch(
				`/api/sessions/${sid}/clock/lookup${qs ? `?${qs}` : ''}`
			);
			clockResult = JSON.stringify(await r.json(), null, 2);
		} catch (e) {
			toastError(e instanceof Error ? e.message : String(e), '时钟');
		}
	}
</script>

<div class="ac-section">
	<div class="ac-head">
		<h3>⚓ 锚点链（G-A2）</h3>
		<div class="ac-actions">
			<button onclick={() => void handleSeal()} disabled={sealing || $currentSessionId === null}>
				{sealing ? '封条中…' : '立即封条'}
			</button>
			<button onclick={() => void handleVerify()} disabled={verifying || $currentSessionId === null}>
				{verifying ? '验证中…' : '验证锚点链'}
			</button>
		</div>
	</div>
	{#if anchorCount !== null}
		<p class="ac-meta">锚点数:{anchorCount}</p>
	{/if}
	{#if anchorsJson}
		<pre class="ac-json">{anchorsJson}</pre>
	{/if}
	{#if verifyResult}
		<pre class="ac-json">{verifyResult}</pre>
	{/if}
</div>

<div class="ac-section">
	<div class="ac-head">
		<h3>🕒 版本↔墙钟（旁路索引,不进审计链哈希）</h3>
	</div>
	<div class="ac-form">
		<label>
			版本
			<input
				type="number"
				bind:value={clockVersion}
				placeholder="ruleset 版本"
			/>
		</label>
		<label>
			墙钟时间
			<input type="text" bind:value={clockWall} placeholder="ISO8601,如 2026-10-12T00:00:00Z" />
		</label>
		<label>
			来源(可选)
			<input type="text" bind:value={clockSource} placeholder="如 manual" />
		</label>
		<button onclick={() => void handleRecordClock()} disabled={clockVersion === null || !clockWall}>
			记录
		</button>
	</div>
	<div class="ac-form">
		<label>
			起始版本
			<input type="number" bind:value={clockLookupFrom} />
		</label>
		<label>
			结束版本
			<input type="number" bind:value={clockLookupTo} />
		</label>
		<button onclick={() => void handleLookupClock()}>查询</button>
	</div>
	{#if clockResult}
		<pre class="ac-json">{clockResult}</pre>
	{/if}
</div>

<style>
	.ac-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.ac-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.ac-head h3 {
		margin: 0;
		font-size: 1rem;
	}
	.ac-actions {
		display: flex;
		gap: 0.5rem;
	}
	.ac-meta {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--cd-fg-muted, #666);
	}
	.ac-json {
		background: var(--cd-chip-bg, #f6f8fa);
		border-radius: 6px;
		padding: 0.5rem;
		font-size: 0.75rem;
		max-height: 16rem;
		overflow: auto;
		margin: 0;
	}
	.ac-form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: end;
		font-size: 0.8125rem;
	}
	.ac-form label {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
</style>
