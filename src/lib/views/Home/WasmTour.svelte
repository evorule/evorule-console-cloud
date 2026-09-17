<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  WASM 在线模式 7 步引导(WasmTour)。
  对齐体验包 QUICKSTART.md 7 步教学,在 ?backend=wasm 下渲染。
  职责:
    - 展示 7 步序列(引擎就绪/浏览规则/放行/阻断/医疗/审计验证/时间旅行)
    - 每步点击 CTA 直接驱动 WASM backend,按返回状态判定完成
    - 进度持久化到 localStorage(wasmTourProgressStore),刷新可恢复
  与 demo 4 任务互不影响;HTTP/mock 模式不挂载本组件。
-->

<script lang="ts">
	import { get } from "svelte/store";
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import {
		WASM_TOUR_STEPS,
		type WasmTourStep,
	} from "$lib/data/guided-tasks";
	import {
		wasmTourProgressStore,
		markWasmTourStepComplete,
		isWasmTourComplete,
	} from "$lib/stores/wasm-tour";
	import { toastSuccess, toastInfo } from "$lib/stores/toast";
	import { useBackendOrNull } from "$lib/kernel/backend/backend-context";
	import {
		createSession,
		submitCommand,
		sessionState,
		currentSessionId,
	} from "$lib/kernel/stores/session";
	import type { SessionId } from "$lib/kernel";

	const backend = useBackendOrNull();

	// === 瞬态 UI 状态 ===
	let running = $state(false);
	/** 当前正在执行的步骤 ID(按钮 spinner) */
	let runningStep = $state<string | null>(null);
	/** 最近一次执行的反馈文本 */
	let feedback = $state<{ stepId: string; text: string; ok: boolean } | null>(null);
	/** 第 1 步是否正在自动体检 */
	let checkingEngine = $state(false);

	const done = $derived($wasmTourProgressStore);
	const completedCount = $derived(
		WASM_TOUR_STEPS.filter((s) => done[s.id]).length,
	);
	const allDone = $derived(isWasmTourComplete());

	/** 当前「下一步」(第一个未完成步骤),用于高亮与自动体检 */
	const nextStep = $derived(
		WASM_TOUR_STEPS.find((s) => !done[s.id]) ?? null,
	);

	// === 会话工具:确保有一个当前 session(跑指令/审计/时间旅行都需要) ===
	async function ensureSession(): Promise<SessionId | null> {
		if (!backend) return null;
		const cur = get(currentSessionId);
		if (cur !== null) return cur;
		const id = await createSession(backend);
		return id;
	}

	/** 从 submitCommand 后的 sessionState 读 payload.data.result.decision */
	function readDecision(): { decision?: string; reason?: string } {
		const st = get(sessionState);
		const payload = st?.payload as Record<string, unknown> | undefined;
		const data = payload?.data as Record<string, unknown> | undefined;
		const result = data?.result as Record<string, unknown> | undefined;
		return {
			decision: result?.decision as string | undefined,
			reason: result?.reason as string | undefined,
		};
	}

	// === 第 1 步:引擎就绪(挂载时自动体检一次) ===
	let engineTried = false;
	$effect(() => {
		if (engineTried) return;
		engineTried = true;
		void doEngineCheck();
	});

	async function doEngineCheck() {
		if (!backend || done["wasm_01_engine"]) return;
		running = true;
		checkingEngine = true;
		runningStep = "wasm_01_engine";
		try {
			const ok = await backend.health();
			if (!ok) {
				feedback = {
					stepId: "wasm_01_engine",
					text: "引擎健康检查未通过,请刷新页面重试。",
					ok: false,
				};
				return;
			}
			markWasmTourStepComplete("wasm_01_engine");
			feedback = {
				stepId: "wasm_01_engine",
				text: "引擎就绪 ✓ 16 条业务规则已加载到浏览器内引擎(等保门禁 / 财务限额 / 医疗用药)。",
				ok: true,
			};
		} catch (e) {
			feedback = {
				stepId: "wasm_01_engine",
				text: `引擎初始化失败:${(e as Error).message}`,
				ok: false,
			};
		} finally {
			running = false;
			checkingEngine = false;
			runningStep = null;
		}
	}

	// === 第 2 步:浏览规则(跳转规则库) ===
	function doVisitRules() {
		markWasmTourStepComplete("wasm_02_rules");
		feedback = {
			stepId: "wasm_02_rules",
			text: "已完成浏览——现在去规则库看看。",
			ok: true,
		};
		void goto(`${base}/view/rules`);
	}

	// === 第 3/4/5 步:跑指令 ===
	async function doRunInstruction(step: WasmTourStep) {
		if (!backend || running) return;
		const id = await ensureSession();
		if (id === null || !step.instruction) {
			feedback = { stepId: step.id, text: "无法创建会话,请刷新页面重试。", ok: false };
			return;
		}
		running = true;
		runningStep = step.id;
		try {
			const result = await submitCommand(backend, step.instruction);
			if (!result || !result.accepted) {
				feedback = {
					stepId: step.id,
					text: `指令未被接受:${result?.error ?? "未知错误"}`,
					ok: false,
				};
				return;
			}
			const { decision, reason } = readDecision();
			const expected = step.expectedDecision;
			const hit = decision === expected;
			feedback = {
				stepId: step.id,
				text: `决策 = ${decision ?? "(空)"}${reason ? ` · ${reason}` : ""}${
					hit ? ` ✅ 符合预期(${expected})` : ` ⚠ 期望 ${expected}`
				}`,
				ok: hit,
			};
			if (hit) {
				markWasmTourStepComplete(step.id);
				toastSuccess(`完成:${step.name}`, "WASM 引导");
			}
		} catch (e) {
			feedback = {
				stepId: step.id,
				text: `执行失败:${(e as Error).message}`,
				ok: false,
			};
		} finally {
			running = false;
			runningStep = null;
		}
	}

	// === 第 6 步:验证审计链 ===
	async function doVerifyAudit() {
		if (!backend || running) return;
		const id = await ensureSession();
		if (id === null) return;
		running = true;
		runningStep = "wasm_06_audit";
		try {
			const res = await backend.verifyAudit(id);
			feedback = {
				stepId: "wasm_06_audit",
				text: res.verified
					? "BLAKE3 审计链验证通过 ✓ 未发现篡改。"
					: "审计链校验失败:哈希不连续,可能被篡改。",
				ok: res.verified,
			};
			if (res.verified) {
				markWasmTourStepComplete("wasm_06_audit");
				toastSuccess("完成:验证审计链", "WASM 引导");
			}
		} catch (e) {
			feedback = {
				stepId: "wasm_06_audit",
				text: `验证失败:${(e as Error).message}`,
				ok: false,
			};
		} finally {
			running = false;
			runningStep = null;
		}
	}

	// === 第 7 步:时间旅行 ===
	async function doTimeTravel() {
		if (!backend || running) return;
		const id = await ensureSession();
		if (id === null) return;
		running = true;
		runningStep = "wasm_07_timetravel";
		try {
			const st = get(sessionState);
			const curVer = st?.version ?? 0;
			const from = Math.max(0, curVer - 1);
			const snap = await backend.getStateAtVersion(id, from);
			const diff = await backend.getDiff(id, from, curVer);
			const changed = (diff.items?.length ?? 0) + (diff.removed?.length ?? 0);
			markWasmTourStepComplete("wasm_07_timetravel");
			feedback = {
				stepId: "wasm_07_timetravel",
				text: `已回溯到 v${snap.version} 并对比 v${curVer}:检测到 ${changed} 项字段级变更。`,
				ok: true,
			};
			toastSuccess("完成:时间旅行", "WASM 引导");
		} catch (e) {
			feedback = {
				stepId: "wasm_07_timetravel",
				text: `时间旅行失败:${(e as Error).message}`,
				ok: false,
			};
		} finally {
			running = false;
			runningStep = null;
		}
	}

	/** 单步 CTA 分发 */
	function handleStepAction(step: WasmTourStep) {
		switch (step.action) {
			case "engine_ready":
				void doEngineCheck();
				break;
			case "visit_rules":
				doVisitRules();
				break;
			case "run_instruction":
				void doRunInstruction(step);
				break;
			case "verify_audit":
				void doVerifyAudit();
				break;
			case "time_travel":
				void doTimeTravel();
				break;
		}
	}

	function ctaLabel(step: WasmTourStep): string {
		if (runningStep === step.id) {
			return step.action === "engine_ready" ? "加载引擎中…" : "执行中…";
		}
		switch (step.action) {
			case "engine_ready":
				return "确认引擎就绪";
			case "visit_rules":
				return "查看规则库 →";
			case "run_instruction":
				return "运行指令";
			case "verify_audit":
				return "验证审计链";
			case "time_travel":
				return "时间旅行回放";
		}
	}
</script>

<div class="wasm-tour">
	<div class="wt-header">
		<h3 class="wt-title">🧪 在线体验 · 7 步跑通 EvoRule(浏览器内 WASM 引擎)</h3>
		<span class="wt-progress">已完成 {completedCount}/7</span>
	</div>
	<p class="wt-sub">
		无需安装、无需本地服务——规则引擎直接跑在你的浏览器里。按顺序点完 7 步,约 3 分钟看懂「确定性决策 + 不可篡改审计 + 时间旅行」。
	</p>

	<ol class="wt-steps">
		{#each WASM_TOUR_STEPS as step (step.id)}
			{@const doneStep = Boolean(done[step.id])}
			{@const isNext = nextStep?.id === step.id}
			<li class="wt-step" class:done={doneStep} class:next={isNext}>
				<div class="wt-step-head">
					<span class="wt-step-no">{doneStep ? "✓" : step.order}</span>
					<span class="wt-step-icon">{step.icon}</span>
					<span class="wt-step-name">{step.name}</span>
					{#if doneStep}
						<span class="wt-done-badge">已完成</span>
					{/if}
				</div>
				<p class="wt-step-pitch">{step.pitch}</p>

				{#if !doneStep}
					<div class="wt-step-action">
						<button
							class="wt-btn"
							disabled={running && runningStep !== step.id}
							onclick={() => handleStepAction(step)}
						>
							{ctaLabel(step)}
						</button>
						{#if step.instruction}
							<pre class="wt-instr">{JSON.stringify(step.instruction, null, 2)}</pre>
						{/if}
					</div>
				{:else if feedback && feedback.stepId === step.id}
					<div class="wt-step-feedback" class:ok={feedback.ok}>
						{feedback.text}
						<div class="wt-step-explain">{step.explain}</div>
					</div>
				{:else}
					<div class="wt-step-explain">{step.explain}</div>
				{/if}

				{#if !doneStep && feedback && feedback.stepId === step.id && !feedback.ok}
					<div class="wt-step-feedback err">{feedback.text}</div>
				{/if}
			</li>
		{/each}
	</ol>

	{#if allDone}
		<div class="wt-complete" role="status">
			<h4>🎉 7 步全部完成!</h4>
			<p>你已经在浏览器里跑通了 EvoRule 的完整链路:放行/阻断决策、医疗用药门禁、BLAKE3 审计链验证、时间旅行回放。</p>
			<div class="wt-complete-actions">
				<button class="wt-btn" onclick={() => void goto(`${base}/view/rules`)}>继续浏览规则 →</button>
				<button class="wt-btn ghost" onclick={() => void goto(`${base}/audit`)}>打开审计视图 →</button>
				<button
					class="wt-btn ghost"
					onclick={() =>
						toastInfo("下载本地体验包可获得完整规则编辑与热重载能力", "下一步")
					}
				>下载本地体验包</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.wasm-tour {
		padding: 0;
	}
	.wt-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
	}
	.wt-title {
		font-size: 16px;
		font-weight: 600;
		margin: 0;
		color: var(--text-primary, #f1f5f9);
	}
	.wt-progress {
		font-size: 13px;
		color: var(--success, #22c55e);
		font-weight: 600;
	}
	.wt-sub {
		font-size: 13px;
		color: var(--text-secondary, #94a3b8);
		line-height: 1.6;
		margin: 0 0 16px;
	}
	.wt-steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.wt-step {
		padding: 14px 16px;
		background: var(--bg-card, #0d1117);
		border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
		border-radius: 8px;
		border-left: 3px solid var(--border, rgba(255, 255, 255, 0.12));
	}
	.wt-step.next {
		border-left-color: var(--brand, #2563eb);
	}
	.wt-step.done {
		border-left-color: var(--success, #22c55e);
		background: rgba(34, 197, 94, 0.06);
	}
	.wt-step-head {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 6px;
	}
	.wt-step-no {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--bg-hover, rgba(255, 255, 255, 0.06));
		color: var(--text-secondary, #94a3b8);
		font-size: 12px;
		font-weight: 700;
		flex-shrink: 0;
	}
	.wt-step.done .wt-step-no {
		background: var(--success, #22c55e);
		color: #fff;
	}
	.wt-step-icon {
		font-size: 18px;
	}
	.wt-step-name {
		font-size: 15px;
		font-weight: 600;
		color: var(--text-primary, #f1f5f9);
		flex: 1;
	}
	.wt-done-badge {
		font-size: 11px;
		padding: 2px 8px;
		background: var(--success, #22c55e);
		color: #fff;
		border-radius: 10px;
	}
	.wt-step-pitch {
		font-size: 13px;
		color: var(--text-secondary, #cbd5e1);
		line-height: 1.6;
		margin: 0 0 10px;
	}
	.wt-step-action {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.wt-btn {
		align-self: flex-start;
		padding: 6px 16px;
		background: var(--brand, #2563eb);
		color: #fff;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		font-size: 13px;
		font-weight: 500;
		transition: opacity 0.15s ease;
	}
	.wt-btn:hover:not(:disabled) {
		opacity: 0.9;
	}
	.wt-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.wt-btn.ghost {
		background: transparent;
		border: 1px solid var(--border, rgba(255, 255, 255, 0.15));
		color: var(--text-primary, #f1f5f9);
	}
	.wt-instr {
		margin: 0;
		padding: 8px 10px;
		background: var(--bg-primary, #0b1929);
		border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
		border-radius: 6px;
		font-family: var(--font-mono, monospace);
		font-size: 11px;
		color: var(--text-secondary, #94a3b8);
		overflow-x: auto;
	}
	.wt-step-feedback {
		font-size: 13px;
		line-height: 1.6;
		padding: 8px 12px;
		border-radius: 6px;
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.4);
		color: var(--success, #22c55e);
	}
	.wt-step-feedback.err {
		background: rgba(239, 68, 68, 0.1);
		border-color: rgba(239, 68, 68, 0.4);
		color: var(--danger, #ef4444);
	}
	.wt-step-explain {
		font-size: 12px;
		color: var(--text-secondary, #94a3b8);
		margin-top: 4px;
	}
	.wt-complete {
		margin-top: 20px;
		padding: 20px;
		background: rgba(34, 197, 94, 0.08);
		border: 1px solid rgba(34, 197, 94, 0.4);
		border-radius: 10px;
	}
	.wt-complete h4 {
		margin: 0 0 8px;
		font-size: 16px;
		color: var(--success, #22c55e);
	}
	.wt-complete p {
		margin: 0 0 14px;
		font-size: 13px;
		color: var(--text-secondary, #cbd5e1);
		line-height: 1.6;
	}
	.wt-complete-actions {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}
</style>
