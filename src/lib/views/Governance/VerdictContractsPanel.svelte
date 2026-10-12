<script lang="ts">
	/**
	 * 判定契约管理面板（workspace 域,P3-12 补角:封装在位此前零消费）
	 *
	 * - list/create/delete/evaluate 四操作（wb 全族封装已有）
	 * - evaluate 走 server 判定引擎（workspace/{id}/verdict/evaluate）,与 create 的
	 *   rules_json 同构（[{field,op,value,verdict}]）
	 */
	import { get } from 'svelte/store';
	import {
		useWorkspaceBackendOrNull
	} from '$lib/kernel';
	import {
		currentWorkspace,
		HttpWorkspaceBackendError
	} from '$lib/kernel';
	import { toastSuccess, toastError } from '$lib/stores/toast';
	import type { VerdictContractRecord } from '$lib/kernel/backend/workspace-types';

	let contracts = $state<VerdictContractRecord[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let creating = $state(false);
	let showCreate = $state(false);
	let newName = $state('');
	let newRulesJson = $state('[{"field":"","op":"eq","value":"","verdict":true}]');
	let evalTarget = $state<VerdictContractRecord | null>(null);
	let evalContext = $state('{}');
	let evalResult = $state<string>('');

	const wsId = $derived(get(currentWorkspace)?.id ?? null);

	async function reload(): Promise<void> {
		const wb = useWorkspaceBackendOrNull();
		const ws = get(currentWorkspace);
		if (!wb || !ws) {
			error = '未连接工作空间';
			return;
		}
		loading = true;
		error = null;
		try {
			contracts = await wb.listVerdictContracts(ws.id);
		} catch (e) {
			error = e instanceof HttpWorkspaceBackendError ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	export async function refresh(): Promise<void> {
		await reload();
	}

	async function handleCreate(): Promise<void> {
		const wb = useWorkspaceBackendOrNull();
		const ws = get(currentWorkspace);
		if (!wb || !ws) return;
		if (!newName.trim()) {
			toastError('契约名称必填', '判定契约');
			return;
		}
		creating = true;
		try {
			await wb.createVerdictContract(ws.id, {
				name: newName.trim(),
				rules_json: newRulesJson,
				created_by: 'governance-console'
			});
			toastSuccess(`判定契约 ${newName.trim()} 已创建`, '判定契约');
			newName = '';
			await reload();
		} catch (e) {
			toastError(e instanceof HttpWorkspaceBackendError ? e.message : String(e), '判定契约');
		} finally {
			creating = false;
		}
	}

	async function handleDelete(rec: VerdictContractRecord): Promise<void> {
		const wb = useWorkspaceBackendOrNull();
		const ws = get(currentWorkspace);
		if (!wb || !ws) return;
		try {
			await wb.deleteVerdictContract(ws.id, rec.id);
			toastSuccess(`判定契约 ${rec.name} 已删除`, '判定契约');
			await reload();
		} catch (e) {
			toastError(e instanceof HttpWorkspaceBackendError ? e.message : String(e), '判定契约');
		}
	}

	async function handleEvaluate(rec: VerdictContractRecord): Promise<void> {
		const wb = useWorkspaceBackendOrNull();
		const ws = get(currentWorkspace);
		if (!wb || !ws) return;
		try {
			const facts = JSON.parse(evalContext || '{}');
			const r = await wb.evaluateVerdict(ws.id, {
				payload: JSON.parse(evalContext || '{}'),
				contract_id: rec.id
			});
			evalResult = JSON.stringify(r, null, 2);
			toastSuccess(`判定契约 ${rec.name} 评估完成`, '判定契约');
		} catch (e) {
			toastError(e instanceof HttpWorkspaceBackendError ? e.message : String(e), '判定契约');
		}
	}
</script>

<div class="vc-panel">
	<div class="vc-head">
		<h3>📜 判定契约（Verdict Contracts）</h3>
		<button class="btn btn-sm" onclick={() => void reload()} disabled={loading}>
			{loading ? '加载中…' : '刷新'}
		</button>
	</div>
	{#if error}
		<p class="vc-error" role="alert">⚠ {error}</p>
	{/if}

	<div class="vc-create">
		<input type="text" bind:value={newName} placeholder="契约名称" />
		<textarea rows="2" bind:value={newRulesJson} placeholder="条件集合 JSON 数组,元素含 field/op/value/verdict"></textarea>
		<button onclick={() => void handleCreate()} disabled={creating || !newName.trim()}>
			{creating ? '创建中…' : '创建契约'}
		</button>
	</div>

	{#if contracts.length === 0}
		<p class="vc-empty">暂无判定契约。</p>
	{:else}
		<table class="vc-table">
			<thead>
				<tr><th>名称</th><th>版本</th><th>规则数</th><th>状态</th><th>操作</th></tr>
			</thead>
			<tbody>
				{#each contracts as c (c.id)}
					<tr>
						<td>{c.name}</td>
						<td>v{c.version}</td>
						<td class="vc-json-cell" title={c.rules_json}>{c.rules_json.length} B</td>
						<td>{c.is_default ? '默认' : '标准'}</td>
						<td>
							<button class="btn btn-sm btn-danger" onclick={() => void handleDelete(c)}>
								删除
							</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<div class="vc-eval">
	<h4>契约评估测试台</h4>
	<select bind:value={evalTarget}>
		<option value={undefined}>选择契约…</option>
		{#each contracts as c (c.id)}
			<option value={c}>{c.name} (v{c.version})</option>
		{/each}
	</select>
	<textarea rows="3" bind:value={evalContext} placeholder='评估上下文 JSON 对象'></textarea>
	<button onclick={() => evalTarget && void handleEvaluate(evalTarget)} disabled={!evalTarget}>
		评估
	</button>
	{#if evalResult}
		<pre class="vc-json">{evalResult}</pre>
	{/if}
</div>

<style>
	.vc-panel {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.vc-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.vc-error {
		color: var(--cd-danger, #b00);
		font-size: 0.875rem;
	}
	.vc-create {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.vc-create input,
	.vc-create textarea {
		flex: 1;
		font-size: 0.8125rem;
	}
	.vc-empty {
		color: var(--cd-fg-muted, #666);
		font-size: 0.875rem;
	}
	.vc-table {
		width: 100%;
		font-size: 0.8125rem;
		border-collapse: collapse;
	}
	.vc-table th,
	.vc-table td {
		border: 1px solid var(--cd-border, #ddd);
		padding: 0.25rem 0.5rem;
		text-align: left;
	}
	.vc-json-cell {
		font-family: monospace;
	}
	.vc-eval {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.vc-eval select,
	.vc-eval textarea,
	.vc-eval button {
		font-size: 0.8125rem;
	}
	.vc-json {
		background: var(--cd-chip-bg, #f6f8fa);
		border-radius: 6px;
		padding: 0.5rem;
		font-size: 0.75rem;
		max-height: 12rem;
		overflow: auto;
		margin: 0;
	}
</style>
