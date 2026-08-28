# evorule 一键启动指南

> 双击就启动全栈,关掉就全部停止

## 三种使用方式

### 方式 1:桌面快捷(推荐,一次性配置)

**第一次**:双击 `install-shortcut.bat` 创建桌面快捷,会生成:
- 桌面 `evorule-启动.lnk` (绿色启动图标)
- 桌面 `evorule-停止.lnk` (红色停止图标)

**之后**:双击桌面图标即可。

### 方式 2:仓根目录双击

- `start-all.bat` — 启全栈 + 自动开浏览器到 `/workbench`
- `stop-all.bat` — 停全栈

### 方式 3:命令行

```powershell
cd D:\evorule-console-cloud
.\start-all.bat
# 或
powershell -ExecutionPolicy Bypass -File .\start-all.ps1
```

## 启动顺序

`start-all.ps1` 按以下顺序启动(每步等端口就绪):

1. **evorule-server @ 18090** — `D:\evorule-server\target\debug\evorule-server.exe`
2. **evorule-rule-serve @ 18081** — `D:\evorule-rule\target\debug\evorule-rule-serve.exe`
3. **console-cloud dev @ 5174** — `node scripts/dev.mjs`

全部就绪后,自动打开浏览器 `http://127.0.0.1:5174/workbench`。

## 端口被占用怎么办?

`start-all.ps1` 会**先检测**端口是否已被占用:
- 已被占用 → 跳过启动(认为已在运行)
- 未被占用 → 启动并等待

如果端口被**旧实例**占用但想重启,先跑 `stop-all.bat` 再 `start-all.bat`。

## binary 路径配置

如果 binary 路径不在默认位置,改 `start-all.ps1` 顶部的常量:

```powershell
$SERVER_EXE = 'D:\evorule-server\target\debug\evorule-server.exe'
$RULE_EXE   = 'D:\evorule-rule\target\debug\evorule-rule-serve.exe'
$DEV_DIR    = 'D:\evorule-console-cloud'
```

也可以改成 release 路径(更快启动,但需要 `cargo build --release`):
```powershell
$SERVER_EXE = 'D:\evorule-server\target\release\evorule-server.exe'
$RULE_EXE   = 'D:\evorule-rule\target\release\evorule-rule-serve.exe'
```

## 日志位置

- `D:\evorule-console-cloud\.dev-stdout.log` — vite dev 输出
- `D:\evorule-console-cloud\.dev-stderr.log` — vite dev 错误
- evorule-server / evorule-rule 的日志:各自 stdout(本脚本用 `WindowStyle=Hidden` 隐藏,如需调试可改为 `Normal`)

## 已知限制

- dev server 30 分钟 maxRunMs **仍未解**
  - 解决:用 nssm 把 `node scripts/dev.mjs` 装成 Windows 服务(后续 todo)
  - 或:用 `start-all.bat` 频繁重启(临时方案)
- `WindowStyle=Hidden` 隐藏后,服务异常时看不到输出 → 看 `.dev-*.log`
- 未做"启动失败时回滚"逻辑(已启动的后端不会自动停)
- 没有"健康检查 + 自动重启"循环(异常退出后需手动 `start-all.bat` 再启)
