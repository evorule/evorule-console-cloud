// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// evorule 术语表数据(PR4)。
// 供 Term(行内术语 ?)与 Glossary(术语表)组件消费。
// 词条保持简洁、口语化,面向"第一次接触 evorule 的用户"。
//
// 注意:字符串内的强调引号统一用中文全角引号 ""(U+201C/U+201D),
// 切勿使用 ASCII 半角双引号 ",否则会提前闭合字符串导致编译错误。

export interface GlossaryTerm {
	/** 唯一 id(被 Term 组件引用) */
	id: string;
	/** 展示术语 */
	term: string;
	/** 别名/同义词(可选) */
	alias?: string[];
	/** 一句话解释 */
	definition: string;
}

export const GLOSSARY: GlossaryTerm[] = [
	{
		id: "blake3",
		term: "BLAKE3 审计链",
		alias: ["审计链", "审计 fact 链", "哈希链"],
		definition:
			"用 BLAKE3 哈希把每一次操作(命令、事件)串成一条链。每个节点都包含上一个节点的哈希,任何环节被篡改都能立刻检测出来——不可伪造、可追溯。",
	},
	{
		id: "timetravel",
		term: "时间旅行",
		alias: ["回放", "版本回溯"],
		definition:
			"回到任意历史版本重新查看当时状态,并对不同版本之间的因果差异(diff)。用于排查“AI 当时为什么这么做”。",
	},
	{
		id: "rule",
		term: "规则",
		alias: ["行为规则"],
		definition:
			"evorule 守护的“行为约定”,例如“单笔转账不得超过 50 万”“调用外部 API 需审批”。AI 想做某事前先过规则判定。",
	},
	{
		id: "ruleset",
		term: "规则集",
		alias: ["规则库"],
		definition: "一组规则 + 元数据的集合,带版本号,发布后版本号单调递增,支持回滚到旧版本。",
	},
	{
		id: "fact",
		term: "Fact",
		alias: ["事实"],
		definition:
			"内核记录的一条不可变事实(一次命令或事件)。所有 Fact 按 BLAKE3 串成审计链,是审计/回放的最小单元。",
	},
	{
		id: "sandbox",
		term: "沙盒",
		alias: ["执行沙盒"],
		definition: "隔离的执行环境,AI 的规则求值与命令执行在这里进行,避免影响真实系统。",
	},
	{
		id: "governance",
		term: "治理",
		alias: ["治理中心"],
		definition: "规则的“审批 → 发布 → 回滚”工作流,以及 5 态生命周期管理,确保改动受控、可审计。",
	},
	{
		id: "workspace",
		term: "工作空间",
		alias: ["workspace", "规则库容器"],
		definition: "规则库、沙盒、发布等能力的容器。一个工作空间下可以有多个规则集与执行会话。",
	},
	{
		id: "layer",
		term: "层(L1 / L2)",
		alias: ["监控大屏", "编辑台"],
		definition:
			"工作台的两类视图:L1 监控大屏(已有发布规则,侧重实时观测)、L2 编辑台(规则草稿阶段,侧重编辑调试)。",
	},
	{
		id: "five_state",
		term: "5 态生命周期",
		alias: ["生命周期"],
		definition: "规则从生到灭的五个状态:草稿 → 评审 → 发布 → 生效 → 停用。每态切换都留痕。",
	},
	{
		id: "dengbao",
		term: "等保 2.0",
		alias: ["等级保护"],
		definition: "网络安全等级保护 2.0 标准。evorule 的“三级门禁”即对标其访问控制要求,在工具调用前做合规检查。",
	},
	{
		id: "session",
		term: "Session",
		alias: ["执行会话"],
		definition: "一次 AI 执行会话。在会话内提交命令、查看状态,所有操作都进入审计链。",
	},
];

/** 按关键词查找术语(术语/别名/解释匹配) */
export function searchGlossary(q: string): GlossaryTerm[] {
	const k = q.trim().toLowerCase();
	if (!k) return GLOSSARY;
	return GLOSSARY.filter((t) =>
		(t.term + " " + (t.alias ?? []).join(" ") + " " + t.definition)
			.toLowerCase()
			.includes(k),
	);
}
