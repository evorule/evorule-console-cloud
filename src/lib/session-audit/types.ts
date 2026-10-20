// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evo-agent-session v1 — Agent 会话导出契约(查看器/验证器共用)。
//
// 设计原则:通用性在契约不在显示端。
//   - 一个标准格式 + 一个查看器,N 个生产者(evo-agent 今日首个,任何按
//     契约导出的 agent 系统皆可入验证)
//   - facts 与内核 Fact 同构(index signature),复用既有渲染心智
//   - chain 独立段:验证不依赖 facts 自身的可信声明
//   - tool_calls 为 agent 特有扩展段(LLM 动作明细,供字节级重放对照)
//
// 哈希语义:
//   entry.fact_hash = blake3(canonical_json({ fact_id, fact }))
//   entry[i].prev_hash = entry[i-1].fact_hash(首条为 null)
//   chain.root = 末条 entry.fact_hash
//   canonical_json = UTF-8 JSON,键排序,无空白(确定性字节级)

/** 会话内一条事实(与内核 Fact 同构:index signature 透传) */
export interface AgentSessionFact {
	type: string;
	id: number;
	logical_time?: number;
	timestamp?: string;
	[key: string]: unknown;
}

/** 哈希链节点(逐条事实) */
export interface ChainEntry {
	fact_id: number;
	fact_hash: string;
	prev_hash: string | null;
}

/** LLM 动作明细(tool_calls 扩展段的一条) */
export interface AgentToolCall {
	seq: number;
	name: string;
	args_summary: string;
	result_summary?: string;
	linked_fact_id?: number;
}

/** 导出方清单(人读摘要 + 验证元信息) */
export interface AgentSessionManifest {
	session_id: string;
	producer: string;
	producer_version: string;
	created_at: string;
	task_summary: string;
	verdict?: string;
	tool_call_count?: number;
}

/** Agent 会话导出文件根结构 */
export interface AgentSessionFile {
	format: "evo-agent-session";
	version: 1;
	manifest: AgentSessionManifest;
	facts: AgentSessionFact[];
	chain: {
		algorithm: "blake3-linked";
		entries: ChainEntry[];
		root: string;
	};
	tool_calls: AgentToolCall[];
}

/** 单条事实的验证态(first_broken 起级联标记不可信) */
export interface FactVerdict {
	factId: number;
	/** 本条哈希重算是否与链声明一致 */
	hashOk: boolean;
	/** 与前条的 prev 链接是否成立 */
	linkOk: boolean;
	/** 级联信任标记:链断后全部不可信(数据导出级联语义) */
	trusted: boolean;
}

/** 一次完整验证的产物 */
export interface SessionVerification {
	chainIntact: boolean;
	/** 第一处断裂的事实序号(从 0 计);链完整为 null */
	firstBroken: number | null;
	/** 根哈希比对(root 与末条重算哈希一致) */
	rootOk: boolean;
	factVerdicts: FactVerdict[];
	checkedAt: string;
}

/** 契约校验失败(格式/版本不符——查看器拒绝渲染,不猜测) */
export class ContractError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ContractError";
	}
}
