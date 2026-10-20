// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// Agent 会话验证器 — 浏览器端 BLAKE3 链重算(@noble/hashes 纯 JS,
// 与规则集导入 contentHash 同一依赖范式,无需 Wasm/后端)。
//
// 语义(与字节级验证线一致):
//   - 逐条重算 fact_hash 并校验 prev 链接 → first_broken 定位第一处断裂
//   - 级联:first_broken 起全部标记不可信(数据导出级联,非渲染级联)
//   - root 比对:chain.root 应等于末条重算哈希

import { blake3 } from "@noble/hashes/blake3.js";
import {
	ContractError,
	type AgentSessionFact,
	type AgentSessionFile,
	type FactVerdict,
	type SessionVerification,
} from "./types";

/** 确定性 JSON 序列化:键排序+无空白,字节级稳定的哈希输入 */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(",")}]`;
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	return `{${keys
		.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
		.join(",")}}`;
}

/** fact_hash = blake3(canonical_json({fact_id, fact})),hex 编码 */
export function hashFact(factId: number, fact: AgentSessionFact): string {
	const bytes = new TextEncoder().encode(
		canonicalJson({ fact_id: factId, fact }),
	);
	return `blake3:${toHex(blake3(bytes))}`;
}

/** noble 返回 Uint8Array;统一转 hex(不依赖 Buffer) */
function toHex(bytes: Uint8Array): string {
	let hex = "";
	for (const b of bytes) hex += b.toString(16).padStart(2, "0");
	return hex;
}

/** 契约校验:形态不符明确报错(不做宽容猜测) */
export function assertContract(file: unknown): asserts file is AgentSessionFile {
	if (typeof file !== "object" || file === null) {
		throw new ContractError("文件不是 JSON 对象");
	}
	const f = file as Record<string, unknown>;
	if (f.format !== "evorule-agent-session") {
		throw new ContractError(
			`format 应为 "evorule-agent-session",实际 ${JSON.stringify(f.format)}`,
		);
	}
	if (f.version !== 1) {
		throw new ContractError(`version 仅支持 1,实际 ${JSON.stringify(f.version)}`);
	}
	if (!Array.isArray(f.facts) || !Array.isArray(f.tool_calls)) {
		throw new ContractError("facts / tool_calls 应为数组");
	}
	if (
		typeof f.chain !== "object" ||
		f.chain === null ||
		!Array.isArray((f.chain as Record<string, unknown>).entries)
	) {
		throw new ContractError("chain.entries 应为数组");
	}
	if (f.facts.length !== (f.chain as { entries: unknown[] }).entries.length) {
		throw new ContractError(
			`facts(${f.facts.length}) 与 chain.entries(${(f.chain as { entries: unknown[] }).entries.length}) 条数不一致`,
		);
	}
}

/** 完整验证:重算全链,定位 first_broken,级联标记,root 比对 */
export function verifySession(
	file: AgentSessionFile,
): SessionVerification {
	const verdicts: FactVerdict[] = [];
	let firstBroken: number | null = null;
	let prevHash: string | null = null;

	file.facts.forEach((fact, i) => {
		const entry = file.chain.entries[i];
		const recomputed = hashFact(fact.id, fact);
		const hashOk = entry.fact_hash === recomputed;
		const linkOk = entry.prev_hash === prevHash;
		if (firstBroken === null && (!hashOk || !linkOk)) {
			firstBroken = i;
		}
		verdicts.push({
			factId: fact.id,
			hashOk,
			linkOk,
			trusted: firstBroken === null,
		});
		prevHash = entry.fact_hash;
	});

	const lastIdx = file.chain.entries.length - 1;
	const rootOk =
		lastIdx >= 0 &&
		file.chain.root === file.chain.entries[lastIdx].fact_hash &&
		verdicts[lastIdx]?.hashOk === true;

	return {
		chainIntact: firstBroken === null && rootOk,
		firstBroken,
		rootOk,
		factVerdicts: verdicts,
		checkedAt: new Date().toISOString(),
	};
}

/** 导入入口:契约校验 + 验证一步完成 */
export function importAndVerify(raw: unknown): {
	file: AgentSessionFile;
	verification: SessionVerification;
} {
	assertContract(raw);
	const file = raw as AgentSessionFile;
	return { file, verification: verifySession(file) };
}
