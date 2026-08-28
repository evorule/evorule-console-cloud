<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  HelpStart — /help 的一键启停 tab
  内容:3 种启动方式 + 端口 + 故障排查
-->

<div class="help-pane">
  <h2>▶▶ 一键启停 evorule 全栈</h2>
  <p class="lead">解决"多 cd / 多后端分散 / 后台进程管理"的运维痛点。</p>

  <h3>三种使用方式</h3>

  <div class="way">
    <h4>方式 1 · 桌面快捷(推荐,一次性配置)</h4>
    <p><strong>第一次</strong>:在 <code>evorule-console-cloud</code> 仓根目录双击 <code>install-shortcut.bat</code> 创建桌面快捷。</p>
    <ul>
      <li>生成 <code>evorule-start.lnk</code>(绿色启动图标)</li>
      <li>生成 <code>evorule-stop.lnk</code>(红色停止图标)</li>
    </ul>
    <p><strong>之后</strong>:双击桌面图标即可。</p>
  </div>

  <div class="way">
    <h4>方式 2 · 仓根目录双击</h4>
    <ul>
      <li><code>start-all.bat</code> — 启全栈 + 自动开浏览器到 <code>/</code>(evorule 首页)</li>
      <li><code>stop-all.bat</code> — 停全栈</li>
    </ul>
  </div>

  <div class="way">
    <h4>方式 3 · PowerShell 命令行</h4>
    <pre><code>cd &lt;evorule-console-cloud 仓根&gt;
.\start-all.bat
# 或绕过 ExecutionPolicy:
powershell -ExecutionPolicy Bypass -File .\start-all.ps1</code></pre>
  </div>

  <h3>启动顺序</h3>
  <p><code>start-all.ps1</code> 按以下顺序启动(每步等端口就绪):</p>
  <ol>
    <li><strong>evorule-server @ 18090</strong> — <code>&lt;evorule-server 仓根&gt;\target\debug\evorule-server.exe</code></li>
    <li><strong>evorule-rule-serve @ 18081</strong> — <code>&lt;evorule-rule 仓根&gt;\target\debug\evorule-rule-serve.exe</code></li>
    <li><strong>console-cloud dev @ 5174</strong> — <code>node scripts/dev.mjs</code></li>
  </ol>
  <p>全部就绪后,自动打开浏览器 <code>http://127.0.0.1:5174/</code>(evorule 首页)。</p>
  <p class="hint">
    路径自动检测:默认假设 <code>evorule-server</code> / <code>evorule-rule</code> 是本仓的兄弟目录。如不在默认位置,可通过环境变量覆盖:
    <code>$env:EVORULE_SERVER_BIN</code> / <code>$env:EVORULE_RULE_BIN</code>。
  </p>

  <h3>端口速查</h3>
  <table class="port-table">
    <thead>
      <tr><th>端口</th><th>服务</th><th>进程</th></tr>
    </thead>
    <tbody>
      <tr><td>18090</td><td>evorule-server(执行引擎)</td><td>evorule-server.exe</td></tr>
      <tr><td>18081</td><td>evorule-rule(规则库/沙盒/治理)</td><td>evorule-rule-serve.exe</td></tr>
      <tr><td>5174</td><td>console-cloud dev(Vite)</td><td>node.exe</td></tr>
    </tbody>
  </table>
  <p class="hint">Vite dev 默认 listen <code>::1</code>(IPv6 localhost),某些机器上 <code>127.0.0.1:5174</code> 访问不到 — 用 <code>localhost:5174</code>。</p>

  <h3>故障排查</h3>

  <div class="issue">
    <h4>端口被占用</h4>
    <p>脚本会跳过已运行的实例。如果旧实例卡死,先 <code>stop-all.bat</code> 再 <code>start-all.bat</code>。</p>
  </div>

  <div class="issue">
    <h4>binary 不存在</h4>
    <p>编译对应仓:</p>
    <pre><code>cd &lt;evorule-server 仓根&gt;
cargo build           # debug, ~30 min 首次
# 或
cargo build --release # release, 更慢但启动快</code></pre>
  </div>

  <div class="issue">
    <h4>dev server 启动失败</h4>
    <p>看仓根目录的 <code>.dev-stdout.log</code> / <code>.dev-stderr.log</code>,常见原因:</p>
    <ul>
      <li>5174 端口被旧 vite 占用 → <code>stop-all.bat</code> 清</li>
      <li><code>node_modules</code> 缺失 → <code>cd &lt;仓根&gt; &amp;&amp; npm install</code></li>
      <li>5174 已被其它程序占 → 改 <code>start-all.ps1</code> 顶部的 <code>$PORT_WEB</code></li>
    </ul>
  </div>

  <div class="issue">
    <h4>服务异常退出</h4>
    <p><code>start-all.bat</code> <strong>不</strong>做"健康检查 + 自动重启"。异常退出后,需手动 <code>start-all.bat</code> 再启。</p>
    <p>长期方案:用 <a href="https://nssm.cc/" target="_blank" rel="noopener">nssm</a> 把 <code>node scripts/dev.mjs</code> 装成 Windows 服务(脱离自动化任务管理器,避免被中断)。</p>
  </div>

  <h3>配置 binary 路径</h3>
  <p>设置环境变量(推荐,无需改脚本):</p>
  <pre><code>$env:EVORULE_SERVER_BIN = '&lt;evorule-server 仓根&gt;\target\debug\evorule-server.exe'
$env:EVORULE_RULE_BIN   = '&lt;evorule-rule 仓根&gt;\target\debug\evorule-rule-serve.exe'</code></pre>
  <p>也可以改成 release 路径(更快启动):</p>
  <pre><code>$env:EVORULE_SERVER_BIN = '&lt;evorule-server 仓根&gt;\target\release\evorule-server.exe'
$env:EVORULE_RULE_BIN   = '&lt;evorule-rule 仓根&gt;\target\release\evorule-rule-serve.exe'</code></pre>
</div>

<style>
  .help-pane {
    max-width: 800px;
  }
  h2 {
    margin: 24px 0 12px;
    font-size: 18px;
    color: var(--text-primary);
  }
  h2:first-child {
    margin-top: 0;
  }
  h3 {
    margin: 20px 0 10px;
    font-size: 15px;
    color: var(--text-primary);
  }
  h4 {
    margin: 12px 0 6px;
    font-size: 13px;
    color: var(--primary, #2563eb);
  }
  p, ul, ol {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.7;
  }
  .lead {
    color: var(--text-muted);
    font-size: 13px;
    margin-bottom: 16px;
  }
  .way, .issue {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 12px;
  }
  .hint {
    padding: 8px 12px;
    background: var(--bg-input);
    border-left: 3px solid var(--info, #1e40af);
    border-radius: 0 4px 4px 0;
    margin: 8px 0;
  }
  code {
    background: var(--bg-input);
    border: 1px solid var(--border);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: ui-monospace, monospace;
    font-size: 12px;
    color: var(--text-primary);
  }
  pre {
    background: var(--bg-input);
    border: 1px solid var(--border);
    padding: 8px 12px;
    border-radius: 4px;
    margin: 8px 0;
    overflow-x: auto;
  }
  pre code {
    background: transparent;
    border: 0;
    padding: 0;
  }
  .port-table {
    border-collapse: collapse;
    margin: 8px 0;
    width: 100%;
    font-size: 13px;
  }
  .port-table th, .port-table td {
    border: 1px solid var(--border);
    padding: 6px 10px;
    text-align: left;
    color: var(--text-secondary);
  }
  .port-table th {
    background: var(--bg-input);
    color: var(--text-primary);
    font-weight: 600;
  }
  a {
    color: var(--primary, #2563eb);
  }
</style>
