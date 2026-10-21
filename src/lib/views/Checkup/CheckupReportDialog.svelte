<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  规则库静态体检报告浮层(C2)。
  红黄绿总分 + 四分项(冲突/环路/收敛/效果) + 跳过清单 + 确定性信封 +
  诚实边界声明(静态分析只报告不拦截)。
  打印(D3):报告区为打印根,打印时隐藏其余应用面(body.printing-checkup)。
-->

<script lang="ts">
  import type { CheckupReport } from "$lib/rules-checkup/checkup";
  import { fmtTime } from "$lib/locale";

  let {
    report,
    onclose,
  }: {
    report: CheckupReport;
    onclose: () => void;
  } = $props();

  const VERDICT_META: Record<string, { label: string; cls: string }> = {
    green: { label: "✅ 绿 · 干净", cls: "ok" },
    yellow: { label: "🟡 黄 · 需关注", cls: "warn" },
    red: { label: "🔴 红 · 有发现", cls: "bad" },
  };

  function printReport(): void {
    document.body.classList.add("printing-checkup");
    const cleanup = () => {
      document.body.classList.remove("printing-checkup");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
    // Safari 无 afterprint 的兜底
    window.setTimeout(cleanup, 2000);
  }
</script>

<div class="ck-overlay" role="dialog" aria-label="规则库静态体检报告">
  <div class="ck-dialog ck-print-root">
    <header class="ck-head">
      <div>
        <h2>🩺 规则库静态体检报告</h2>
        <p class="ck-meta">
          {fmtTime(report.ranAt)} · 规则 {report.ruleCount} 条 · 指纹
          <code>{report.fingerprint}</code> · {report.determinism}
        </p>
      </div>
      <div class="ck-head-actions no-print">
        <button class="ck-btn" onclick={printReport}>🖨️ 打印报告</button>
        <button class="ck-btn" onclick={onclose}>关闭</button>
      </div>
    </header>

    <div class="ck-total {VERDICT_META[report.overall].cls}">
      总评:{VERDICT_META[report.overall].label}
    </div>

    <section class="ck-items">
      {#each report.items as item (item.key)}
        <div class="ck-item {VERDICT_META[item.verdict].cls}">
          <h3>
            {VERDICT_META[item.verdict].label.split(" ")[0]} {item.title}
          </h3>
          {#if item.status === "error"}
            <p class="ck-err">服务执行失败(不影响其余项):{item.error}</p>
          {:else if item.findings.length === 0}
            <p class="ck-clean">无发现</p>
          {:else}
            <ul class="ck-findings">
              {#each item.findings as f}
                <li>{f}</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </section>

    {#if report.skipped.length > 0}
      <section class="ck-skipped">
        <h3>未纳入体检的规则({report.skipped.length})</h3>
        <ul>
          {#each report.skipped as s}
            <li>{s.name}:{s.reason}</li>
          {/each}
        </ul>
      </section>
    {/if}

    <footer class="ck-foot">
      诚实边界:静态分析只报告、不拦截;收敛检测对静态不可判定子集显式
      undetermined(黄),不假装判定。复查同规则集结果逐字段一致(确定性)。
    </footer>
  </div>
</div>

<style>
  .ck-overlay {
    position: fixed;
    inset: 0;
    z-index: 1500;
    background: rgba(2, 6, 23, 0.6);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 40px 16px;
    overflow-y: auto;
  }
  .ck-dialog {
    width: min(860px, 100%);
    background: var(--bg-card);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-lg);
    padding: 24px 28px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .ck-head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
  }
  .ck-head h2 {
    margin: 0 0 4px 0;
    font-size: 18px;
    color: var(--text-primary);
  }
  .ck-meta {
    margin: 0;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .ck-meta code {
    font-size: 11px;
  }
  .ck-head-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .ck-btn {
    padding: 7px 14px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border-strong);
    background: var(--bg-card);
    color: var(--text-primary);
    font-size: 13px;
    cursor: pointer;
  }
  .ck-btn:hover {
    background: var(--bg-hover);
  }
  .ck-total {
    padding: 12px 16px;
    border-radius: var(--r-sm);
    font-size: 15px;
    font-weight: 700;
  }
  .ck-total.ok {
    background: var(--success-bg);
    color: var(--success);
  }
  .ck-total.warn {
    background: var(--warning-bg);
    color: var(--warning);
  }
  .ck-total.bad {
    background: var(--danger-bg);
    color: var(--danger);
  }
  .ck-items {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .ck-item {
    border: 1px solid var(--border);
    border-left-width: 4px;
    border-radius: var(--r-sm);
    padding: 12px 14px;
  }
  .ck-item.ok {
    border-left-color: var(--success);
  }
  .ck-item.warn {
    border-left-color: var(--warning);
  }
  .ck-item.bad {
    border-left-color: var(--danger);
  }
  .ck-item h3 {
    margin: 0 0 8px 0;
    font-size: 14px;
    color: var(--text-primary);
  }
  .ck-clean {
    margin: 0;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .ck-err {
    margin: 0;
    font-size: 12px;
    color: var(--warning);
    word-break: break-all;
  }
  .ck-findings {
    margin: 0;
    padding-left: 18px;
    font-size: 12px;
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
    gap: 4px;
    word-break: break-word;
  }
  .ck-skipped h3 {
    margin: 0 0 6px 0;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .ck-skipped ul {
    margin: 0;
    padding-left: 18px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .ck-foot {
    font-size: 11px;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
    padding-top: 10px;
  }

  /* 打印(D3):仅打印报告根,隐藏应用其余面与浮层按钮 */
  :global(body.printing-checkup) * {
    visibility: hidden;
  }
  :global(body.printing-checkup) .ck-print-root,
  :global(body.printing-checkup) .ck-print-root * {
    visibility: visible;
  }
  :global(body.printing-checkup) .ck-print-root {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    border: none;
  }
  @media print {
    .no-print {
      display: none;
    }
  }
</style>
