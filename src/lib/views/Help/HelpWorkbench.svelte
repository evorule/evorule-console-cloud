<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  HelpWorkbench — /help 的工作台速查 tab
  内容:5 region 速查 + 何时用 / 不用
-->

<div class="help-pane">
  <h2>📊 工作台(/workbench)5 Region 速查</h2>
  <p class="lead">极简首页 — Dashboard 风格,一屏看清一切。详细设计见 <code>docs/workbench.md</code>。</p>

  <div class="region">
    <h3>1 · 顶部状态条</h3>
    <p><strong>显示</strong>:server/rule 连接状态 + workspace + 模式 + 版本</p>
    <p><strong>关键交互</strong>:<code>🔄 刷新</code>(立即拉数据) / <code>📋 4 引导任务</code>(跳 5 步建库向导)</p>
    <p><strong>含义</strong>:</p>
    <ul>
      <li>● 已连接(server) = 18080 端口 listen 且 health() 通过</li>
      <li>● 已连接(rule) = listWorkspaces() 成功</li>
      <li>workspace: 显示当前活动的 ws 名</li>
      <li>模式: ☁ 联网 / 🖥 离线</li>
    </ul>
  </div>

  <div class="region">
    <h3>2 · 4 统计卡</h3>
    <div class="cards-grid">
      <div class="stat-preview">
        <div class="icon">📐</div>
        <div class="label">规则</div>
        <div class="value">N 条</div>
        <div class="meta">内置 X + 自建 Y</div>
      </div>
      <div class="stat-preview">
        <div class="icon">▶</div>
        <div class="label">Sessions</div>
        <div class="value">N active</div>
        <div class="meta">最近活跃中</div>
      </div>
      <div class="stat-preview">
        <div class="icon">📥</div>
        <div class="label">待审</div>
        <div class="value">N</div>
        <div class="meta">需要审批 / 回滚</div>
      </div>
      <div class="stat-preview">
        <div class="icon">🔍</div>
        <div class="label">最近 Fact</div>
        <div class="value">#N</div>
        <div class="meta">type: command/verify/rule</div>
      </div>
    </div>
    <p>整张卡可点跳详情;待审数 > 0 显示橙色徽标。</p>
  </div>

  <div class="region">
    <h3>3 · 一键操作(3 tab)</h3>
    <ul>
      <li><strong>➕ 加规则</strong>:填规则 ID + JSON,点提交直接进当前 workspace(仅支持 <code>type: set</code>)</li>
      <li><strong>▶ 试运行</strong>:选 session + payload,点执行走 <code>submitCommand</code></li>
      <li><strong>🤖 LLM 快速</strong>:检测 LLM 配置,未配置给引导,已配置跳规则库起草</li>
    </ul>
    <p class="hint">未登录时,加规则 / 试运行按钮置灰,显示"请先登录"。</p>
  </div>

  <div class="region">
    <h3>4 · 最近活动</h3>
    <p>从当前 session 的 <code>audit.entries</code> 取最近 8 条 fact。</p>
    <ul>
      <li>🟢 <strong>绿</strong>:command(提交了 set/call/conditional)</li>
      <li>🔵 <strong>蓝</strong>:verify(审计链 +1 fact)</li>
      <li>🟡 <strong>黄</strong>:rule(规则变更)/ 其它</li>
    </ul>
    <p>空状态:暂无审计活动 · 在执行台提交命令后这里会实时显示。</p>
    <p>底部 <code>→ 完整审计链</code> 跳 <code>/view/audit</code>。</p>
  </div>

  <div class="region">
    <h3>5 · 跳单页(8 按钮)</h3>
    <div class="jump-grid">
      <div class="jump-preview">📐 规则库</div>
      <div class="jump-preview">▶ 执行台</div>
      <div class="jump-preview">📦 状态</div>
      <div class="jump-preview">🔍 审计</div>
      <div class="jump-preview">⏱ 时间旅行</div>
      <div class="jump-preview">📤 导出</div>
      <div class="jump-preview">📥 发布队列</div>
      <div class="jump-preview">🗂️ 治理中心</div>
    </div>
    <p>前 5 个无需登录;后 3 个(导出/发布队列/治理中心)未登录显示 🔒 锁。</p>
  </div>

  <h2>何时该看工作台</h2>
  <ul>
    <li><strong>刚启动全栈</strong> — 看状态条,确认 server/rule 都连上</li>
    <li><strong>新用户上手</strong> — 5 region 涵盖最常用操作</li>
    <li><strong>日常巡检</strong> — 一屏看清 3 件事:连接状态 / 待审数 / 最近活动</li>
    <li><strong>发现异常</strong> — "最近 FACT" 卡显示 #N 时,直接点跳审计查</li>
  </ul>

  <h2>何时该跳单页(不用工作台)</h2>
  <ul>
    <li><strong>深度操作</strong>:在工作台做"加规则"只是应急,真正建复杂规则集去 <code>/view/rules</code></li>
    <li><strong>长 session 操作</strong>:执行台长时间调试,用 <code>/view/execution</code> 全屏</li>
    <li><strong>审计细节</strong>:时间旅行/因果链分析,去 <code>/view/audit</code> / <code>/view/timetravel</code></li>
  </ul>

  <h2>不会自动做的事</h2>
  <p>工作台<strong>不</strong>做的事(避免越界):</p>
  <ul>
    <li>❌ 不持久化 tab 状态(刷新回"加规则" tab)</li>
    <li>❌ 不接管路由守卫(点跳治理页仍受后端守卫保护)</li>
    <li>❌ 不实现键盘快捷键(顶栏 <code>Ctrl+K</code> 搜索,搜索结果未跳到 workbench)</li>
    <li>❌ 不监控后台进程(只反映"现在能不能连上",30 min 杀问题靠 nssm 服务化)</li>
  </ul>
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
    margin: 16px 0 8px;
    font-size: 14px;
    color: var(--text-primary);
  }
  p, ul {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.7;
  }
  .lead {
    color: var(--text-muted);
    font-size: 13px;
    margin-bottom: 20px;
  }
  .region {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
    margin-bottom: 14px;
  }
  .region h3 {
    margin-top: 0;
    color: var(--primary, #2563eb);
  }
  .cards-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin: 8px 0;
  }
  .stat-preview {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px;
    text-align: center;
  }
  .stat-preview .icon {
    font-size: 18px;
  }
  .stat-preview .label {
    font-size: 10px;
    color: var(--text-muted);
  }
  .stat-preview .value {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
  }
  .stat-preview .meta {
    font-size: 10px;
    color: var(--text-muted);
  }
  .jump-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
    margin: 8px 0;
  }
  .jump-preview {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px;
    text-align: center;
    font-size: 12px;
    color: var(--text-primary);
  }
  .hint {
    padding: 8px 12px;
    background: var(--bg-input);
    border-left: 3px solid var(--info, #1e40af);
    border-radius: 0 4px 4px 0;
    margin-top: 8px;
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
  @media (max-width: 768px) {
    .cards-grid, .jump-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
