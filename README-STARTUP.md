# evorule 一键启动指南

> 双击就启动全栈,关掉就全部停止 — 解决"多 cd / 多后端分散 / 后台进程管理"的产品级 UX 痛点。

## 三种使用方式

### 方式 1:桌面快捷(推荐,一次性配置)

**第一次**:双击 `evorule-console-cloud` 仓根目录的 `install-shortcut.bat` 创建桌面快捷,会生成:
- 桌面 `evorule-启动.lnk` (绿色启动图标)
- 桌面 `evorule-停止.lnk` (红色停止图标)

**之后**:双击桌面图标即可。

### 方式 2:仓根目录双击

- `start-all.bat` — 启全栈 + 自动开浏览器到 `/`(evorule 首页,带新手引导)
- `stop-all.bat` — 停全栈

### 方式 3:命令行

```powershell
cd <evorule-console-cloud 仓根目录>
.\start-all.bat
# 或
powershell -ExecutionPolicy Bypass -File .\start-all.ps1
```

## 启动顺序

`start-all.ps1` 按以下顺序启动(每步等端口就绪):

1. **evorule-server @ 18080** — `<evorule-server 仓根>\target\debug\evorule-server.exe`
2. **evorule-rule-serve @ 18081** — `<evorule-rule 仓根>\target\debug\evorule-rule-serve.exe`
3. **console-cloud dev @ 5174** — `node scripts/dev.mjs --yes`

全部就绪后,自动打开浏览器 `http://localhost:5174/`(evorule 首页)。

## 端口被占用怎么办?

`start-all.ps1` 会**先检测**端口是否已被占用:
- 已被占用 → 跳过启动(认为已在运行)
- 未被占用 → 启动并等待

如果端口被**旧实例**占用但想重启,先跑 `stop-all.bat` 再 `start-all.bat`。

## binary 路径配置

binary 路径默认按"兄弟目录约定"自动推导
(`<parent>\evorule-server\target\debug\evorule-server.exe` 等),
也可用环境变量覆盖(见下文"后端启动参数"):

```powershell
$env:EVORULE_SERVER_BIN = '<evorule-server 仓根>\target\release\evorule-server.exe'
$env:EVORULE_RULE_BIN   = '<evorule-rule 仓根>\target\release\evorule-rule-serve.exe'
```

## 日志位置

所有日志统一落在仓根 `logs\` 目录(已 gitignore,不污染根目录):

- `logs\dev-stdout.log` / `logs\dev-stderr.log` — vite dev 输出/错误
- `logs\evorule-server.out.log` / `logs\evorule-server.err.log` — evorule-server 输出/错误
- `logs\evorule-rule-serve.out.log` / `logs\evorule-rule-serve.err.log` — evorule-rule 输出/错误

**轮转策略**:每次拉起服务前,当前日志自动转存为 `*.prev`(旧 `.prev` 删除)。
任意时刻只保留"本轮 + 上一轮"两份,容量有界,无需手动清理或后台清理任务。

## 健康检查与自动重启

```powershell
# 查看三服务健康状态
powershell -ExecutionPolicy Bypass -File status-all.ps1

# 只拉起死掉的服务(正在运行的不动)
powershell -ExecutionPolicy Bypass -File status-all.ps1 -AutoRestart
```

可选:注册**看门狗**(Windows 计划任务,每 5 分钟自动拉起死掉的服务):

```powershell
powershell -ExecutionPolicy Bypass -File register-watchdog.ps1    # 注册
powershell -ExecutionPolicy Bypass -File unregister-watchdog.ps1  # 注销
```

看门狗进程由任务计划程序启动,完全脱离终端生命周期——异常退出最迟 5 分钟内自动恢复,也不受自动化环境的会话时长限制。

## 后端启动参数

`start-all.ps1` 默认按兄弟目录结构推导参数(evorule-server 必须带
`--rules-dir`/`--core-eval`/`--service-registry` 等资源路径,裸起不会监听 18080)。

目录结构不同或需要自定义参数(如 evorule-rule 首次引导管理员)时,用环境变量整体覆盖:

```powershell
$env:EVORULE_SERVER_BIN = 'C:\path\to\evorule-server.exe'
# 开启认证(可选):--auth-token 后,工作台需在 设置面板 → 联网配置 → 认证 Token 填入同一值
$env:EVORULE_SERVER_ARGS = '--addr 127.0.0.1:18080 --rules-dir C:\path\to\rules --auth-token <your-token> ...'

$env:EVORULE_RULE_BIN = 'C:\path\to\evorule-rule-serve.exe'
# 首次引导管理员(公开仓不硬编码凭据,密码自行提供):
$env:EVORULE_RULE_ARGS = '--host 127.0.0.1 --port 18081 --db C:\path\to\rule.db --admin-user admin --admin-password <your-password>'
```

> 认证说明:不配 `--auth-token` 时认证关闭(开发模式,受保护域写入放行);
> 配置后所有请求需 Bearer 凭据,在大众版「设置面板 → 联网配置 → 认证 Token」填入
> 与 server 一致的值即可全端点生效(详见 README.md「认证配置」)。
> 受保护域(`stable.llm.*`/`stable.system.*`)写入仅 service token 可用
> (`--service-token`,供服务间调用,浏览器端不用)。

## 平台登录与用户管理(UV-017)

除演示模式(P0 预置用户一键登录,走本地权限矩阵)外,console 支持**平台账号登录**,
账号/角色/会话全部存于 evorule-server(事实日志回放,Argon2id 口令哈希,审计链留痕):

- **首次部署**:登录页选「平台登录」→ server 无任何用户时自动进入引导,
  创建第一个平台管理员(内置 `administrator` 角色,持有全部 15 个权限点)。
- **登录态**:会话 token 有效期 7 天;登出/用户停用/删除即时吊销全部在线会话。
- **用户管理**(左侧栏「👥 用户管理」,需 `view_users` 或 `manage_users`):
  创建账号、分配角色、启停、删除;不能停用/删除自己,最后一名启用中的管理员受平台保护。
- **角色管理**(「🛡️ 角色管理」,需 `manage_roles`):内置 4 角色
  (administrator/approver/rule_engineer/viewer)不可删除;
  `administrator` 权限集锁定,其余角色权限集可调整;支持创建自定义角色(权限矩阵勾选)。
- **权限生效**:角色权限变更后,在线用户 ≤30 秒(下次导航)自动按新矩阵执行。

也可改成 release 路径(更快启动,但需要 `cargo build --release`)。

