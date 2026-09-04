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
  import { toastSuccess } from "$lib/stores/toast";

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
</script>

<div class="step-complete">
    <div class="complete-icon">🎉</div>
    <h2>建库完成</h2>
    <!-- UV-078 W1-A5:原措辞"可以开始正式使用了"误导 — 本地向导产物存于浏览器 localStorage, -->
    <!-- 执行域(server)仅运行治理链发布的规则,直接去执行台提交会撞"未匹配指令" Error fact。 -->
    <!-- 诚实边界 + 下一跳引导(W3 方向 b 将补导出/跳转按钮,此处先明示路径)。 -->
    <p class="complete-desc">本地规则库已就绪。</p>
    <div class="boundary-note">
      <strong>注意:</strong>规则目前存于<strong>浏览器本地</strong>,执行域(server)仅运行
      <strong>治理链发布</strong>的规则——要让规则真正驱动执行台,需前往
      <a href="/governance" class="gov-link">治理中心</a>走数据集→发布→导入链路
      (完整导出引导即将上线)。
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
</style>
