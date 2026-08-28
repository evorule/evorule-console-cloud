<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  HelpQuickstart — /help 的 5 分钟上手 tab
  内容:从 0 到跑通第一条规则
-->

<script lang="ts">
  import { goto } from "$app/navigation";

  function jumpTo(path: string) {
    void goto(path);
  }
</script>

<div class="help-pane">
  <div class="step">
    <div class="step-num">0</div>
    <div class="step-body">
      <h3>一键启动全栈(30 秒)</h3>
      <p>在 <code>evorule-console-cloud</code> 仓根目录双击 <code>start-all.bat</code>。脚本会自动:</p>
      <ol>
        <li>启 evorule-server(默认 18090)</li>
        <li>启 evorule-rule-serve(默认 18081)</li>
        <li>启 dev server(默认 5174)</li>
        <li>等就绪,自动开浏览器到 <code>/workbench</code></li>
      </ol>
      <p class="hint">
        第一次跑建议双击 <code>install-shortcut.bat</code>,生成桌面 <code>evorule-start.lnk</code>。
      </p>
    </div>
  </div>

  <div class="step">
    <div class="step-num">1</div>
    <div class="step-body">
      <h3>看工作台(30 秒)</h3>
      <p>浏览器开 <code>http://127.0.0.1:5174/workbench</code>。看到 5 个 region:</p>
      <ul>
        <li>顶部状态条(server/rule 连接 + workspace)</li>
        <li>4 统计卡(规则/Sessions/待审/最近 fact)</li>
        <li>一键操作 + 最近活动</li>
        <li>跳单页(8 按钮)</li>
      </ul>
    </div>
  </div>

  <div class="step">
    <div class="step-num">2</div>
    <div class="step-body">
      <h3>跳到规则库(1 分钟)</h3>
      <p>点工作台 Region 2 第一张卡,或侧栏"分析视图 → 📐 规则库",或访问:</p>
      <button class="link-btn" onclick={() => jumpTo("/view/rules")}>/view/rules →</button>
      <p class="hint">期望看到 5 个 demo 规则(<code>rule.demo.*</code>)。空的话说明 evorule-rule-serve 没起。</p>
    </div>
  </div>

  <div class="step">
    <div class="step-num">3</div>
    <div class="step-body">
      <h3>跳到执行台,创建 session(1 分钟)</h3>
      <p>点侧栏"分析视图 → ▶ 执行台",或访问:</p>
      <button class="link-btn" onclick={() => jumpTo("/view/execution")}>/view/execution →</button>
      <p>首次点"创建 session"。或 curl:</p>
      <pre><code>curl -X POST http://127.0.0.1:18090/api/sessions
# → {`{"message":"Session created","session_id":1}`}</code></pre>
    </div>
  </div>

  <div class="step">
    <div class="step-num">4</div>
    <div class="step-body">
      <h3>提交第一条 set 命令(1 分钟)</h3>
      <p>在执行台命令区填:</p>
      <pre><code>{(JSON.stringify({ op: "set", attr: "payload.x", value: 42 }))}</code></pre>
      <p>点"提交"。期望:顶部显示"命令已提交,version=1",状态视图出现 <code>payload.x = 42</code>。</p>
    </div>
  </div>

  <div class="step">
    <div class="step-num">5</div>
    <div class="step-body">
      <h3>看 audit fact(30 秒)</h3>
      <p>跳到 <button class="link-btn" onclick={() => jumpTo("/view/audit")}>/view/audit →</button>,期望:</p>
      <ul>
        <li>审计链时间线出现 1 条新 fact</li>
        <li>fact_type: <code>command</code></li>
        <li>payload 包含 <code>op: set</code> / <code>attr: payload.x</code> / <code>value: 42</code></li>
        <li>BLAKE3 哈希链可点击展开</li>
      </ul>
    </div>
  </div>

  <div class="step done">
    <div class="step-num">✓</div>
    <div class="step-body">
      <h3>完成</h3>
      <p>恭喜,你已跑通 evorule 完整链路:<strong>加规则 → 创建 session → 提交命令 → 审计链留痕</strong>。</p>
      <p>下一步:</p>
      <ul>
        <li>加更多规则 → <button class="link-btn" onclick={() => jumpTo("/view/rules")}>/view/rules</button></li>
        <li>时间旅行回放 → <button class="link-btn" onclick={() => jumpTo("/view/timetravel")}>/view/timetravel</button></li>
        <li>导出审计报告 → <button class="link-btn" onclick={() => jumpTo("/export")}>/export</button></li>
        <li>治理与审批 → <button class="link-btn" onclick={() => jumpTo("/governance")}>/governance</button></li>
        <li>配置 LLM 辅助 → 顶栏 ⚙️ 设置 → LLM 配置</li>
      </ul>
    </div>
  </div>
</div>

<style>
  .help-pane {
    max-width: 800px;
  }
  .step {
    display: flex;
    gap: 16px;
    margin-bottom: 24px;
    align-items: flex-start;
  }
  .step-num {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--primary, #2563eb);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 16px;
  }
  .step.done .step-num {
    background: var(--success, #16a34a);
  }
  .step-body {
    flex: 1;
    min-width: 0;
  }
  .step-body h3 {
    margin: 0 0 8px;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .step-body p {
    margin: 0 0 8px;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.6;
  }
  .step-body ul,
  .step-body ol {
    margin: 0 0 8px;
    padding-left: 20px;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.7;
  }
  .step-body code {
    background: var(--bg-input);
    border: 1px solid var(--border);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
    font-size: 12px;
    color: var(--text-primary);
  }
  .step-body pre {
    background: var(--bg-input);
    border: 1px solid var(--border);
    padding: 8px 12px;
    border-radius: 4px;
    margin: 8px 0;
    overflow-x: auto;
  }
  .step-body pre code {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--text-primary);
  }
  .hint {
    padding: 8px 12px;
    background: var(--bg-input);
    border-left: 3px solid var(--info, #1e40af);
    border-radius: 0 4px 4px 0;
    color: var(--text-secondary);
  }
  .link-btn {
    background: transparent;
    border: 0;
    color: var(--primary, #2563eb);
    cursor: pointer;
    font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
    font-size: 13px;
    padding: 0;
    text-decoration: underline;
  }
  .link-btn:hover {
    color: #1d4ed8;
  }
</style>
