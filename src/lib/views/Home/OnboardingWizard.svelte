<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:状态 B(建库向导)— 5 步状态机(T2 实现)
    Step 1: 选择行业模板(blank / finance / compliance)
    Step 2: 配置库元数据(库名 + 业务对象),模板路径触发 loadTemplate
    Step 3: 创建首条规则(LLM 辅助 / 业务表单双模式)
            - 模板路径:已有规则,允许"跳过"
            - 空白路径:必须创建一条规则(否则离开向导后仍空库,回 B)
    Step 4: 试运行(createSession + submitCommand,后端离线时优雅降级)
    Step 5: 完成建库,进入工作台(HomeRouter 自动切到状态 C)

  wizardInProgress 生命周期:
    - 挂载时 set true(模板加载规则导致 isEmptyDb=false 也不切到 C)
    - 完成 / 取消 / 卸载时 set false
  依赖:sessionStore / dbStore / homeModeStore.wizardInProgress / 内核 rules store
  关联设计:HOME_DESIGN.md §5.2(OnboardingWizard 组件树)
            P01_BUILD_SCHEMA_DESIGN.md §6.1 + §8(状态机)
            P02_BUSINESS_LANGUAGE_V0_DESIGN.md §9.1(业务语言 v0 集成)
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { initDb, ruleCount } from "$lib/stores/db";
  import { logout } from "$lib/stores/session";
  import {
    autoMode,
    forceDemo,
    setWizardInProgress,
  } from "$lib/stores/home-mode";
  import { toastInfo, toastWarning } from "$lib/stores/toast";
  import { loadTemplate, getTemplate } from "$lib/views/Build/templates";
  import StepTemplatePicker from "$lib/views/Build/WizardSteps/StepTemplatePicker.svelte";
  import StepDbConfig from "$lib/views/Build/WizardSteps/StepDbConfig.svelte";
  import StepFirstRule from "$lib/views/Build/WizardSteps/StepFirstRule.svelte";
  import StepTrialRun from "$lib/views/Build/WizardSteps/StepTrialRun.svelte";
  import StepComplete from "$lib/views/Build/WizardSteps/StepComplete.svelte";

  // === 5 步状态机 ===
  // step: 1=模板选择 / 2=库配置 / 3=首条规则 / 4=试运行 / 5=完成
  let step = $state<1 | 2 | 3 | 4 | 5>(1);

  // === 共享状态(跨步骤传递) ===
  let template = $state<"blank" | "finance" | "compliance" | null>(null);
  let dbName = $state<string>("");
  let businessObjects = $state<string[]>([]);
  // Step 2 loadTemplate 返回的规则 id 列表(模板路径用)
  let templateLoadedRuleIds = $state<string[]>([]);
  // Step 3 创建的规则 id(Step 4 试运行用;模板跳过时回退到 templateLoadedRuleIds[0])
  let createdRuleId = $state<string | null>(null);

  // === wizardInProgress 生命周期 ===
  // 挂载时锁定 HomeRouter 保持在状态 B;卸载时兜底释放(避免泄漏)
  onMount(() => {
    setWizardInProgress(true);
  });

  onDestroy(() => {
    setWizardInProgress(false);
  });

  // === Step 1 → 2 ===
  function handleTemplateSelect(id: "blank" | "finance" | "compliance"): void {
    template = id;
    step = 2;
  }

  // === Step 2 → 3 ===
  function handleDbConfirm(): void {
    if (template === "blank") {
      // 空白库:仅初始化库元数据,不加规则(Step 3 必须创建一条)
      initDb(dbName, businessObjects, "blank");
      templateLoadedRuleIds = [];
    } else if (template === "finance" || template === "compliance") {
      // 模板库:初始化库 + 加载 builtin 规则 + 关联业务元数据
      // 模板加载会让 isEmptyDb 变 false,但 wizardInProgress=true 阻止 HomeRouter 切到 C
      try {
        templateLoadedRuleIds = loadTemplate(template, dbName);
        // 默认指向模板第一条规则,允许 Step 3 直接跳过
        createdRuleId = templateLoadedRuleIds[0] ?? null;
      } catch (e) {
        toastInfo(`模板加载失败: ${(e as Error).message}`, "建库向导");
        return;
      }
    } else {
      // template === null(理论上不会到这里,防御性处理)
      initDb(dbName, businessObjects, "blank");
      templateLoadedRuleIds = [];
    }
    step = 3;
  }

  // === Step 3 → 4 ===
  function handleRuleCreated(ruleId: string): void {
    createdRuleId = ruleId;
    step = 4;
  }

  // Step 3 跳过(仅模板路径允许,空白路径必须创建规则)
  function handleRuleSkip(): void {
    if (templateLoadedRuleIds.length === 0) {
      toastWarning("空白库必须创建至少一条规则", "建库向导");
      return;
    }
    createdRuleId = templateLoadedRuleIds[0];
    step = 4;
  }

  // === Step 4 → 5 ===
  function handleTrialNext(): void {
    step = 5;
  }

  // === Step 5 完成 ===
  function handleComplete(): void {
    // 释放 wizardInProgress → HomeRouter 自动切到状态 C(此时有库 + 有规则)
    setWizardInProgress(false);
    autoMode();
  }

  // === 顶层取消(任意步骤可触发) ===
  function handleCancel(): void {
    setWizardInProgress(false);
    logout();
    forceDemo();
    toastInfo("已退出建库向导", "取消");
  }

  // === 步骤回退 ===
  function handleBack(target: 1 | 2 | 3 | 4): void {
    step = target;
  }

  // === 派生:Step 3 是否允许跳过 ===
  const canSkipStep3 = $derived(
    templateLoadedRuleIds.length > 0 || $ruleCount > 0,
  );

  // === 模板对象(Step 2 展示用) ===
  const templateObj = $derived(template ? getTemplate(template) : null);

  // === 步骤定义(用于头部进度指示) ===
  const STEPS = [
    { num: 1, title: "选择行业模板", desc: "空白 / 财务 / 合规模板" },
    { num: 2, title: "配置库元数据", desc: "库名 / 业务对象 / 行业" },
    { num: 3, title: "创建首条规则", desc: "LLM 辅助 / 业务表单" },
    { num: 4, title: "试运行验证", desc: "提交事件,看触发结果" },
    { num: 5, title: "完成建库", desc: "进入工作台" },
  ] as const;
</script>

<section class="onboarding-wizard">
  <div class="wizard-header">
    <h2>🏗️ 建库向导</h2>
    <p>5 分钟跑通你的第一条 evorule 规则</p>
    <button class="cancel-link" onclick={handleCancel} type="button">
      取消,回 demo
    </button>
  </div>

  <!-- 步骤进度指示器 -->
  <ol class="steps-progress">
    {#each STEPS as s (s.num)}
      <li
        class="progress-step"
        class:done={step > s.num}
        class:active={step === s.num}
      >
        <span class="progress-num">{s.num}</span>
        <div class="progress-content">
          <div class="progress-title">{s.title}</div>
          <div class="progress-desc">{s.desc}</div>
        </div>
      </li>
    {/each}
  </ol>

  <!-- 步骤主体(根据 step 切换) -->
  <div class="step-container">
    {#if step === 1}
      <StepTemplatePicker selected={template} onSelect={handleTemplateSelect} />
    {:else if step === 2}
      <StepDbConfig
        template={templateObj}
        bind:dbName
        bind:businessObjects
        onConfirm={handleDbConfirm}
        onBack={() => handleBack(1)}
      />
    {:else if step === 3}
      <div class="step3-wrapper">
        <StepFirstRule
          {template}
          {businessObjects}
          onCreated={handleRuleCreated}
          onBack={() => handleBack(2)}
        />
        {#if canSkipStep3}
          <div class="skip-bar">
            <span class="skip-hint">
              模板已加载 {templateLoadedRuleIds.length} 条规则,可直接进入下一步
            </span>
            <button class="btn-skip" onclick={handleRuleSkip} type="button">
              跳过此步 →
            </button>
          </div>
        {/if}
      </div>
    {:else if step === 4}
      <StepTrialRun
        {createdRuleId}
        onBack={() => handleBack(3)}
        onNext={handleTrialNext}
      />
    {:else if step === 5}
      <StepComplete onComplete={handleComplete} />
    {/if}
  </div>
</section>

<style>
  .onboarding-wizard {
    max-width: 760px;
    margin: 0 auto;
    padding: 32px 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .wizard-header {
    text-align: center;
    position: relative;
  }
  .wizard-header h2 {
    font-size: 26px;
    font-weight: 700;
    margin: 0 0 6px 0;
    color: var(--color-text-primary, #1e293b);
  }
  .wizard-header p {
    font-size: 14px;
    color: var(--color-text-secondary, #64748b);
    margin: 0;
  }
  .cancel-link {
    position: absolute;
    top: 0;
    right: 0;
    background: none;
    border: none;
    color: var(--color-text-secondary, #64748b);
    font-size: 12px;
    cursor: pointer;
    text-decoration: underline;
    padding: 4px 8px;
  }
  .cancel-link:hover {
    color: var(--color-error-text, var(--color-error, #991b1b));
  }

  /* 步骤进度指示器 */
  .steps-progress {
    list-style: none;
    padding: 16px;
    margin: 0;
    background: var(--color-gray-50, #f8fafc);
    border-radius: 8px;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 8px;
  }
  .progress-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 6px;
    padding: 6px 4px;
    border-radius: 6px;
    transition: background 0.15s ease;
  }
  .progress-step.active {
    background: var(--color-primary-bg, var(--color-info-bg, #eff6ff));
  }
  .progress-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--color-gray-300, #cbd5e1);
    color: white;
    font-size: 12px;
    font-weight: 600;
  }
  .progress-step.active .progress-num {
    background: var(--color-primary, #2563eb);
    box-shadow: 0 0 0 3px var(--color-primary-bg, var(--color-info-bg, #eff6ff));
  }
  .progress-step.done .progress-num {
    background: var(--color-success, #16a34a);
  }
  .progress-content {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .progress-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-primary, #1e293b);
  }
  .progress-step:not(.active):not(.done) .progress-title {
    color: var(--color-text-secondary, #64748b);
  }
  .progress-desc {
    font-size: 10px;
    color: var(--color-text-secondary, #64748b);
    line-height: 1.3;
  }

  /* 步骤主体容器 */
  .step-container {
    background: white;
    border: 1px solid var(--color-gray-200, #e2e8f0);
    border-radius: 8px;
    padding: 20px;
    min-height: 320px;
  }

  /* Step 3 跳过条 */
  .step3-wrapper {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .skip-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    background: var(--color-info-bg, #dbeafe);
    border-radius: 6px;
    font-size: 12px;
    color: var(--color-info-text, var(--color-info, #1e40af));
  }
  .skip-hint {
    flex: 1;
  }
  .btn-skip {
    padding: 6px 14px;
    background: white;
    border: 1px solid var(--color-info-text, var(--color-info, #1e40af));
    color: var(--color-info-text, var(--color-info, #1e40af));
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
  }
  .btn-skip:hover {
    background: var(--color-info-bg, #dbeafe);
  }
</style>
