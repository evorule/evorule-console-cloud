<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->

# 如何启动/停止 evorule 全栈

> 一键启停 — 双击或命令行。解决"多 cd / 多后端分散 / 后台进程被中断"的运维痛点。

## 三种使用方式

### 方式 1 · 桌面快捷(推荐,一次性配置)

**第一次**:在 `evorule-console-cloud` 仓根目录双击 `install-shortcut.bat` 创建桌面快捷。
- 生成 `evorule-start.lnk`(绿色启动图标)
- 生成 `evorule-stop.lnk`(红色停止图标)

**之后**:双击桌面图标即可。

### 方式 2 · 仓根目录双击

- `start-all.bat` — 启全栈 + 自动开浏览器到 `/`(evorule 首页)
- `stop-all.bat` — 停全栈

### 方式 3 · PowerShell 命令行

```powershell
cd <evorule-console-cloud 仓根目录>
.\start-all.bat
# 或绕过 ExecutionPolicy:
powershell -ExecutionPolicy Bypass -File .\start-all.ps1
```

---

## 启动顺序

`start-all.ps1` 按以下顺序启动(每步等端口就绪):

1. **evorule-server @ 18090** — 仓根目录的 `target/debug/evorule-server.exe`(或 `target/release/`)
2. **evorule-rule-serve @ 18081** — 仓根目录的 `target/debug/evorule-rule-serve.exe`
3. **console-cloud dev @ 5174** — `node scripts/dev.mjs`

全部就绪后,自动打开浏览器 `http://127.0.0.1:5174/`(evorule 首页)。

`start-all.ps1` 会**先检测**端口是否已被占用:
- 已被占用 → 跳过启动(认为已在运行)
- 未被占用 → 启动并等待

---

## 端口速查

| 端口 | 服务 | 进程 |
|---|---|---|
| 18090 | evorule-server(执行引擎) | evorule-server.exe |
| 18081 | evorule-rule(规则库/沙盒/治理) | evorule-rule-serve.exe |
| 5174 | console-cloud dev(Vite) | node.exe |

Vite dev 默认 listen `::1`(IPv6 localhost),所以 `127.0.0.1:5174` 在某些机器上访问不到 — 用 `localhost:5174` 或 `http://[::1]:5174/`。`start-all.ps1` 的端口检测已双栈兼容。

---

## 故障排查

### 端口被占用

```
=== [1/3] evorule-server @ 18090 ===
  [OK] evorule-server already running (PID 7272, port 18090)
```

如果旧实例卡死,先 `stop-all.bat` 再 `start-all.bat`。

### binary 不存在

```
=== [1/3] evorule-server @ 18090 ===
  [ERR] evorule-server binary not found: ...target/debug/evorule-server.exe
  [WARN] Need to build first: cd to repo root, run 'cargo build'
```

编译对应仓:

```powershell
cd <evorule-server 仓根目录>
cargo build           # debug, ~30 min 首次
# 或
cargo build --release # release, 更慢但启动快
```

### dev server 启动失败

看仓根目录的 `.dev-stdout.log` / `.dev-stderr.log`,常见原因:
- 5174 端口被旧 vite 占用 → `stop-all.bat` 清
- `node_modules` 缺失 → `cd <仓根目录> && npm install`
- 5174 已被其它程序占(本机其它项目)→ 改 `start-all.ps1` 顶部的端口常量

### 服务异常退出

`start-all.bat` **不**做"健康检查 + 自动重启"。异常退出后,需手动 `start-all.bat` 再启。

长期方案:用 [nssm](https://nssm.cc/) 把 `node scripts/dev.mjs` 装成 Windows 服务(脱离自动化任务管理器,避免被中断)。

---

## 配置 binary 路径

如果 binary 路径不在默认位置,改 `start-all.ps1` 顶部的常量:

```powershell
$SERVER_EXE = '<evorule-server 仓根>\target\debug\evorule-server.exe'
$RULE_EXE   = '<evorule-rule 仓根>\target\debug\evorule-rule-serve.exe'
$DEV_DIR    = '<evorule-console-cloud 仓根>'
```

也可以改成 release 路径(更快启动,但需要 `cargo build --release`):
```powershell
$SERVER_EXE = '<evorule-server 仓根>\target\release\evorule-server.exe'
$RULE_EXE   = '<evorule-rule 仓根>\target\release\evorule-rule-serve.exe'
```

---

## 日志位置

- `<仓根目录>\.dev-stdout.log` — vite dev 输出
- `<仓根目录>\.dev-stderr.log` — vite dev 错误
- evorule-server / evorule-rule 的日志:各自 stdout(本脚本用 `WindowStyle=Hidden` 隐藏,如需调试可改为 `Normal`)

---

## 已知限制

- 后台 dev server 在某些自动化运行环境下可能受 30 分钟最大运行时长限制
  - 解决:用 nssm 把 `node scripts/dev.mjs` 装成 Windows 服务(后续 todo)
  - 或:用 `start-all.bat` 频繁重启(临时方案)
- `WindowStyle=Hidden` 隐藏后,服务异常时看不到输出 → 看 `.dev-*.log`
- 未做"启动失败时回滚"逻辑(已启动的后端不会自动停)
- 没有"健康检查 + 自动重启"循环(异常退出后需手动 `start-all.bat` 再启)
