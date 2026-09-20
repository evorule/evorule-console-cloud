<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  AgentWorkspace — Agent 会话台三栏骨架(空壳可导航)
  布局基准: 高保真交互原型定稿(§3.2 布局规范)——统一顶栏由 console 壳承担,
  此处为页内三栏;组件状态枚举与视觉 token 以设计规格为准
  - 左 170px:  上区会话列表(空态占位,后续任务接 localStorage 持久化与续接)
               角色列表(P1 固定 researcher/rule-copilot/general,后续接 listAgents 动态)
               下区工作区文件树(灰显占位,P2 由 file_list 提供)
  - 中自适应:  执行过程视图(头部 标题+会话徽标+角色徽标+审计页入口;主体时间线空态)
  - 右 312px:  Agent 会话流(连接徽标行/对话流空态/输入行;后续任务接 AgentClient)
  门控: agentConfig.enabled 关闭时渲染启用引导(经 ?openSettings=agent 打开设置面板)
  视觉: 全量复用 app.css v3 token,无自造色
-->
<script lang="ts">
  import { base } from "$app/paths";
  import { agentConfig, isAgentConfigured } from "$lib/config/agent-config";
  import { t } from "$lib/locale";

  /** P1 固定角色(首批裁定 researcher + rule-copilot + general;后续接 listAgents 动态化) */
  const FIXED_ROLES = ["researcher", "rule-copilot", "general"] as const;
  type Role = (typeof FIXED_ROLES)[number];

  let selectedRole: Role = $state("general");

  const cfg = $derived($agentConfig);
  const enabled = $derived(cfg.enabled);
  /** 形式完备(enabled + baseUrl 非空):决定徽标态与输入行走"未连接"还是"未配置" */
  const configured = $derived(isAgentConfigured(cfg));
</script>

{#if !enabled}
  <!-- 未启用引导:直连 URL 的兜底面(侧栏入口在禁用时本就不渲染) -->
  <section class="agent-disabled">
    <p class="d-title">{t("agent.disabled.title")}</p>
    <p class="d-hint">{t("agent.disabled.hint")}</p>
    <a class="d-cta" href={`${base}/?openSettings=agent`}>{t("agent.disabled.cta")}</a>
  </section>
{:else}
  <div class="agent-shell">
    <!-- ===== 左栏:会话 / 角色 / 工作区(灰显) ===== -->
    <aside class="lcol" aria-label={t("agent.sessions")}>
      <div class="sec">
        <b>{t("agent.sessions")}</b>
        <button class="mini" type="button" disabled title={t("agent.noSessions")}>
          {t("agent.newSession")}
        </button>
      </div>
      <div class="hint-line">{t("agent.noSessions")}</div>

      <div class="sec"><b>{t("agent.roles")}</b></div>
      {#each FIXED_ROLES as role (role)}
        <button
          class="role-item"
          class:on={selectedRole === role}
          type="button"
          onclick={() => (selectedRole = role)}
        >
          <span class="role-name">{role}</span>
        </button>
      {/each}

      <div class="lcol-spacer"></div>

      <div class="sec">
        <b>{t("agent.workspace")}</b>
        <span class="ptag">P2</span>
      </div>
      <div class="hint-line dim">{t("agent.workspacePending")}</div>
    </aside>

    <!-- ===== 中栏:执行过程视图 ===== -->
    <section class="mcol" aria-label={t("agent.execution")}>
      <header class="mh">
        <b>{t("agent.execution")}</b>
        <span class="chp">{t("agent.noSessionChip")}</span>
        <span class="chp mono">{selectedRole}</span>
        <a class="mh-link" href={`${base}/audit`}>{t("agent.auditLink")}</a>
      </header>
      <div class="ph">
        <p class="ph-title">{t("agent.timelineEmpty")}</p>
        <p class="ph-hint">{t("agent.timelineHint")}</p>
      </div>
    </section>

    <!-- ===== 右栏:Agent 会话流 ===== -->
    <aside class="rcol" aria-label={t("agent.chat")}>
      <header class="rh">
        <b>{t("agent.chat")}</b>
        <span class="conn" class:warn={configured} class:bad={!configured}>
          <span class="dot"></span>
          {configured ? t("agent.conn.disconnected") : t("agent.conn.unconfigured")}
        </span>
      </header>
      <div class="ph">
        <p class="ph-hint">{t("agent.chatEmpty")}</p>
      </div>
      <footer class="rinput">
        <textarea
          rows="2"
          placeholder={t("agent.inputPlaceholder")}
          disabled
        ></textarea>
        <div class="btnrow">
          <button class="btn-send" type="button" disabled>{t("agent.send")}</button>
          <button class="btn-stop" type="button" disabled>{t("agent.stop")}</button>
        </div>
      </footer>
    </aside>
  </div>
{/if}

<style>
  /* ===== 未启用引导 ===== */
  .agent-disabled {
    height: 100%;
    min-height: 320px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-xs);
    text-align: center;
  }
  .d-title {
    font-size: var(--fs-lg);
    font-weight: var(--fw-sb);
    color: var(--text-primary);
    margin: 0;
  }
  .d-hint {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    margin: 0;
  }
  .d-cta {
    margin-top: var(--sp-sm);
    font-size: var(--fs-sm);
    color: var(--brand-ocean);
    text-decoration: none;
  }
  .d-cta:hover {
    text-decoration: underline;
  }

  /* ===== 三栏骨架(左 170 / 中自适应 / 右 312) ===== */
  .agent-shell {
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 520px;
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: var(--r-xl);
    overflow: hidden;
  }

  /* --- 左栏 --- */
  .lcol {
    flex: 0 0 170px;
    width: 170px;
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
    padding: 10px var(--sp-xs);
    background: var(--bg-header);
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }
  .sec {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-xxs) var(--sp-xs);
  }
  .sec b {
    font-size: 11px;
    font-weight: var(--fw-sb);
    color: var(--text-muted);
    letter-spacing: 0.06em;
  }
  .ptag {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: var(--r-full);
    padding: 2px var(--sp-xs);
  }
  .mini {
    font-size: 11px;
    font-weight: var(--fw-med);
    color: var(--brand-ocean);
    background: none;
    border: none;
    padding: var(--sp-xxs) var(--sp-xs);
    cursor: pointer;
  }
  .mini:hover:not(:disabled) {
    text-decoration: underline;
  }
  .mini:disabled {
    color: var(--text-muted);
    cursor: not-allowed;
  }
  .hint-line {
    font-size: 11px;
    color: var(--text-secondary);
    padding: var(--sp-xxs) var(--sp-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hint-line.dim {
    color: var(--text-muted);
  }
  .role-item {
    display: flex;
    align-items: center;
    gap: var(--sp-xs);
    width: 100%;
    padding: var(--sp-xs) var(--sp-sm);
    border: none;
    border-radius: var(--r-md);
    background: transparent;
    cursor: pointer;
    text-align: left;
  }
  .role-item:hover {
    background: var(--bg-hover);
  }
  .role-item.on {
    background: var(--brand-bg);
  }
  .role-name {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .lcol-spacer {
    flex: 1;
  }

  /* --- 中栏 --- */
  .mcol {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .mh {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }
  .mh b {
    font-size: var(--fs-sm);
    font-weight: var(--fw-sb);
    color: var(--text-primary);
  }
  .chp {
    font-size: 10px;
    color: var(--text-secondary);
    background: var(--bg-hover);
    border-radius: var(--r-full);
    padding: 3px var(--sp-sm);
    white-space: nowrap;
  }
  .chp.mono {
    font-family: var(--font-mono);
  }
  .mh-link {
    margin-left: auto;
    font-size: 11px;
    color: var(--brand-ocean);
    text-decoration: none;
    white-space: nowrap;
  }
  .mh-link:hover {
    text-decoration: underline;
  }

  /* --- 空态占位(中/右共用) --- */
  .ph {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-xxs);
    padding: var(--sp-lg);
    text-align: center;
  }
  .ph-title {
    font-size: var(--fs-sm);
    font-weight: var(--fw-med);
    color: var(--text-secondary);
    margin: 0;
  }
  .ph-hint {
    font-size: var(--fs-xs);
    color: var(--text-muted);
    margin: 0;
  }

  /* --- 右栏 --- */
  .rcol {
    flex: 0 0 312px;
    width: 312px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-card);
    border-left: 1px solid var(--border);
  }
  .rh {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }
  .rh b {
    font-size: var(--fs-sm);
    font-weight: var(--fw-sb);
    color: var(--text-primary);
  }
  .conn {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: var(--sp-xs);
    font-size: 11px;
    font-weight: var(--fw-med);
    padding: var(--sp-xs) 10px;
    border-radius: var(--r-full);
    white-space: nowrap;
  }
  .conn .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex: 0 0 6px;
  }
  .conn.warn {
    color: var(--warning);
    background: var(--warning-bg);
  }
  .conn.warn .dot {
    background: var(--warning);
  }
  .conn.bad {
    color: var(--danger);
    background: var(--danger-bg);
  }
  .conn.bad .dot {
    background: var(--danger);
  }

  .rinput {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    padding: 10px 12px;
    border-top: 1px solid var(--border);
  }
  .rinput textarea {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: var(--fs-xs);
    line-height: var(--lh-normal);
    padding: var(--sp-sm);
    resize: none;
  }
  .rinput textarea::placeholder {
    color: var(--text-muted);
  }
  .rinput textarea:disabled {
    opacity: 0.55;
  }
  .btnrow {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-sm);
  }
  .btn-send {
    background: var(--brand);
    color: #ffffff;
    border: none;
    border-radius: var(--r-md);
    padding: var(--sp-xs) 14px;
    font-size: var(--fs-xs);
    font-weight: var(--fw-med);
    cursor: pointer;
  }
  .btn-send:hover:not(:disabled) {
    background: var(--brand-hover);
  }
  .btn-stop {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    padding: var(--sp-xs) 14px;
    font-size: var(--fs-xs);
    font-weight: var(--fw-med);
    cursor: pointer;
  }
  .btn-send:disabled,
  .btn-stop:disabled {
    color: var(--text-muted);
    background: var(--bg-hover);
    border-color: var(--border);
    cursor: not-allowed;
  }
</style>
