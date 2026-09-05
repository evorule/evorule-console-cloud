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

  let {
    onComplete,
  }: {
    onComplete: () => void;
  } = $props();

  function handleEnterWorkbench() {
    toastSuccess("建库完成,已进入工作台", "向导完成");
    // autoMode 让 HomeRouter 自动决策(此时有库 → 状态 C)
    autoMode();
    onComplete();
  }

  // UV-078 W3 方向 b:向导终点从"死胡同"变"换乘站" — 全量规则导出为标准批量包
  // (BatchExportPackage JSON,.evorule-batch.json),供治理中心「从向导包导入」消费
  let exporting = $state(false);

  async function handleExportRules() {
    exporting = true;
    try {
      // 'json':治理导入契约 = 包内 content_base64 解码即原生规则 JSON(零鸿沟直通)。
      // 不传 format 会走默认 'yaml',治理侧 parseWizardBatchPackage 逐条解析失败
      // (UV-078 W3 e2e 实测发现,e2e 段2 走导出中心同样路径复现)
      const blob = await exportRulesBatch([], "json");
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `evorule-wizard-rules-${stamp}.evorule-batch.json`);
      toastSuccess(`已导出 ${$ruleCount} 条规则(批量包 JSON)`, "导出完成");
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e), "导出失败");
    } finally {
      exporting = false;
    }
  }
</script>

<div class="step-complete">
    <div class="complete-icon">🎉</div>
    <h2>建库完成</h2>
    <!-- UV-078 W1-A5:原措辞"可以开始正式使用了"误导 — 本地向导产物存于浏览器 localStorage, -->
    <!-- 执行域(server)仅运行治理链发布的规则,直接去执行台提交会撞"未匹配指令" Error fact。 -->
    <!-- W3 方向 b:边界明示 + 换乘动作组(导出批量包/直达治理中心),终点从死胡同变换乘站。 -->
    <p class="complete-desc">本地规则库已就绪。</p>
    <div class="boundary-note">
      <strong>注意:</strong>规则目前存于<strong>浏览器本地</strong>,执行域(server)仅运行
      <strong>治理链发布</strong>的规则——要让规则真正驱动执行台,需前往
      <a href="/governance" class="gov-link">治理中心</a>走数据集→发布→导入链路。
    </div>

  <div class="summary-card">
    <h3>建库摘要</h3>
    <dl class="summary-list">
      <div class="summary-row">
        <dt>库名</dt>
        <dd>{$dbStore.dbName || "(未命名)"}</dd>
      </div>
      <div class="summary-row">
        <dt>行业</dt>
        <dd>{$dbStore.industry}</dd>
      </div>
      <div class="summary-row">
        <dt>业务对象</dt>
        <dd>{$dbStore.businessObjects.join(" / ") || "(无)"}</dd>
      </div>
      <div class="summary-row">
        <dt>规则数</dt>
        <dd>{$ruleCount}</dd>
      </div>
      <div class="summary-row">
        <dt>创建时间</dt>
        <dd>{$dbStore.createdAt ?? "—"}</dd>
      </div>
    </dl>
  </div>

  <div class="next-steps">
    <h4>下一步建议</h4>
    <ul>
      <li>📊 进入 <strong>L1 监控大屏</strong> 查看实时 Fact 流(T3 实现)</li>
      <li>✏️ 进入 <strong>L2 编辑台</strong> 继续添加 / 编辑规则</li>
      <li>🤖 配置 LLM 设置,启用自然语言生成规则草案</li>
      <li>📁 在规则库中导入 / 导出规则 JSON</li>
    </ul>
  </div>

  <div class="actions">
    <button class="btn-primary btn-large" onclick={handleEnterWorkbench}>
      🚀 进入工作台
    </button>
    <div class="gov-actions">
      <!-- UV-078 W3 方向 b:换乘站动作组 — 导出批量包 + 直达治理中心导入 -->
      <button
        class="btn-secondary"
        onclick={handleExportRules}
        disabled={exporting || $ruleCount === 0}
        data-testid="wizard-export-rules"
      >
        {exporting ? "⏳ 导出中…" : `📤 导出规则 JSON(${$ruleCount} 条)`}
      </button>
      <a
        href="/governance"
        class="btn-link"
        data-testid="wizard-goto-governance"
      >
        🏛 前往治理中心发布
      </a>
    </div>
    <p class="gov-hint">
      导出 .evorule-batch.json 后,在治理中心规则条目区「从向导包导入」一键入库,
      再走 发布 → 部署到执行域 链路,规则即可驱动真实执行台。
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
