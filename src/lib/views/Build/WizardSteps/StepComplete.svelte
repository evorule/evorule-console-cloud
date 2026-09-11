<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:建库向导步骤 5 — 完成建库
    - 展示建库摘要(库名 / 业务对象 / 规则数)
    - 引导用户进入工作台(HomeRouter 自动切到状态 C)
  关联设计:P01_BUILD_SCHEMA_DESIGN.md §8.1(状态机)+ §10.1
-->

<script lang="ts">
  import { dbStore, ruleCount } from "$lib/stores/db";
  import { autoMode } from "$lib/stores/home-mode";
  import { toastSuccess, toastError } from "$lib/stores/toast";
  import { exportRulesBatch } from "$lib/stores/rule-import-export";
  import { downloadBlob } from "$lib/stores/export-store";
  import { t } from "$lib/locale";

  let {
    onComplete,
  }: {
    onComplete: () => void;
  } = $props();

  function handleEnterWorkbench() {
    // 完成提示统一由 OnboardingWizard.handleComplete 弹一条「下一步」toast,
    // 避免此处与父组件各弹一条导致提示叠加。
    autoMode();
    onComplete();
  }

  // W3 方向 b:向导终点从"死胡同"变"换乘站" — 全量规则导出为标准批量包
  // (BatchExportPackage JSON,.evorule-batch.json),供治理中心「从向导包导入」消费
  let exporting = $state(false);

  async function handleExportRules() {
    exporting = true;
    try {
      // 'json':治理导入契约 = 包内 content_base64 解码即原生规则 JSON(零鸿沟直通)。
      // 不传 format 会走默认 'yaml',治理侧 parseWizardBatchPackage 逐条解析失败
      // (W3 e2e 实测发现,e2e 段2 走导出中心同样路径复现)
      const blob = await exportRulesBatch([], "json");
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `evorule-wizard-rules-${stamp}.evorule-batch.json`);
      toastSuccess(t("complete.toast.exported", { count: $ruleCount }), t("complete.toast.exportTitle"));
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e), t("complete.toast.exportFail"));
    } finally {
      exporting = false;
    }
  }
</script>

<div class="step-complete">
    <div class="complete-icon">🎉</div>
    <h2>{t("complete.title")}</h2>
    <!-- W1-A5:原措辞"可以开始正式使用了"误导 — 本地向导产物存于浏览器 localStorage, -->
    <!-- 执行域(server)仅运行治理链上架的规则,直接去执行台提交会撞"未匹配指令" Error fact。 -->
    <!-- W3 方向 b:边界明示 + 换乘动作组(导出批量包/直达治理中心),终点从死胡同变换乘站。 -->
    <!-- 措辞通俗化 — 用「本地草稿 vs 正式规则」替代技术术语 -->
    <p class="complete-desc">{t("complete.desc")}</p>
    <div class="boundary-note">
      <strong>{t("complete.noticeLabel")}</strong>{t("complete.notePart1")}<strong>{t("complete.localDraft")}</strong>{t("complete.notePart2")}
      <a href="/governance" class="gov-link">{t("complete.governanceCenter")}</a>{t("complete.notePart3")}<strong>{t("complete.publish")}</strong>{t("complete.notePart4")}
    </div>

  <div class="summary-card">
    <h3>{t("complete.summaryTitle")}</h3>
    <dl class="summary-list">
      <div class="summary-row">
        <dt>{t("complete.dbName")}</dt>
        <dd>{$dbStore.dbName || t("complete.unnamed")}</dd>
      </div>
      <div class="summary-row">
        <dt>{t("complete.industry")}</dt>
        <dd>{$dbStore.industry}</dd>
      </div>
      <div class="summary-row">
        <dt>{t("complete.businessObjects")}</dt>
        <dd>{$dbStore.businessObjects.join(" / ") || t("complete.none")}</dd>
      </div>
      <div class="summary-row">
        <dt>{t("complete.ruleCount")}</dt>
        <dd>{$ruleCount}</dd>
      </div>
      <div class="summary-row">
        <dt>{t("complete.createdAt")}</dt>
        <dd>{$dbStore.createdAt ?? "—"}</dd>
      </div>
    </dl>
  </div>

  <div class="next-steps">
    <h4>{t("complete.nextStepsTitle")}</h4>
    <ul>
      <li>{@html t("complete.nextStep1", { term: `<strong>${t("complete.monitorBoard")}</strong>` })}</li>
      <li>{@html t("complete.nextStep2", { term: `<strong>${t("complete.workbenchQuick")}</strong>` })}</li>
      <li>{t("complete.nextStep3")}</li>
      <li>{t("complete.nextStep4")}</li>
    </ul>
  </div>

  <div class="actions">
    <button class="btn-primary btn-large" onclick={handleEnterWorkbench}>
      {t("complete.enterWorkbench")}
    </button>
    <div class="gov-actions">
      <!-- W3 方向 b:换乘站动作组 — 导出批量包 + 直达治理中心导入 -->
      <button
        class="btn-secondary"
        onclick={handleExportRules}
        disabled={exporting || $ruleCount === 0}
        data-testid="wizard-export-rules"
      >
        {exporting ? t("complete.exporting") : t("complete.exportJson", { count: $ruleCount })}
      </button>
      <a
        href="/governance"
        class="btn-link"
        data-testid="wizard-goto-governance"
      >
        {t("complete.gotoGovernance")}
      </a>
    </div>
    <p class="gov-hint">
      {t("complete.govHint")}
    </p>
  </div>
</div>

<style>
  .step-complete {
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: center;
  }
  .complete-icon {
    font-size: 56px;
    margin-bottom: 4px;
  }
  h2 {
    font-size: 24px;
    margin: 0;
    color: var(--text-primary, #1e293b);
  }
  .complete-desc {
    font-size: 14px;
    color: var(--text-secondary, #64748b);
    margin: 0;
  }
  .boundary-note {
    max-width: 480px;
    padding: 12px 16px;
    background: var(--warning-bg, #fef3c7);
    border: 1px solid var(--warning, #f59e0b);
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.7;
    color: var(--text-primary, #1e293b);
    text-align: left;
  }
  .gov-link {
    color: var(--brand, #2563eb);
    font-weight: 600;
  }

  .summary-card {
    width: 100%;
    max-width: 480px;
    background: var(--bg-card);
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 8px;
    padding: 20px;
    text-align: left;
  }
  .summary-card h3 {
    font-size: 15px;
    margin: 0 0 12px 0;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border, #e2e8f0);
  }
  .summary-list {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  dt {
    font-size: 13px;
    color: var(--text-secondary, #64748b);
    flex-shrink: 0;
  }
  dd {
    font-size: 13px;
    color: var(--text-primary, #1e293b);
    margin: 0;
    text-align: right;
    word-break: break-all;
  }

  .next-steps {
    width: 100%;
    max-width: 480px;
    background: var(--info-bg, #dbeafe);
    border-radius: 8px;
    padding: 16px;
    text-align: left;
  }
  .next-steps h4 {
    font-size: 13px;
    margin: 0 0 8px 0;
    color: var(--info, #1e40af);
  }
  .next-steps ul {
    margin: 0;
    padding-left: 20px;
    font-size: 12px;
    color: var(--info, #1e40af);
    line-height: 1.7;
  }

  .actions {
    width: 100%;
    max-width: 480px;
  }
  .btn-large {
    width: 100%;
    padding: 12px;
    font-size: 15px;
  }
  .btn-primary {
    background: var(--brand, #2563eb);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }
  .gov-actions {
    display: flex;
    gap: 10px;
    margin-top: 10px;
  }
  .btn-secondary {
    flex: 1;
    padding: 10px 12px;
    font-size: 13px;
    background: var(--bg-card);
    color: var(--text-primary, #1e293b);
    border: 1px solid var(--brand, #2563eb);
    border-radius: 6px;
    cursor: pointer;
  }
  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-link {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 12px;
    font-size: 13px;
    background: var(--info-bg, #dbeafe);
    color: var(--info, #1e40af);
    border: 1px solid var(--info, #1e40af);
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
  }
  .gov-hint {
    margin: 10px 0 0 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-secondary, #64748b);
    text-align: left;
  }
</style>
