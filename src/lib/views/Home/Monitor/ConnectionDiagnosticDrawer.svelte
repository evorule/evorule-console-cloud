<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:连接诊断抽屉(从 ConnectionBanner 点开)
    - 连接状态:SSE 状态 / 最后错误 / 重连次数 / 最近连接时间
    - 服务地址:baseUrl → host:port(可复制)
    - 网络模式:online / offline + 远程地址
    - 后端探测:主动 fetch /api/production/state(5s 超时)
    - 规则集状态:productionState.status / rulesetVersion / session
    - 操作:重新连接 / 关闭
    - 排障指引:静态步骤
  纯前端只读诊断,不修改任何连接状态(重新连接由 onRetry 回调执行)。
-->

<script lang="ts">
  import type { ConnectionState } from "$lib/stores/sse-connection";
  import type { ProductionState } from "$lib/stores/production-state";
  import { netConfig } from "$lib/config/net-config";

  interface Props {
    connection: ConnectionState;
    baseUrl: string;
    productionState: ProductionState;
    onClose: () => void;
    onRetry: () => void;
  }

  let { connection, baseUrl, productionState, onClose, onRetry }: Props = $props();

  // === 解析 host:port ===
  const parsed = $derived.by(() => {
    try {
      const u = new URL(baseUrl);
      return { host: u.hostname, port: u.port || "(默认)", raw: u.origin };
    } catch {
      return { host: baseUrl, port: "—", raw: baseUrl };
    }
  });

  // === 连接状态展示 ===
  const statusMeta = $derived.by(() => {
    switch (connection.status) {
      case "connected":
        return { label: "已连接", tone: "ok" as const };
      case "connecting":
        return { label: "连接中", tone: "warn" as const };
      case "reconnecting":
        return { label: "重连中", tone: "warn" as const };
      case "degraded":
        return { label: "降级(轮询)", tone: "warn" as const };
      case "disconnected":
      default:
        return { label: "未连接", tone: "bad" as const };
    }
  });

  // === 后端探测 ===
  let probing = $state(false);
  let probe = $state<{ ok: boolean; message: string } | null>(null);

  async function runProbe() {
    probing = true;
    probe = null;
    const url = `${baseUrl.replace(/\/+$/, "")}/api/production/state`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const resp = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      probe = {
        ok: resp.ok,
        message: resp.ok
          ? `后端可达(HTTP ${resp.status})`
          : `后端返回 ${resp.status},但服务在响应`,
      };
    } catch (e) {
      probe = { ok: false, message: `无法连接:${(e as Error).message}` };
    } finally {
      probing = false;
    }
  }

  function handleRetry() {
    onRetry();
    onClose();
  }

  async function copyBaseUrl() {
    try {
      await navigator.clipboard.writeText(baseUrl);
    } catch {
      /* 剪贴板不可用时静默忽略 */
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="diag-backdrop"
  role="presentation"
  onclick={onClose}
  aria-hidden="true"
></div>

<div
  class="diag-drawer"
  role="dialog"
  aria-modal="true"
  aria-label="连接诊断"
  tabindex="-1"
>
  <header class="diag-head">
    <h2 class="diag-title">🔌 连接诊断</h2>
    <button class="diag-close" onclick={onClose} aria-label="关闭诊断抽屉">✕</button>
  </header>

  <div class="diag-body">
    <!-- 1. 连接状态 -->
    <section class="diag-sec">
      <h3 class="diag-sec-title">连接状态</h3>
      <div class="diag-row">
        <span class="diag-k">SSE 状态</span>
        <span class={`badge badge-${statusMeta.tone}`}>{statusMeta.label}</span>
      </div>
      {#if connection.lastError}
        <div class="diag-row">
          <span class="diag-k">最后错误</span>
          <span class="diag-v diag-err">{connection.lastError}</span>
        </div>
      {/if}
      <div class="diag-row">
        <span class="diag-k">重连次数</span>
        <span class="diag-v">{connection.retryCount}</span>
      </div>
      {#if connection.lastConnectedAt}
        <div class="diag-row">
          <span class="diag-k">最近连接</span>
          <span class="diag-v"
            >{new Date(connection.lastConnectedAt).toLocaleString()}</span
          >
        </div>
      {/if}
    </section>

    <!-- 2. 服务地址 -->
    <section class="diag-sec">
      <h3 class="diag-sec-title">服务地址</h3>
      <div class="diag-row">
        <span class="diag-k">Host</span>
        <span class="diag-v">{parsed.host}</span>
      </div>
      <div class="diag-row">
        <span class="diag-k">Port</span>
        <span class="diag-v">{parsed.port}</span>
      </div>
      <div class="diag-row diag-row-url">
        <span class="diag-k">Base URL</span>
        <code class="diag-url">{parsed.raw}</code>
        <button class="diag-copy" onclick={copyBaseUrl} aria-label="复制地址"
          >复制</button
        >
      </div>
    </section>

    <!-- 3. 网络模式 -->
    <section class="diag-sec">
      <h3 class="diag-sec-title">网络模式</h3>
      <div class="diag-row">
        <span class="diag-k">当前模式</span>
        <span
          class={`badge ${$netConfig.mode === "online" ? "badge-ok" : "badge-info"}`}
          >{$netConfig.mode === "online" ? "联网 (online)" : "离线 (offline)"}</span
        >
      </div>
      <div class="diag-row">
        <span class="diag-k">远程地址</span>
        <span class="diag-v">{$netConfig.remoteBaseUrl}</span>
      </div>
    </section>

    <!-- 4. 后端探测 -->
    <section class="diag-sec">
      <h3 class="diag-sec-title">后端探测</h3>
      <button
        class="diag-probe"
        onclick={runProbe}
        disabled={probing}
        aria-busy={probing}
      >
        {probing ? "探测中…" : "测试后端连接"}
      </button>
      {#if probe}
        <div class={`diag-probe-result ${probe.ok ? "ok" : "bad"}`}>
          {probe.ok ? "✅" : "❌"} {probe.message}
        </div>
      {/if}
    </section>

    <!-- 5. 规则集状态 -->
    <section class="diag-sec">
      <h3 class="diag-sec-title">规则集状态</h3>
      <div class="diag-row">
        <span class="diag-k">运行状态</span>
        <span
          class={`badge ${
            productionState.status === "running"
              ? "badge-ok"
              : productionState.status === "switching"
                ? "badge-warn"
                : "badge-bad"
          }`}
          >{productionState.status === "running"
            ? "运行中"
            : productionState.status === "switching"
              ? "切换中"
              : "离线"}</span
        >
      </div>
      <div class="diag-row">
        <span class="diag-k">规则集版本</span>
        <span class="diag-v">v{productionState.rulesetVersion}</span>
      </div>
      <div class="diag-row">
        <span class="diag-k">活跃 Session</span>
        <span class="diag-v"
          >{productionState.currentSessionId !== null
            ? `#${productionState.currentSessionId}`
            : "无"}</span
        >
      </div>
    </section>

    <!-- 6. 排障指引 -->
    <section class="diag-sec">
      <h3 class="diag-sec-title">排障指引</h3>
      <ol class="diag-steps">
        <li>确认 <code>evorule-server</code> 已启动(默认监听 127.0.0.1:18080)。</li>
        <li>检查端口是否被占用或防火墙拦截。</li>
        <li>若使用远程部署,确认「设置 → 联网」模式与远程地址正确。</li>
        <li>点击上方「测试后端连接」验证可达性,再「重新连接」。</li>
        <li>多次重连仍失败会进入「降级(轮询)」,服务恢复后自动重连 SSE。</li>
      </ol>
    </section>
  </div>

  <footer class="diag-foot">
    <button class="diag-btn-secondary" onclick={onClose}>关闭</button>
    <button class="diag-btn-primary" onclick={handleRetry}>重新连接</button>
  </footer>
</div>

<style>
  .diag-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 900;
  }
  .diag-drawer {
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    width: min(420px, 92vw);
    background: var(--bg-card, #0d1117);
    border-left: 1px solid var(--border-strong, rgba(255, 255, 255, 0.15));
    box-shadow: var(--sh-modal, 0 10px 25px rgba(0, 0, 0, 0.5));
    display: flex;
    flex-direction: column;
    z-index: 901;
    color: var(--text-primary, #f1f5f9);
  }
  .diag-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 18px;
    border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
    flex-shrink: 0;
  }
  .diag-title {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
  }
  .diag-close {
    background: transparent;
    border: none;
    color: var(--text-secondary, #94a3b8);
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: var(--r-sm, 4px);
  }
  .diag-close:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.06));
    color: var(--text-primary, #f1f5f9);
  }
  .diag-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 18px 18px;
  }
  .diag-sec {
    padding: 14px 0;
    border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  }
  .diag-sec-title {
    margin: 0 0 10px 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary, #94a3b8);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .diag-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 0;
    font-size: 13px;
  }
  .diag-k {
    color: var(--text-secondary, #94a3b8);
    min-width: 72px;
    flex-shrink: 0;
  }
  .diag-v {
    color: var(--text-primary, #f1f5f9);
    word-break: break-all;
  }
  .diag-err {
    color: #f87171;
  }
  .diag-row-url {
    align-items: flex-start;
  }
  .diag-url {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    background: var(--bg-hover, rgba(255, 255, 255, 0.06));
    padding: 2px 6px;
    border-radius: var(--r-sm, 4px);
    word-break: break-all;
    flex: 1;
  }
  .diag-copy {
    flex-shrink: 0;
    background: transparent;
    border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.15));
    color: var(--text-primary, #f1f5f9);
    border-radius: var(--r-sm, 4px);
    padding: 2px 8px;
    font-size: 12px;
    cursor: pointer;
  }
  .diag-copy:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.06));
  }
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 10px;
    border-radius: var(--r-full, 9999px);
    font-size: 12px;
    font-weight: 600;
  }
  .badge-ok {
    background: var(--success-bg, rgba(46, 204, 113, 0.12));
    color: #4ade80;
  }
  .badge-warn {
    background: var(--info-bg, rgba(59, 130, 246, 0.12));
    color: #fbbf24;
  }
  .badge-bad {
    background: rgba(248, 113, 113, 0.12);
    color: #f87171;
  }
  .badge-info {
    background: var(--info-bg, rgba(59, 130, 246, 0.12));
    color: #60a5fa;
  }
  .diag-probe {
    width: 100%;
    padding: 9px 14px;
    background: var(--bg-hover, rgba(255, 255, 255, 0.06));
    color: var(--text-primary, #f1f5f9);
    border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.15));
    border-radius: var(--r-sm, 4px);
    cursor: pointer;
    font-size: 13px;
  }
  .diag-probe:hover:not(:disabled) {
    border-color: var(--brand, #1d63ed);
  }
  .diag-probe:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .diag-probe-result {
    margin-top: 8px;
    font-size: 12px;
    padding: 8px 10px;
    border-radius: var(--r-sm, 4px);
    line-height: 1.4;
  }
  .diag-probe-result.ok {
    background: var(--success-bg, rgba(46, 204, 113, 0.12));
    color: #4ade80;
  }
  .diag-probe-result.bad {
    background: rgba(248, 113, 113, 0.12);
    color: #f87171;
  }
  .diag-steps {
    margin: 0;
    padding-left: 18px;
    font-size: 12px;
    color: var(--text-secondary, #94a3b8);
    line-height: 1.7;
  }
  .diag-steps code {
    font-family: var(--font-mono, monospace);
    background: var(--bg-hover, rgba(255, 255, 255, 0.06));
    padding: 1px 4px;
    border-radius: 3px;
  }
  .diag-foot {
    display: flex;
    gap: 10px;
    padding: 14px 18px;
    border-top: 1px solid var(--border, rgba(255, 255, 255, 0.08));
    flex-shrink: 0;
  }
  .diag-btn-secondary,
  .diag-btn-primary {
    flex: 1;
    padding: 10px 14px;
    border-radius: var(--r-sm, 4px);
    font-size: 14px;
    cursor: pointer;
  }
  .diag-btn-secondary {
    background: transparent;
    border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.15));
    color: var(--text-primary, #f1f5f9);
  }
  .diag-btn-secondary:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.06));
  }
  .diag-btn-primary {
    background: var(--brand, #1d63ed);
    border: none;
    color: #fff;
    font-weight: 500;
  }
  .diag-btn-primary:hover {
    opacity: 0.9;
  }
  .diag-btn-primary:focus-visible,
  .diag-btn-secondary:focus-visible,
  .diag-close:focus-visible,
  .diag-probe:focus-visible,
  .diag-copy:focus-visible {
    outline: 2px solid var(--brand, #1d63ed);
    outline-offset: 2px;
  }
</style>
