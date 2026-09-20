<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  AgentWorkspace — Agent 会话台三栏工作区
  布局基准: 高保真交互原型定稿(§3.2 布局规范)——统一顶栏由 console 壳承担,
  此处为页内三栏;组件状态枚举与视觉 token 以设计规格为准
  - 左 170px:  上区会话列表(localStorage 持久化元数据;点击切换/续接)
               角色列表(P1 固定 researcher/rule-copilot/general,供新建会话选择)
               下区工作区文件树(灰显占位,P2 由 file_list 提供)
  - 中自适应:  执行过程视图(头部 标题+会话徽标+角色徽标+审计页入口;主体时间线后续任务接)
  - 右 312px:  Agent 会话流(连接徽标/对话流:系统行·用户气泡·流式气泡·工具 chips·
               汇总行·错误卡/空态三型:未配置·不可达·无会话/输入行)
  会话建立: 新建会话产生本地草稿;首个发送任务时经服务端建立(SessionCreated
  回填会话 ID);历史会话发送时按会话 ID 续接(上下文由服务端保留,UI 呈现
  续接提示行,不伪造历史消息)
  门控: agentConfig.enabled 关闭时渲染启用引导(经 ?openSettings=agent 打开设置面板)
  视觉: 全量复用 app.css v3 token,无自造色
-->
<script lang="ts">
  import { base } from "$app/paths";
  import { agentConfig, isAgentConfigured } from "$lib/config/agent-config";
  import {
    agentSessions,
    attachSessionId,
    createSession,
    setSessionStatus,
    setSessionTitle,
    touchSession,
    type AgentSession
  } from "$lib/agent/agent-sessions";
  import { AgentClient, type AgentClientOptions } from "$lib/agent/agent-client";
  import type { AgentLinkStatus, AgentStatusDetail } from "$lib/agent/agent-client";
  import type { AgentServerEvent } from "$lib/agent/types";
  import { t } from "$lib/locale";

  /** P1 固定角色(首批裁定 researcher + rule-copilot + general;后续接 listAgents 动态化) */
  const FIXED_ROLES = ["researcher", "rule-copilot", "general"] as const;
  type Role = (typeof FIXED_ROLES)[number];

  /** 审批倒计时窗(evo-agent serve 60s 超时自动拒绝,UI 同步呈现;协议既定) */
  const APPROVAL_TIMEOUT_SEC = 60;
  /** 倒计时环形 SVG 周长(r=12) */
  const APPROVAL_RING_C = 2 * Math.PI * 12;

  /** 测试注入缝:缺省真实客户端,组件测试注入桩(连接层行为在客户端单测覆盖) */
  type ClientLike = Pick<AgentClient, "connect" | "send" | "approve" | "close">;
  interface Props {
    createClient?: (options: AgentClientOptions) => ClientLike;
  }
  let { createClient = (options: AgentClientOptions) => new AgentClient(options) }: Props = $props();

  /** 对话流条目(内存态,按会话留存;刷新后以续接提示行重新开始) */
  type ChatItem =
    | { kind: "sys"; text: string }
    | { kind: "summary"; text: string }
    | { kind: "user"; text: string }
    | { kind: "agent"; text: string; streaming: boolean }
    | { kind: "chips"; chips: { name: string; state: "run" | "done" }[] }
    | {
        kind: "approval";
        tool: string;
        command: string;
        risk: string;
        alternative: string;
        /** 倒计时截止(Unix 秒);服务端 60s 超时自动拒绝,UI 显式倒计时 */
        deadline: number;
        state: "pending" | "approved" | "rejected" | "timeout";
      }
    | { kind: "error"; text: string };

  /** 时间线条目(中栏;状态语义对齐设计规格:运行中/待审批/成功/已拒绝·超时跳过) */
  type TlState = "run" | "wait" | "ok" | "skip";
  type TlItem = {
    id: number;
    name: string;
    args: unknown;
    state: TlState;
    /** skip 态细分:rejected=已拒绝 / timeout=超时跳过 */
    skipReason: "rejected" | "timeout" | "";
    /** 审批请求附带的命令与风险(ApprovalRequired) */
    command: string;
    risk: string;
    alternative: string;
    result: unknown;
  };

  // $state 深响应式对象树:数组 push 与元素属性变化(text/streaming/chip state)均自动触发更新
  // key 为 localId(crypto uuid,无注入面);不用 Map——其值内层 mutation 不经 Map 通道通知
  const transcripts = $state<Record<string, ChatItem[]>>({});
  /** 中栏执行时间线(按会话留存;与右栏对话流并行推进) */
  const timelines = $state<Record<string, TlItem[]>>({});
  /** 每轮完成汇总(中栏汇总条;新一轮发送时清空) */
  const turnSummaries = $state<Record<string, { steps: number; sec: number } | null>>({});
  let tlSeq = 0;

  let selectedRole: Role = $state("general");
  let selectedLocalId = $state<string | null>(null);
  let link: AgentLinkStatus = $state("idle");
  /** 首连失败(对话流为空)时的不可达空态标记 */
  let linkError = $state<string | null>(null);
  let turnRunning = $state(false);
  let input = $state("");

  const cfg = $derived($agentConfig);
  const enabled = $derived(cfg.enabled);
  /** 形式完备(enabled + baseUrl 非空):决定徽标态与空态走向 */
  const configured = $derived(isAgentConfigured(cfg));
  const sessions = $derived($agentSessions);
  const selected = $derived(sessions.find((s) => s.localId === selectedLocalId) ?? null);
  const items = $derived.by<ChatItem[]>(() => {
    if (!selected) return [];
    const tr = transcripts[selected.localId];
    // 浅拷贝保证数组身份变化,each 块据此增删条目;元素属性变化由细粒度依赖直达 DOM
    return tr ? [...tr] : [];
  });

  /** 中栏时间线条目(浅拷贝同 transcripts 派生纪律) */
  const tlItems = $derived.by<TlItem[]>(() => {
    if (!selected) return [];
    const tl = timelines[selected.localId];
    return tl ? [...tl] : [];
  });
  /** 中栏本轮汇总条 */
  const turnSummary = $derived.by<{ steps: number; sec: number } | null>(() => {
    if (!selected) return null;
    return turnSummaries[selected.localId] ?? null;
  });
  /** 时间线手风琴:单条展开(点按切换) */
  let openTlId = $state<number | null>(null);
  /** 审批送达防抖(点击后到 REST 返回前禁用双按钮) */
  let deciding = $state(false);
  /** 倒计时基准(Unix 秒;每秒推进驱动审批卡环形倒计时) */
  let nowSec = $state(Math.floor(Date.now() / 1000));

  $effect(() => {
    const timer = setInterval(() => {
      nowSec = Math.floor(Date.now() / 1000);
      resolveApprovalTimeouts();
    }, 1000);
    return () => clearInterval(timer);
  });

  /** 连接徽标:文本与色调(断线显式非静默) */
  const connText = $derived.by(() => {
    const st: AgentLinkStatus = link;
    return !configured
      ? t("agent.conn.unconfigured")
      : st === "connected"
        ? t("agent.conn.connected")
        : st === "reconnecting"
          ? t("agent.conn.reconnecting")
          : t("agent.conn.disconnected");
  });
  const connTone = $derived.by(() => {
    const st: AgentLinkStatus = link;
    return !configured ? "bad" : st === "connected" ? "ok" : "warn";
  });

  /** 对话流空态三型(优先级:未配置 → 不可达 → 无会话;选中会话无消息时走通用提示) */
  type EmptyKind = "unconfigured" | "unreachable" | "noSession" | null;
  const chatEmpty: EmptyKind = $derived(
    !configured ? "unconfigured" : linkError ? "unreachable" : sessions.length === 0 ? "noSession" : null
  );

  const canSend = $derived.by(() => {
    const st: AgentLinkStatus = link;
    return (
      configured &&
      selected !== null &&
      input.trim().length > 0 &&
      !turnRunning &&
      st !== "connecting" &&
      st !== "reconnecting"
    );
  });

  // ---- 非响应式连接句柄(事件回调经组件级 handler 汇入) ----
  let client: ClientLike | null = null;
  let activeLocalId: string | null = null;
  let resumePending = false;
  let wasDisconnectedPending = false;
  let logEl = $state<HTMLElement | null>(null);

  $effect(() => {
    void items.length;
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  });

  function pushItem(localId: string, item: ChatItem): void {
    // 注意:必须经 proxy 引用操作——`(transcripts[k] ??= []).push()` 会被编译改写致数据落入
    // 孤儿数组(实测 len=0);先判空赋值,再取 proxy 数组 push,变更才能被响应式追踪
    if (!transcripts[localId]) transcripts[localId] = [];
    transcripts[localId].push(item);
  }

  function closeStreamingItem(tr: ChatItem[]): void {
    // 从尾向头找最近的 agent 气泡收起流式光标:收尾前可能已插入工具 chips,
    // 只看末位会漏收(实测 chips 在后时光标滞留);不可变替换以走引用变化通道
    for (let i = tr.length - 1; i >= 0; i--) {
      const it = tr[i];
      if (it.kind === "agent") {
        if (it.streaming) tr[i] = { ...it, streaming: false };
        return;
      }
    }
  }

  function shortSessionId(localId: string): string {
    return sessions.find((s) => s.localId === localId)?.sessionId ?? "";
  }

  // ---- 中栏时间线辅助(先判空赋值再 push,同 transcripts proxy 纪律) ----
  function pushTl(localId: string, item: Omit<TlItem, "id">): TlItem {
    if (!timelines[localId]) timelines[localId] = [];
    const full: TlItem = { ...item, id: ++tlSeq };
    timelines[localId].push(full);
    return full;
  }

  /** 从尾向头找最近的同名时间线条目(可选状态过滤) */
  function findTl(localId: string, name: string, states?: TlState[]): TlItem | null {
    const tl = timelines[localId];
    if (!tl) return null;
    for (let i = tl.length - 1; i >= 0; i--) {
      const it = tl[i];
      if (it.name === name && (!states || states.includes(it.state))) return it;
    }
    return null;
  }

  /** 审批卡条目定位:同工具 pending 卡优先,退而取任意 pending 卡(单卡场景兜底) */
  function findPendingApproval(localId: string, tool: string): ChatItem | null {
    const tr = transcripts[localId];
    if (!tr) return null;
    let any: ChatItem | null = null;
    for (let i = tr.length - 1; i >= 0; i--) {
      const it = tr[i];
      if (it.kind === "approval" && it.state === "pending") {
        if (it.tool === tool) return it;
        any = it;
      }
    }
    return any;
  }

  /** 工具参数摘要(中栏 .ta 单行;对象展开 key=value,标量直接序列化) */
  function summarizeArgs(args: unknown): string {
    if (args === null || args === undefined) return "";
    if (typeof args === "object" && !Array.isArray(args)) {
      const entries = Object.entries(args as Record<string, unknown>);
      if (entries.length === 0) return "";
      return entries
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" ");
    }
    return JSON.stringify(args);
  }

  /** 详情行用紧凑 JSON(文本插值自动转义,无注入面) */
  function jsonCompact(v: unknown): string {
    try {
      return JSON.stringify(v) ?? "";
    } catch {
      return String(v);
    }
  }

  // ---- 审批链路 ----
  /** 批准/拒绝:REST 送达;结果以服务端 ApprovalResult 回推为准(协议保证),失败保持 pending 继续倒计时 */
  async function decideApproval(item: Extract<ChatItem, { kind: "approval" }>, approved: boolean): Promise<void> {
    const lid = activeLocalId;
    if (!client || !lid || deciding || item.state !== "pending") return;
    deciding = true;
    try {
      await client.approve(approved);
    } catch (e) {
      pushItem(lid, {
        kind: "error",
        text: t("agent.err.approveFailed", { reason: (e as Error).message })
      });
    } finally {
      deciding = false;
    }
  }

  /** 60s 倒计时归零:超时自动拒绝(服务端同步兜底;ApprovalResult 迟到时因非 pending 被忽略,不重复) */
  function resolveApprovalTimeouts(): void {
    for (const lid of Object.keys(transcripts)) {
      const tr = transcripts[lid];
      for (let i = tr.length - 1; i >= 0; i--) {
        const it = tr[i];
        if (it.kind === "approval" && it.state === "pending" && it.deadline <= nowSec) {
          tr[i] = { ...it, state: "timeout" };
          const tl = findTl(lid, it.tool, ["wait"]);
          if (tl) tl.state = "skip", tl.skipReason = "timeout";
        }
      }
    }
  }

  // ---- 服务端事件 → 对话流 ----
  function handleEvent(e: AgentServerEvent): void {
    const lid = activeLocalId;
    if (!lid) return;
    if (e.type === "SessionCreated") {
      attachSessionId(lid, e.session_id);
      return;
    }
    const tr = transcripts[lid];
    if (!tr) return;
    switch (e.type) {
      case "LlmDelta": {
        const last = tr[tr.length - 1];
        if (last && last.kind === "agent" && last.streaming) last.text += e.text;
        else tr.push({ kind: "agent", text: e.text, streaming: true });
        break;
      }
      case "ToolCall":
        tr.push({ kind: "chips", chips: [{ name: e.name, state: "run" }] });
        pushTl(lid, {
          name: e.name,
          args: e.args,
          state: "run",
          skipReason: "",
          command: "",
          risk: "",
          alternative: "",
          result: null
        });
        break;
      case "ToolResult": {
        for (let i = tr.length - 1; i >= 0; i--) {
          const it = tr[i];
          if (it.kind === "chips") {
            const chip = it.chips.find((c) => c.name === e.name && c.state === "run");
            if (chip) {
              chip.state = "done";
              break;
            }
          }
        }
        // 中栏:同名运行中/待审批条目收敛为成功;防御性兜底——无匹配条目时补一条(协议应成对)
        const tlItem = findTl(lid, e.name, ["run", "wait"]);
        if (tlItem) {
          tlItem.state = "ok";
          tlItem.result = e.result;
        } else {
          pushTl(lid, {
            name: e.name,
            args: null,
            state: "ok",
            skipReason: "",
            command: "",
            risk: "",
            alternative: "",
            result: e.result
          });
        }
        break;
      }
      case "Done": {
        closeStreamingItem(tr);
        const sec = Math.max(1, Math.round(e.duration_ms / 1000));
        tr.push({ kind: "summary", text: t("agent.sys.turnDone", { steps: e.steps, sec }) });
        turnSummaries[lid] = { steps: e.steps, sec };
        turnRunning = false;
        touchSession(lid);
        break;
      }
      case "Error": {
        closeStreamingItem(tr);
        tr.push({ kind: "error", text: t("agent.err.turn", { message: e.error }) });
        turnRunning = false;
        break;
      }
      case "Info":
        tr.push({ kind: "sys", text: e.message });
        break;
      case "ApprovalRequired": {
        // 中栏:运行中条目转待审批(candidate 工具先 ToolCall 后 ApprovalRequired);无前置条目则补一条
        const tlItem = findTl(lid, e.tool_name, ["run"]);
        if (tlItem) {
          tlItem.state = "wait";
          tlItem.command = e.command ?? "";
          tlItem.risk = e.risk ?? "";
          tlItem.alternative = e.alternative ?? "";
        } else {
          pushTl(lid, {
            name: e.tool_name,
            args: null,
            state: "wait",
            skipReason: "",
            command: e.command ?? "",
            risk: e.risk ?? "",
            alternative: e.alternative ?? "",
            result: null
          });
        }
        // 右栏:审批卡(替代 T4 的 sys 占位行;60s 显式倒计时)
        tr.push({
          kind: "approval",
          tool: e.tool_name,
          command: e.command ?? "",
          risk: e.risk ?? "",
          alternative: e.alternative ?? "",
          deadline: Math.floor(Date.now() / 1000) + APPROVAL_TIMEOUT_SEC,
          state: "pending"
        });
        break;
      }
      case "ApprovalResult": {
        // 卡片收敛:pending → approved/rejected(超时已收敛为 timeout 的卡不再改写,忽略迟到回执)
        const card = findPendingApproval(lid, e.tool_name);
        if (card && card.kind === "approval") {
          const idx = tr.indexOf(card);
          if (idx >= 0) tr[idx] = { ...card, state: e.approved ? "approved" : "rejected" };
        }
        // 中栏:待审批条目 → 运行中(批准继续执行)/ 已拒绝·跳过
        const tlItem = findTl(lid, e.tool_name, ["wait"]);
        if (tlItem) {
          if (e.approved) {
            tlItem.state = "run";
          } else {
            tlItem.state = "skip";
            tlItem.skipReason = "rejected";
          }
        }
        break;
      }
    }
  }

  // ---- 链路状态 → 徽标 / 空态 / 会话条目状态 ----
  function handleStatus(status: AgentLinkStatus, detail?: AgentStatusDetail): void {
    link = status;
    const lid = activeLocalId;
    if (status === "connected") {
      linkError = null;
      if (lid) {
        if (wasDisconnectedPending) setSessionStatus(lid, "idle");
        if (resumePending) {
          pushItem(lid, {
            kind: "sys",
            text: t("agent.session.resumeHint", { id: shortSessionId(lid) })
          });
          resumePending = false;
        }
      }
      return;
    }
    if (status === "disconnected" && detail?.error && lid) {
      setSessionStatus(lid, "disconnected");
      if (detail.error === "reconnect-exhausted") {
        pushItem(lid, { kind: "error", text: t("agent.err.linkLost") });
      } else {
        // 首连失败:呈现不可达空态(重试入口);已有消息随空态暂隐,重试恢复后可见
        linkError = detail.error;
      }
    }
  }

  /** 建连/续接:同会话已连接直通;建连中不重复发起;断线则重建连接 */
  async function ensureConnected(s: AgentSession): Promise<boolean> {
    if (client && activeLocalId !== s.localId) {
      client.close();
      client = null;
    } else if (client && activeLocalId === s.localId) {
      if (link === "connected") return true;
      if (link === "connecting" || link === "reconnecting") return false;
      client.close();
      client = null;
    }
    activeLocalId = s.localId;
    resumePending = s.sessionId !== "";
    wasDisconnectedPending = s.status === "disconnected";
    linkError = null;
    client = createClient({
      baseUrl: cfg.baseUrl,
      agentType: s.role,
      authToken: cfg.authToken,
      sessionId: resumePending ? s.sessionId : undefined,
      onEvent: handleEvent,
      onStatus: handleStatus
    });
    link = "connecting";
    try {
      await client.connect();
      return true;
    } catch {
      // 终态与空态已在 handleStatus 收敛
      return false;
    }
  }

  async function send(): Promise<void> {
    const s = selected;
    const text = input.trim();
    if (!s || !text || !configured || turnRunning) return;
    if (!s.sessionId) setSessionTitle(s.localId, text.slice(0, 30));
    pushItem(s.localId, { kind: "user", text });
    input = "";
    turnRunning = true;
    turnSummaries[s.localId] = null;
    const ok = await ensureConnected(s);
    if (!ok) {
      turnRunning = false;
      // 撤回未发出的用户气泡:消息没有离开客户端,保留会误导;重新输入即可
      const tr = transcripts[s.localId];
      if (tr && tr[tr.length - 1]?.kind === "user") tr.pop();
      return;
    }
    try {
      client?.send(text);
    } catch (e) {
      pushItem(s.localId, {
        kind: "error",
        text: t("agent.err.sendFailed", { reason: (e as Error).message })
      });
      turnRunning = false;
    }
  }

  function newSession(): void {
    const s = createSession(selectedRole, t("agent.session.untitled"));
    if (client) {
      client.close();
      client = null;
    }
    activeLocalId = null;
    resumePending = false;
    turnRunning = false;
    link = "idle";
    linkError = null;
    openTlId = null;
    selectedLocalId = s.localId;
  }

  function selectSession(s: AgentSession): void {
    if (s.localId === selectedLocalId) return;
    if (client) {
      client.close();
      client = null;
    }
    activeLocalId = null;
    resumePending = false;
    turnRunning = false;
    link = "idle";
    linkError = null;
    openTlId = null;
    selectedLocalId = s.localId;
    if ((FIXED_ROLES as readonly string[]).includes(s.role)) selectedRole = s.role as Role;
  }

  function retryConnect(): void {
    const s = selected;
    if (!s || !configured) return;
    void ensureConnected(s);
  }

  function onInputKeydown(ev: KeyboardEvent): void {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      void send();
    }
  }
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
        <button class="mini" type="button" disabled={!configured} onclick={newSession}>
          {t("agent.newSession")}
        </button>
      </div>
      {#if sessions.length === 0}
        <div class="hint-line">{t("agent.noSessions")}</div>
      {:else}
        {#each sessions as s (s.localId)}
          <button
            class="sit"
            class:on={s.localId === selectedLocalId}
            class:live={s.localId === selectedLocalId && turnRunning}
            class:dead={s.status === "disconnected"}
            type="button"
            onclick={() => selectSession(s)}
            title={s.title}
          >
            <span class="d"></span>
            <span class="tt">
              <span class="n">{s.title}</span>
              <span class="m">{s.sessionId ? `${s.role} · v${s.version}` : s.role}</span>
            </span>
          </button>
        {/each}
      {/if}

      <div class="sec roles-sec"><b>{t("agent.roles")}</b></div>
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
        <span class="chp mono">{selected?.sessionId || t("agent.noSessionChip")}</span>
        <span class="chp mono">{selected ? selected.role : selectedRole}</span>
        <a class="mh-link" href={`${base}/audit`}>{t("agent.auditLink")}</a>
      </header>
      {#if turnSummary}
        <div class="donebar">{t("agent.sys.turnDone", { steps: turnSummary.steps, sec: turnSummary.sec })}</div>
      {/if}
      {#if tlItems.length === 0}
        <div class="ph">
          <p class="ph-title">{t("agent.timelineEmpty")}</p>
          <p class="ph-hint">{t("agent.timelineHint")}</p>
        </div>
      {:else}
        <div class="tl">
          {#each tlItems as item (item.id)}
            <div class="te" class:open={openTlId === item.id}>
              <button
                class="teh"
                type="button"
                onclick={() => (openTlId = openTlId === item.id ? null : item.id)}
              >
                <span class="tico">{item.name.slice(0, 1).toUpperCase()}</span>
                <span class="tn">{item.name}</span>
                <span class="ta">{summarizeArgs(item.args) || item.command}</span>
                <span
                  class="bd"
                  class:run={item.state === "run"}
                  class:wait={item.state === "wait"}
                  class:ok={item.state === "ok"}
                  class:skip={item.state === "skip"}
                >
                  {#if item.state === "run"}<span class="sp"></span>{t("agent.tl.run")}
                  {:else if item.state === "wait"}{t("agent.tl.wait")}
                  {:else if item.state === "ok"}{t("agent.tl.ok")}
                  {:else if item.skipReason === "timeout"}{t("agent.tl.timeout")}
                  {:else}{t("agent.tl.rejected")}{/if}
                </span>
              </button>
              {#if openTlId === item.id}
                <div class="ted">
                  {#if item.command}
                    <div class="r"><i>{t("agent.tl.command")}</i> {item.command}</div>
                  {:else if item.args !== null && item.args !== undefined}
                    <div class="r"><i>{t("agent.tl.args")}</i> {jsonCompact(item.args)}</div>
                  {/if}
                  {#if item.state === "ok" && item.result !== null && item.result !== undefined}
                    <div class="r"><i>{t("agent.tl.result")}</i> {jsonCompact(item.result)}</div>
                  {/if}
                  {#if item.risk}
                    <div class="r"><i>{t("agent.tl.risk")}</i> {t("agent.tl.riskLine", { risk: item.risk })}</div>
                  {/if}
                  {#if item.alternative}
                    <div class="r"><i>{t("agent.tl.alternative")}</i> {item.alternative}</div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <!-- ===== 右栏:Agent 会话流 ===== -->
    <aside class="rcol" aria-label={t("agent.chat")}>
      <header class="rh">
        <b>{t("agent.chat")}</b>
        <span class="conn" class:ok={connTone === "ok"} class:warn={connTone === "warn"} class:bad={connTone === "bad"}>
          <span class="dot"></span>
          {connText}
        </span>
      </header>

      {#if chatEmpty === "unconfigured"}
        <div class="emp">
          <span class="emp-ic">⚙</span>
          <b>{t("agent.empty.unconfigured.title")}</b>
          <p>{t("agent.empty.unconfigured.hint")}</p>
          <a class="emp-cta" href={`${base}/?openSettings=agent`}>{t("agent.empty.unconfigured.cta")}</a>
        </div>
      {:else if chatEmpty === "unreachable"}
        <div class="emp">
          <span class="emp-ic">⚠</span>
          <b>{t("agent.empty.unreachable.title")}</b>
          <p>{t("agent.empty.unreachable.hint")}</p>
          <button class="emp-cta" type="button" onclick={retryConnect}>
            {t("agent.empty.unreachable.cta")}
          </button>
        </div>
      {:else if chatEmpty === "noSession"}
        <div class="emp">
          <span class="emp-ic">＋</span>
          <b>{t("agent.empty.noSession.title")}</b>
          <p>{t("agent.empty.noSession.hint")}</p>
          <button class="emp-cta" type="button" onclick={newSession}>
            {t("agent.empty.noSession.cta")}
          </button>
        </div>
      {:else if items.length === 0}
        <div class="ph">
          <p class="ph-hint">{t("agent.chatEmpty")}</p>
        </div>
      {:else}
        <div class="chatlog" bind:this={logEl}>
          {#each items as item, i (i)}
            {#if item.kind === "sys"}
              <p class="sys">{item.text}</p>
            {:else if item.kind === "summary"}
              <p class="rsum">{item.text}</p>
            {:else if item.kind === "user"}
              <div class="msg u">{item.text}</div>
            {:else if item.kind === "agent"}
              <div class="msg a">{item.text}{#if item.streaming}<span class="crt"></span>{/if}</div>
            {:else if item.kind === "chips"}
              <div class="chips">
                {#each item.chips as c (c.name)}
                  <span class="chip" class:hl={c.state === "run"}>
                    {c.name}{c.state === "run" ? " …" : " ✓"}
                  </span>
                {/each}
              </div>
            {:else if item.kind === "approval"}
              {@const remaining = Math.max(0, item.deadline - nowSec)}
              {#if item.state === "pending"}
                <div class="apv">
                  <div class="apv-h">⚠ {t("agent.card.pendingTitle", { tool: item.tool })}</div>
                  {#if item.command}
                    <div class="apv-cmd">{item.command}</div>
                  {/if}
                  {#if item.risk}
                    <div class="apv-mt">{t("agent.tl.riskLine", { risk: item.risk })}</div>
                  {/if}
                  {#if item.alternative}
                    <div class="apv-mt">{t("agent.card.alternative", { alternative: item.alternative })}</div>
                  {/if}
                  <div class="apv-cd">
                    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
                      <circle cx="15" cy="15" r="12" fill="none" stroke="var(--border)" stroke-width="3" />
                      <circle
                        cx="15"
                        cy="15"
                        r="12"
                        fill="none"
                        stroke={remaining <= 10 ? "var(--danger)" : "var(--warning)"}
                        stroke-width="3"
                        stroke-linecap="round"
                        stroke-dasharray={APPROVAL_RING_C}
                        stroke-dashoffset={APPROVAL_RING_C * (1 - remaining / APPROVAL_TIMEOUT_SEC)}
                        transform="rotate(-90 15 15)"
                      />
                    </svg>
                    <span class="apv-num" class:low={remaining <= 10}>{remaining}s</span>
                    <button
                      class="apv-btn pri"
                      type="button"
                      disabled={deciding}
                      onclick={() => void decideApproval(item, true)}
                    >
                      {t("agent.card.approve")}
                    </button>
                    <button
                      class="apv-btn dg"
                      type="button"
                      disabled={deciding}
                      onclick={() => void decideApproval(item, false)}
                    >
                      {t("agent.card.reject")}
                    </button>
                  </div>
                </div>
              {:else if item.state === "approved"}
                <div class="apv-state ok">✔ {t("agent.card.approved", { cmd: item.command || item.tool })}</div>
              {:else if item.state === "rejected"}
                <div class="apv-state no">✕ {t("agent.card.rejected")}</div>
              {:else}
                <div class="apv-state to">⏱ {t("agent.card.timeout")}</div>
              {/if}
            {:else}
              <div class="errc"><b>✕</b> {item.text}</div>
            {/if}
          {/each}
        </div>
      {/if}

      <footer class="rinput">
        <textarea
          rows="2"
          placeholder={t("agent.inputPlaceholder")}
          disabled={!selected}
          bind:value={input}
          onkeydown={onInputKeydown}
        ></textarea>
        <div class="btnrow">
          <button class="btn-send" type="button" disabled={!canSend} onclick={() => void send()}>
            {t("agent.send")}
          </button>
          <button class="btn-stop" type="button" disabled title={t("agent.stop")}>
            {t("agent.stop")}
          </button>
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
  .roles-sec {
    margin-top: var(--sp-sm);
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

  /* 会话条目:活跃(选中+轮次进行中,绿点脉动)/ 空闲(灰点)/ 断线(红点) */
  .sit {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px;
    border: none;
    border-radius: var(--r-md);
    background: transparent;
    cursor: pointer;
    text-align: left;
  }
  .sit:hover {
    background: var(--bg-hover);
  }
  .sit.on {
    background: var(--brand-bg);
  }
  .sit .d {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: 0 0 7px;
    background: var(--text-muted);
  }
  .sit.live .d {
    background: var(--success);
  }
  .sit.dead .d {
    background: var(--danger);
  }
  .sit .tt {
    min-width: 0;
  }
  .sit .n {
    display: block;
    font-size: 12px;
    font-weight: var(--fw-med);
    line-height: 16px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sit .m {
    display: block;
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 14px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
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

  /* --- 中栏汇总条(本轮完成) --- */
  .donebar {
    margin: 10px 14px 0;
    padding: 8px 12px;
    font-size: var(--fs-xs);
    font-weight: var(--fw-med);
    line-height: 18px;
    color: var(--success);
    background: var(--success-bg);
    border: 1px solid var(--success);
    border-radius: var(--r-md);
  }

  /* --- 中栏时间线(状态语义:run 蓝 / wait 黄 / ok 绿 / skip 灰) --- */
  .tl {
    flex: 1;
    min-height: 0;
    padding: 10px 14px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: stretch;
  }
  .te {
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-card);
  }
  .teh {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border: none;
    background: transparent;
    cursor: pointer;
    text-align: left;
    font-family: var(--font-sans);
  }
  .teh:hover {
    background: var(--bg-hover);
    border-radius: var(--r-md);
  }
  .tico {
    width: 18px;
    height: 18px;
    border-radius: var(--r-sm);
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: var(--fw-med);
    line-height: 18px;
    text-align: center;
    flex: 0 0 18px;
  }
  .tn {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: var(--fw-med);
    line-height: 16px;
    color: var(--text-primary);
    flex: 0 0 auto;
  }
  .ta {
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 16px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .bd {
    margin-left: auto;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    font-weight: var(--fw-med);
    line-height: 1;
    padding: 3px 8px;
    border-radius: var(--r-full);
  }
  .bd.run {
    color: var(--brand-ocean);
    background: var(--brand-bg);
  }
  .bd.wait {
    color: var(--warning);
    background: var(--warning-bg);
  }
  .bd.ok {
    color: var(--success);
    background: var(--success-bg);
  }
  .bd.skip {
    color: var(--text-muted);
    background: var(--bg-hover);
  }
  .sp {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-top-color: transparent;
  }
  .ted {
    padding: 2px 10px 10px 36px;
  }
  .ted .r {
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 18px;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
  .ted .r i {
    font-style: normal;
    color: var(--text-muted);
  }

  /* --- 审批卡(等待黄/已批准绿/已拒绝红/超时灰) --- */
  .apv {
    border-radius: var(--r-lg);
    padding: 10px;
    border: 1px solid var(--warning);
    background: var(--warning-bg);
  }
  .apv-h {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-xs);
    font-weight: var(--fw-sb);
    line-height: 18px;
    color: var(--warning);
  }
  .apv-cmd {
    margin: 6px 0;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 16px;
    color: var(--text-primary);
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 6px 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .apv-mt {
    font-size: 10px;
    line-height: 15px;
    color: var(--text-secondary);
  }
  .apv-cd {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
  }
  .apv-num {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: var(--fw-sb);
    color: var(--warning);
    width: 30px;
  }
  .apv-num.low {
    color: var(--danger);
  }
  .apv-btn {
    font-size: var(--fs-xs);
    font-weight: var(--fw-sb);
    border-radius: var(--r-md);
    padding: 7px 14px;
    border: none;
    cursor: pointer;
  }
  .apv-btn.pri {
    background: var(--brand);
    color: #ffffff;
  }
  .apv-btn.pri:hover:not(:disabled) {
    background: var(--brand-hover);
  }
  .apv-btn.dg {
    background: transparent;
    color: var(--danger);
    border: 1px solid var(--danger);
  }
  .apv-btn.dg:hover:not(:disabled) {
    background: var(--danger-bg);
  }
  .apv-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .apv-state {
    border-radius: var(--r-lg);
    padding: 10px;
    font-size: var(--fs-xs);
    font-weight: var(--fw-med);
    line-height: 18px;
  }
  .apv-state.ok {
    background: var(--success-bg);
    border: 1px solid var(--success);
    color: var(--success);
  }
  .apv-state.no {
    background: var(--danger-bg);
    border: 1px solid var(--danger);
    color: var(--danger);
  }
  .apv-state.to {
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    color: var(--text-muted);
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

  /* --- 右栏空态三型 --- */
  .emp {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: var(--sp-lg);
    text-align: center;
  }
  .emp-ic {
    width: 40px;
    height: 40px;
    border-radius: var(--r-lg);
    background: var(--bg-hover);
    color: var(--text-muted);
    font-size: 20px;
    line-height: 40px;
  }
  .emp b {
    font-size: var(--fs-sm);
    font-weight: var(--fw-sb);
    color: var(--text-primary);
  }
  .emp p {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    margin: 0 0 6px;
  }
  .emp-cta {
    display: inline-block;
    font-size: var(--fs-xs);
    font-weight: var(--fw-med);
    color: #ffffff;
    background: var(--brand);
    border: none;
    border-radius: var(--r-md);
    padding: var(--sp-xs) 14px;
    cursor: pointer;
    text-decoration: none;
  }
  .emp-cta:hover {
    background: var(--brand-hover);
  }

  /* --- 对话流 --- */
  .chatlog {
    flex: 1;
    min-height: 0;
    padding: 10px 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sys {
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 15px;
    color: var(--text-muted);
    margin: 0;
    overflow-wrap: anywhere;
  }
  .rsum {
    font-size: 11px;
    font-weight: var(--fw-med);
    line-height: 18px;
    color: var(--success);
    background: var(--success-bg);
    border: 1px solid var(--success);
    border-radius: var(--r-md);
    padding: var(--sp-xs) 10px;
    margin: 0;
  }
  .msg {
    border-radius: var(--r-lg);
    padding: 8px 10px;
    font-size: var(--fs-xs);
    line-height: 18px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .msg.u {
    background: var(--brand-bg);
    color: var(--text-primary);
    border: 1px solid var(--brand-bg);
    align-self: flex-end;
  }
  .msg.a {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .crt {
    display: inline-block;
    width: 7px;
    height: 13px;
    background: var(--brand-ocean);
    vertical-align: -2px;
  }
  .chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .chip {
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 1;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: var(--r-full);
    padding: 3px 8px;
  }
  .chip.hl {
    color: var(--brand-ocean);
    border-color: var(--brand-ocean);
  }
  .errc {
    border-radius: var(--r-lg);
    padding: 10px;
    font-size: var(--fs-xs);
    line-height: 18px;
    background: var(--danger-bg);
    border: 1px solid var(--danger);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .errc b {
    color: var(--danger);
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
  .conn.ok {
    color: var(--success);
    background: var(--success-bg);
  }
  .conn.ok .dot {
    background: var(--success);
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

  @media (prefers-reduced-motion: no-preference) {
    .sit.live .d {
      animation: agent-pulse 1.2s ease infinite;
    }
    .crt {
      animation: agent-blink 1s steps(2) infinite;
    }
    .sp {
      animation: agent-spin 0.8s linear infinite;
    }
  }
  @keyframes agent-pulse {
    50% {
      opacity: 0.35;
    }
  }
  @keyframes agent-blink {
    50% {
      opacity: 0;
    }
  }
  @keyframes agent-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
