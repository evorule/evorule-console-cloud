evorule 体验版(单机一键启动)
================================

环境要求
--------
- Windows 10/11 64 位
- 无需安装任何运行时(Node/Rust/数据库都不需要)

启动
----
1. 解压本压缩包到任意目录(路径建议不含空格)
2. 双击 start-evorule.bat
3. 浏览器自动打开 http://localhost:18080 即可使用

退出
----
关闭任务栏上最小化的 "evorule-server" 窗口即可。

体验 AI 助手(可选)
------------------
不配置 LLM 也能浏览全部界面与规则工作台;若要体验 AI 助手
(规则草稿生成/规则解释/对话问答),请准备一个 OpenAI 兼容的
API Key,在页面右上角「设置 → LLM 配置」中填写:

- API 端点(如 https://api.openai.com/v1/chat/completions)
- API Key
- 模型名(如 gpt-4o-mini)

Key 只保存在你本机浏览器中,不会上传到任何第三方。

数据与隐私
----------
- 一切都在本机运行:服务只监听 127.0.0.1(仅本机可访问)
- 会话/审计数据默认保存在包目录的 data\ 下;删除 data 目录即可重置
- AI 助手的每次调用都会写入可回放的审计链(在「审计」页查看)

目录说明
--------
- start-evorule.bat   一键启动脚本
- evorule-server.exe  本地服务(evorule-server)
- web\                前端页面(evorule-console-cloud)
- rules\              运行规则集(LLM 审计桥剧本)
- resources\          引擎宪法(core_eval.json)

常见问题
--------
Q: 端口 18080 被占用怎么办?
A: 编辑 start-evorule.bat,把两处 18080 改成其他端口(如 18081),
   浏览器地址也相应修改。

Q: 浏览器没自动打开?
A: 手动访问 http://localhost:18080

Q: 杀毒软件拦截?
A: 本包未做数字签名,部分杀软可能提示未知发布者;选择"仍要运行"即可,
   或将解压目录加入白名单。
