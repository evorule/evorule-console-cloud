evorule 体验版(单机一键启动)
================================

环境要求
--------
- Windows 10/11 64 位,或主流 Linux x86_64 发行版(macOS 12+
  规划中,当前提供 win64/linux64,另有 Docker 单镜像)
- 无需安装任何运行时(Node/Rust/数据库都不需要)
- Linux 依赖系统库:OpenSSL 3.0 / libz / libzstd(Debian 12、
  Ubuntu 22.04、RHEL 9 等近年发行版默认自带;老系统报错缺库时
  用包管理器安装 libssl3、libzstd1 即可)
- 注意:各平台的包各自独立(二进制不通用),按你的系统下载
  对应压缩包(win64 / linux64)

启动
----
1. 解压本压缩包到任意目录(路径建议不含空格)
2. 双击 start-evorule.bat (Windows)
   macOS(包规划中,发布后适用): 终端执行 sh start-evorule.sh,
   或双击 start-evorule.command
   Linux: 终端执行 sh start-evorule.sh
   (macOS/Linux 首次使用需先执行:
    chmod +x evorule-server evorule-rule-serve)
3. 浏览器自动打开 http://localhost:18080 即可使用

退出
----
Windows: 关闭任务栏上最小化的两个窗口("evorule-server" 和
"evorule-rule")即可。
macOS/Linux: 执行 sh stop-evorule.sh(服务日志在 data/logs/ 下)。
两个服务互相独立,一个失败不影响另一个;全部关闭后再重新
启动即可。

体验治理视图(规则资产库,可选)
------------------------------
主界面之外的「治理」页连接本地的规则资产治理服务
(evorule-rule,端口 18081,启动脚本已自动拉起)。首次使用:

1. 进入「治理」页,连接地址保持默认 http://127.0.0.1:18081
2. 登录体验账号:用户名 admin / 密码 evorule-demo
3. 即可浏览数据集、5 态生命周期、审批发布等治理功能
(仅限本机体验包默认凭据;正式部署必读下方安全提示)

安全提示(正式部署必读)
------------------------
体验包为降低上手门槛,内置了公开的默认凭据,直接用于正式
部署等同于大门敞开。若要把治理服务暴露给局域网/外网使用,
必须在**首次启动前**完成以下更换(编辑 start-evorule.bat):

1. --admin-password  管理员密码(默认 evorule-demo 为公开值)
2. --secret          登录令牌签名密钥(默认 evorule-demo-secret-2026
                     为公开值,泄露可被伪造登录态)
3. --admin-user      建议连用户名一并更换

重要:上述引导是"幂等"的——只在用户名不存在时创建管理员。
如果你已经启动过一次(治理库 data\rule.db 已生成),再改 bat
里的密码不会生效。此时需删除 data\rule.db 重置治理库后用
新凭据重启(注意:会清空治理数据,规则执行数据不受影响)。
无法接受重置的,请保持治理服务仅本机访问(默认如此),等待
后续版本提供在线改密功能。

体验 AI 助手(可选)
------------------
不配置 LLM 也能浏览全部界面与规则工作台;若要体验 AI 助手
(规则草稿生成/规则解释/对话问答),请准备一个 OpenAI 兼容的
API Key,在页面右上角「设置 → LLM 配置」中填写:

- API 端点(如 https://api.openai.com/v1/chat/completions)
- API Key
- 模型名(如 gpt-4o-mini)

Key 只保存在你本机浏览器中,不会上传到任何第三方。

体验服务调用(可选,离线可跑)
------------------------------
本包内置一个「工具调用」演示:规则通过 call_service 指令调用
server 内置的原生服务 inverse_kinematics_solver(六关节机械臂
逆运动学求解),进程内确定性执行,不需要联网、不需要任何外部服务。

1. 打开「执行台」(或规则试运行入口),提交 call_service 指令,
   参数示例(service_name 与 args 从指令透传):
   {"type":"call_service","params":{
    "service_name":"inverse_kinematics_solver",
    "args":{"target_pose":{"x":"0.5","y":"0.3","z":"0.2"},
            "tolerance":"0.001","max_iterations":100}}}
2. 引擎自动完成:命令 → 调用求解服务 → 求解结果写回会话
   (converged=true 与三关节位置 joint_positions)
3. 打开「审计」页可看到本次调用的完整审计链
   (请求与求解结果全文入链)

内置服务还包括 rule_sandbox(规则沙箱)等;服务声明见
service_registry.json,可自行扩展为真实 HTTP 服务端点。

数据与隐私
----------
- 一切都在本机运行:服务只监听 127.0.0.1(仅本机可访问)
- 规则/工作区/治理数据持久保存在 data\ 下的 SQLite 库,重启不丢
- 会话与审计链实时写入 data\wal\(fsync 落盘,断电不丢、事后可取证);
  重启后打开「审计」页下方的「历史会话审计档案」面板,可回看历史会话
  的完整审计链(BLAKE3 逐条验证,含 LLM 调用的请求/回复全文)
- 删除整个 data 目录即可完全重置
- AI 助手的每次调用都会写入可回放的审计链(会话存续期间在「审计」页
  查看,重启后在「历史会话审计档案」中继续可查)

目录说明
--------
- start-evorule.bat        一键启动脚本
- evorule-server.exe       主服务(evorule-server,运行时 :18080)
- evorule-rule-serve.exe   治理服务(evorule-rule,规则资产库 :18081)
- web\                     前端页面(evorule-console-cloud)
- rules\                   运行规则集(LLM 审计桥 + 服务调用演示剧本)
- service_registry.json    服务声明(call_service 的 service_name→服务映射)
- resources\               引擎宪法·server 业务规则集
                           (v0.2.0 起为 server_eval.json;v0.1.0 旧包为
                           core_eval.json —— 同一职责文件,仅文件名不同。
                           新版 server 默认读取 server_eval.json,详见
                           "升级换包"一节的迁移说明)
- data\                    首次启动后生成:wal\ 为会话/审计链 WAL,
                           其余为规则/工作区 SQLite 库文件

升级换包(拿到新版本压缩包时)
--------
1. 先停旧版服务,把旧包整个目录复制一份做备份
   (至少备份 data\ 目录——你的全部数据都在里面)
2. 解压新包到新目录(不要覆盖旧目录,便于出问题时回退)
3. 把旧包的 data\ 目录复制到新包根目录下(覆盖新包同名空目录)
4. 若你改过规则、宪法或服务声明:包内 rules\、resources\、
   service_registry.json 会被新包覆盖,请对照新旧文件把你的
   自定义内容合并回来(建议:自定义规则/宪法放独立目录,避免
   每次升级手工合并)
   宪法文件名迁移:v0.1.0 旧包的 resources\core_eval.json 在
   新版更名为 resources\server_eval.json。若你在旧包自定义过
   宪法内容,请把自定义内容合并进新包的 server_eval.json;
   直接复制旧文件时须同时重命名为 server_eval.json(或编辑
   启动脚本用 --core-eval 显式指向旧名文件)
5. 重新编辑启动脚本改回你的自定义凭据(默认凭据是公开值,
   参见上方安全提示;治理库已存在时改密码不生效,见上文幂等说明)
6. 启动并验证:登录正常、规则可执行、审计页「历史会话审计档案」
   能看到历史会话,即升级成功;旧包保留一个版本,便于回退

注意:大版本升级(如 0.4→0.5)后若服务拒绝启动并提示 WAL
恢复失败,说明新版不再读取旧数据格式——此时恢复备份的 data\
并联系新版说明确认迁移步骤;任何情况下服务都不会带着损坏
数据静默启动。

常见问题
--------
Q: 端口 18080 或 18081 被占用怎么办?
A: 编辑启动脚本(Windows: start-evorule.bat;macOS/Linux:
   start-evorule.sh),把对应端口改成其他值(如 18081→18082),
   浏览器地址与治理页连接地址也相应修改。

Q: 浏览器没自动打开?
A: 手动访问 http://localhost:18080

Q: 杀毒软件拦截?
A: 本包未做数字签名,部分杀软可能提示未知发布者;选择"仍要运行"即可,
   或将解压目录加入白名单。
