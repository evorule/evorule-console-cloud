<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  /compute 路由 — 确定性计算工坊(层 2 呈现面:量纲+计算能力交互化)。
  两件工具:
    ① 公式量纲验证器(inference_dimension_verify_formula)——AI 给的公式
      单位过不过,机器说了算(经典演示:E = m*v 被抓)
    ② 量纲感知计算器(numeric_dim_eval)——结果带单位与精确分数,
      bitwise_replayable
  模式语义:http(联网/本地/代理)接真 evorule-server 实测;mock/wasm 无
  服务面,呈现内置黄金例(实测过的确定性结果,附连接引导)——mock 不造假
  声称"已实测",只展示存档结果。
-->

<script lang="ts">
  import { useBackend } from "$lib/kernel";
  import { CloudHttpBackend } from "$lib/backend/cloud-http-backend";
  import { IS_MOCK, IS_WASM } from "$lib/config/backend-kind";
  import { toastError } from "$lib/stores/toast";

  const backend = useBackend();
  const cloud = backend instanceof CloudHttpBackend ? backend : null;
  const offlineShowcase = IS_MOCK || IS_WASM || cloud === null;

  // ── ① 公式量纲验证器 ──────────────────────────────────────────
  let formulasText = $state("F = m*a\nE = m*v\nv = g*t");
  let unitsText = $state("F=N\nm=kg\na=m/s^2\nE=J\nv=m/s\ng=m/s^2\nt=s");

  interface FormulaRow {
    formula: string;
    passed: boolean;
    message: string;
  }
  let formulaRows = $state<FormulaRow[]>([]);
  let verifying = $state(false);

  async function verifyFormulas(): Promise<void> {
    if (!cloud) return;
    const formulas = formulasText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const si_units: Record<string, string> = {};
    for (const line of unitsText.split("\n")) {
      const idx = line.indexOf("=");
      if (idx <= 0) continue;
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k && v) si_units[k] = v;
    }
    verifying = true;
    try {
      const res = await cloud.invokeService<{
        results?: Array<{ formula: string; passed: boolean; message: string }>;
      }>("inference_dimension_verify_formula", { formulas, si_units });
      formulaRows = res.results ?? [];
    } catch (e) {
      toastError((e as Error).message, "量纲验证失败");
    } finally {
      verifying = false;
    }
  }

  // ── ② 量纲感知计算器 ──────────────────────────────────────────
  let expr = $state("9.8 m/s^2 * 2 s");
  interface CalcResult {
    expr: string;
    si_string: string;
    numerator: string;
    denominator: string;
    decimal: string;
  }
  let calc = $state<CalcResult | null>(null);
  let calcError = $state<string | null>(null);
  let calculating = $state(false);

  async function calcExpr(): Promise<void> {
    if (!cloud) return;
    calculating = true;
    calcError = null;
    try {
      const res = await cloud.invokeService<{
        expr: string;
        si_string: string;
        numerator: string;
        denominator: string;
        value_decimal?: { decimal_string?: string };
      }>("numeric_dim_eval", { expr, scale: 6, rounding: "half_even" });
      calc = {
        expr: res.expr,
        si_string: res.si_string,
        numerator: res.numerator,
        denominator: res.denominator,
        decimal: res.value_decimal?.decimal_string ?? "",
      };
    } catch (e) {
      calcError = (e as Error).message;
      calc = null;
    } finally {
      calculating = false;
    }
  }

  // ── 离线黄金例(真机实测过的存档结果,见仓内分析档实证) ─────────
  const GOLDEN_FORMULAS: FormulaRow[] = [
    { formula: "F = m*a", passed: true, message: "量纲一致: kg·m / s² == kg·m / s²" },
    {
      formula: "E = m*v",
      passed: false,
      message: "量纲不一致: 左侧 kg·m² / s² != 右侧 kg·m / s",
    },
    { formula: "v = g*t", passed: true, message: "量纲一致: m / s == m / s" },
  ];
  const GOLDEN_CALC: CalcResult = {
    expr: "9.8 m/s^2 * 2 s",
    si_string: "m / s",
    numerator: "98",
    denominator: "5",
    decimal: "19.600000",
  };
</script>

<svelte:head>
  <title>确定性计算 · evorule</title>
</svelte:head>

<div class="cp">
  <header class="cp-header">
    <h1>🧮 确定性计算工坊</h1>
    <p class="cp-sub">
      单位过不过、公式对不对——机器说了算,结果 bitwise_replayable,不信任任何模型心算
    </p>
  </header>

  {#if offlineShowcase}
    <div class="cp-offline" role="note">
      当前为{IS_WASM ? "本地 WASM" : "演示"}模式——下方为真机实测过的黄金存档结果;
      连接 evorule-server(设置 → 网络,本地 127.0.0.1:18080)即可输入任意公式实测。
    </div>
  {/if}

  <!-- ① 公式量纲验证器 -->
  <section class="cp-section">
    <h2 class="cp-title">① 公式量纲验证器</h2>
    <p class="cp-desc">
      声明变量单位,逐行输入公式(如 <code>E = m*c^2</code>)——量纲引擎推导两侧量纲并判定一致性。
      经典对照:<code>F = m*a</code> 通过,<code>E = m*v</code> 被抓(动能≠动量)。
    </p>
    <div class="cp-grid">
      <label class="cp-label">
        变量单位(每行 变量=单位)
        <textarea bind:value={unitsText} rows="7" spellcheck="false" class="cp-ta"></textarea>
      </label>
      <label class="cp-label">
        公式(每行一条)
        <textarea bind:value={formulasText} rows="7" spellcheck="false" class="cp-ta"></textarea>
      </label>
    </div>
    <div class="cp-actions">
      <button
        class="cp-btn cp-btn-primary"
        onclick={() => void verifyFormulas()}
        disabled={offlineShowcase || verifying}
      >
        {verifying ? "验证中…" : "🔍 验证量纲"}
      </button>
    </div>
    {#if formulaRows.length > 0 || offlineShowcase}
      <table class="cp-table" aria-label="量纲验证结果">
        <thead>
          <tr><th>公式</th><th>判定</th><th>说明</th></tr>
        </thead>
        <tbody>
          {#each (formulaRows.length > 0 ? formulaRows : GOLDEN_FORMULAS) as row}
            <tr class:bad={!row.passed}>
              <td class="cp-mono">{row.formula}</td>
              <td>{row.passed ? "✅ 一致" : "❌ 不一致"}</td>
              <td class="cp-msg">{row.message}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <!-- ② 量纲感知计算器 -->
  <section class="cp-section">
    <h2 class="cp-title">② 量纲感知计算器</h2>
    <p class="cp-desc">
      表达式直接带单位字面量(支持 <code>^</code> 幂与负幂)——精确有理数求值,结果带单位与分数形式。
    </p>
    <div class="cp-calc">
      <input
        bind:value={expr}
        class="cp-input"
        spellcheck="false"
        placeholder="如 9.8 m/s^2 * 2 s"
      />
      <button
        class="cp-btn cp-btn-primary"
        onclick={() => void calcExpr()}
        disabled={offlineShowcase || calculating}
      >
        {calculating ? "计算中…" : "🧮 计算"}
      </button>
    </div>
    {#if calc || offlineShowcase}
      {@const r = calc ?? GOLDEN_CALC}
      <div class="cp-result" class:err={calcError}>
        {#if calcError}
          {calcError}
        {:else}
          <span class="cp-mono">{r.expr}</span> =
          <strong class="cp-mono">{r.decimal}</strong>
          <span class="cp-unit">{r.si_string}</span>
          <span class="cp-frac">(精确分数 {r.numerator}/{r.denominator})</span>
        {/if}
      </div>
    {/if}
  </section>

  <section class="cp-foot">
    <span>
      服务来源:inference_dimension_verify_formula / numeric_dim_eval(evorule-server
      原生服务,结果带 determined · bitwise_replayable 信封)
    </span>
  </section>
</div>

<style>
  .cp {
    max-width: 880px;
    margin: 0 auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .cp-header h1 {
    margin: 0 0 4px 0;
    font-size: 22px;
    color: var(--text-primary);
  }
  .cp-sub {
    margin: 0;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .cp-offline {
    padding: 10px 14px;
    border-radius: var(--r-sm);
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: 12px;
  }
  .cp-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
  }
  .cp-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .cp-desc {
    margin: 0;
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.6;
  }
  .cp-desc code {
    background: var(--bg-hover);
    padding: 0 4px;
    border-radius: 4px;
  }
  .cp-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .cp-label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .cp-ta {
    font-family: monospace;
    font-size: 13px;
    padding: 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-sm);
    background: var(--bg-input);
    color: var(--text-primary);
    resize: vertical;
  }
  .cp-actions {
    display: flex;
    gap: 10px;
  }
  .cp-btn {
    padding: 8px 16px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border-strong);
    background: var(--bg-card);
    color: var(--text-primary);
    font-size: 13px;
    cursor: pointer;
  }
  .cp-btn-primary {
    border-color: var(--brand);
    color: var(--brand);
  }
  .cp-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .cp-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .cp-table th,
  .cp-table td {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .cp-table tr.bad td {
    background: var(--danger-bg);
  }
  .cp-mono {
    font-family: monospace;
  }
  .cp-msg {
    color: var(--text-secondary);
    font-size: 12px;
  }
  .cp-calc {
    display: flex;
    gap: 10px;
  }
  .cp-input {
    flex: 1;
    font-family: monospace;
    font-size: 14px;
    padding: 10px 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-sm);
    background: var(--bg-input);
    color: var(--text-primary);
  }
  .cp-result {
    padding: 12px 14px;
    border-radius: var(--r-sm);
    background: var(--success-bg);
    color: var(--text-primary);
    font-size: 14px;
  }
  .cp-result.err {
    background: var(--danger-bg);
    color: var(--danger);
  }
  .cp-unit {
    font-weight: 600;
    color: var(--brand);
    margin-left: 6px;
  }
  .cp-frac {
    margin-left: 8px;
    font-size: 11px;
    color: var(--text-secondary);
  }
  .cp-foot {
    font-size: 11px;
    color: var(--text-muted);
  }
</style>
