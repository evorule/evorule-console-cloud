<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  P10 demo 模式引导任务卡片(4 个)。
  P10_TASKFLOW_DEMO_DESIGN.md §3.3 + §5.4 定义。
  职责:展示 4 个引导任务卡片,点击启动对应只读 TaskFlow。

  stage1-m5:?backend=wasm 在线模式改渲染 WasmTour(7 步在线引导);
            HTTP/mock(默认)模式仍渲染原 4 个 demo 任务,行为不变。
-->

<script lang="ts">
	import { GUIDED_TASKS } from "$lib/data/guided-tasks";
	import { startTaskFlow } from "$lib/stores/task-flow";
	import { demoDatasetStore } from "$lib/stores/demo-dataset";
	import { sessionStore } from "$lib/stores/session";
	import { guidedTaskProgressStore, type GuidedTaskId } from "$lib/stores/guided-task-progress";
	import { toastInfo } from "$lib/stores/toast";
	import { isWasmBackendMode } from "$lib/config/backend-mode";
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import WasmTour from "./WasmTour.svelte";

	// WASM 在线模式 → 渲染 7 步引导;否则场景任务(HTTP 默认不变)
	const isWasm = isWasmBackendMode();

	const DATASET_LABEL: Record<string, string> = {
		agent: "Agent 编程审计",
		medical: "医疗合规",
		finance: "财务合规",
	};

	function handleStart(taskId: GuidedTaskId) {
		const task = GUIDED_TASKS.find((t) => t.id === taskId);
		if (!task) return;
		const dataset = $demoDatasetStore;
		// agent 场景渲染四幕故事线卡,不启动任务流(此分支仅在医疗/财务下可达)
		if (dataset === "agent") return;
		const presetContext = task.presetContext[dataset];
		startTaskFlow(task.flowId, true, presetContext);
		toastInfo(`已启动引导任务: ${task.name}`, "demo 任务流");
	}

	function isCompleted(taskId: GuidedTaskId): boolean {
		return $guidedTaskProgressStore.some((p) => p.taskId === taskId);
	}

	const completedCount = $derived(
		$guidedTaskProgressStore.length,
	);

	// === agent 场景四幕故事线(取材 mock 杀手会话:代码审查 agent 放行高危命令→链上留痕→回退→护栏进化) ===
	// 前两幕为叙事与链上实况,后两幕深链至时间旅行/规则库;深链目标受路由守卫(需登录),
	// 未登录先引导登录,避免点了被静默弹回。
	const AGENT_ACTS = [
		{
			no: 1,
			icon: "⚡",
			name: "失控",
			pitch: "代码审查 agent 自动放行了部署脚本里的高危命令 rm -rf /tmp/build——没有审计层,这一步无人知晓。",
			link: null as string | null,
			linkLabel: "",
		},
		{
			no: 2,
			icon: "🔗",
			name: "留痕",
			pitch: "确定性审计链逐条记录每次决策,哈希链防篡改;去审计页看这次会话的完整事实流。",
			link: "/audit?session=5",
			linkLabel: "看事实流 →",
		},
		{
			no: 3,
			icon: "⏪",
			name: "回退",
			pitch: "时间旅行 rewind 到危险决策点,fork 出修复分支,diff 证明修复——错误可回溯、可撤销。",
			link: "/view/timetravel",
			linkLabel: "去时间旅行 →",
		},
		{
			no: 4,
			icon: "🛡️",
			name: "进化",
			pitch: "零代码长出护栏规则 guard_shell_risky(JSON),人工审批后快照激活、零停机热加载。市场一键导入 Agent 审计三件套,把故事变成你自己的护栏。",
			link: "/marketplace",
			linkLabel: "导入护栏三件套 →",
		},
	];

	function goAct(link: string) {
		if (!$sessionStore.loggedIn) {
			toastInfo("登录后可查看完整演示(演示模式一键登录)", "引导");
			goto(`${base}/login`);
			return;
		}
		goto(`${base}${link}`);
	}
</script>

{#if isWasm}
	<WasmTour />
{:else if $demoDatasetStore === "agent"}
	<!-- agent 场景:四幕故事线替代财务任务卡 -->
	<div class="guided-tasks">
		<div class="gt-header">
			<h3 class="gt-title">🎯 4 幕看懂 Agent 编程审计(2 分钟)</h3>
		</div>

		<div class="gt-grid">
			{#each AGENT_ACTS as act (act.no)}
				<button class="gt-card" onclick={() => act.link && goAct(act.link)}>
					<div class="gt-card-header">
						<span class="gt-card-icon">{act.icon}</span>
						<span class="gt-card-name">第 {act.no} 幕 · {act.name}</span>
					</div>
					<div class="gt-card-pitch">{act.pitch}</div>
					{#if act.link}
						<div class="gt-card-meta">
							<span class="gt-time">🤖 Agent 编程审计</span>
							<span class="gt-link">{act.linkLabel}</span>
						</div>
					{/if}
				</button>
			{/each}
		</div>

		<div class="gt-viewer-cta">
			<span>拿到导出的会话文件?在浏览器里独立验证——不信任任何服务器:</span>
			<button class="gt-viewer-btn" onclick={() => goto(`${base}/sessions`)}>
				🔎 打开会话验证器 →
			</button>
		</div>
	</div>
{:else}
	<div class="guided-tasks">
		<div class="gt-header">
			<h3 class="gt-title">🎯 4 个引导任务(2-3 分钟体验完整链路)</h3>
			{#if completedCount > 0}
				<span class="gt-progress">已完成 {completedCount}/4</span>
			{/if}
		</div>

		<div class="gt-grid">
			{#each GUIDED_TASKS as task (task.id)}
				<button
					class="gt-card"
					class:completed={isCompleted(task.id)}
					onclick={() => handleStart(task.id)}
				>
					<div class="gt-card-header">
						<span class="gt-card-icon">{task.icon}</span>
						<span class="gt-card-name">{task.name}</span>
						{#if isCompleted(task.id)}
							<span class="gt-done-badge">✓ 已完成</span>
						{/if}
					</div>
				<div class="gt-card-pitch">{task.pitch[$demoDatasetStore === "finance" ? "finance" : "medical"]}</div>
					<div class="gt-card-meta">
						<span class="gt-time">⏱ ~{task.estimatedMinutes} 分钟</span>
						<span class="gt-dataset">📊 {DATASET_LABEL[$demoDatasetStore] ?? ""}</span>
					</div>
				</button>
			{/each}
		</div>
	</div>
{/if}

<style>
	.guided-tasks {
		padding: 0;
	}
	.gt-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;
	}
	.gt-title {
		font-size: 16px;
		font-weight: 600;
		margin: 0;
		color: var(--text-primary, #1f2937);
	}
	.gt-progress {
		font-size: 13px;
		color: var(--success, #22c55e);
		font-weight: 500;
	}

	.gt-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 12px;
	}
	.gt-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px;
		background: var(--bg-card);
		border: 2px solid var(--border, #e5e7eb);
		border-radius: 8px;
		cursor: pointer;
		text-align: left;
		transition: all 0.15s ease;
	}
	.gt-card:hover {
		border-color: var(--brand, #2563eb);
		box-shadow: 0 4px 12px rgba(37, 99, 235, 0.15);
		transform: translateY(-1px);
	}
	.gt-card.completed {
		border-color: var(--success, #22c55e);
		background: var(--success-bg, #f0fdf4);
	}

	.gt-card-header {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.gt-card-icon {
		font-size: 20px;
	}
	.gt-card-name {
		font-size: 15px;
		font-weight: 600;
		color: var(--text-primary, #1f2937);
		flex: 1;
	}
	.gt-done-badge {
		font-size: 11px;
		padding: 2px 8px;
		background: var(--success, #22c55e);
		color: white;
		border-radius: 10px;
	}
	.gt-card-pitch {
		font-size: 13px;
		color: var(--text-secondary, #6b7280);
		line-height: 1.5;
	}
	.gt-card-meta {
		display: flex;
		gap: 12px;
		font-size: 11px;
		color: var(--text-secondary, #6b7280);
		align-items: center;
	}
	/* agent 四幕卡的深链引导 */
	.gt-link {
		color: var(--brand, #2563eb);
		font-weight: 600;
	}
	/* 四幕区尾的会话验证器入口 */
	.gt-viewer-cta {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		margin-top: 12px;
		padding: 10px 14px;
		border: 1px dashed var(--border, #e5e7eb);
		border-radius: 8px;
		font-size: 12px;
		color: var(--text-secondary, #6b7280);
	}
	.gt-viewer-btn {
		padding: 6px 12px;
		border-radius: 6px;
		border: 1px solid var(--brand, #2563eb);
		background: transparent;
		color: var(--brand, #2563eb);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.gt-viewer-btn:hover {
		background: var(--bg-hover, #f3f4f6);
	}

	@media (max-width: 768px) {
		.gt-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
