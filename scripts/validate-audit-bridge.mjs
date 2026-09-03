// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// LLM 审计桥端到端验证脚本(02-约束总表 K 族验收工具)
//
// 验证目标:server 桥接规则(core_eval) + IoSubscriber skip 谓词 +
// 协议回路在真实 server 上走通。不调用任何 LLM —— IoRequest 到达后直接回写
// 固定 io_response,验证引擎侧回路完整性与审计链落链。
// 注(UV-054):llm-audit-bridge 自持剧本已退役,单发桥接归引擎 core_eval 单一权威。
//
// 前置条件:
//   evorule-server 以 --rules-dir 指向 assets/evorule-rules(仅含 scenario-*,无重复桥接)
//     cargo run -p evorule-server -- --rules-dir assets/evorule-rules
//
// 运行:node scripts/validate-audit-bridge.mjs [baseUrl]
//   baseUrl 默认 http://127.0.0.1:18080
//
// 验收项:
//   A. create_session 成功
//   B. 提交 call_external 命令后收到 IoRequest(io_type=call_external,messages 透传)
//   C. 回写 io_response 后收到 Stable(回路收敛,无悬空 IoRequest)
//   D. 会话 payload 落 llm_response(结果全文进状态)
//   E. 审计链含 Command 与 IoResponse 事实(prompt/结果全文入链)

const BASE = (process.argv[2] || 'http://127.0.0.1:18080').replace(/\/+$/, '');
const WAIT_MS = 30_000;

let failures = 0;
function check(name, ok, detail = '') {
	const tag = ok ? 'PASS' : 'FAIL';
	console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
	if (!ok) failures++;
}

async function main() {
	// A. create_session
	const csr = await fetch(`${BASE}/api/sessions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: '{}',
		signal: AbortSignal.timeout(WAIT_MS)
	});
	const csj = await csr.json().catch(() => null);
	check(
		'A. create_session',
		csr.ok && csj && typeof csj.session_id === 'number',
		csr.ok ? `session_id=${csj?.session_id}` : `HTTP ${csr.status}`
	);
	if (!csj || typeof csj.session_id !== 'number') process.exit(1);
	const sid = csj.session_id;

	try {
		// 订阅 SSE(先订阅后提交命令:broadcast 通道不重放历史)
		const esr = await fetch(`${BASE}/api/sessions/${sid}/events`, {
			signal: AbortSignal.timeout(WAIT_MS)
		});
		check('B0. subscribe_events', esr.ok && !!esr.body, `HTTP ${esr.status}`);
		if (!esr.ok || !esr.body) return;

		const reader = esr.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		async function nextEvent() {
			for (;;) {
				const idx = buffer.indexOf('\n\n');
				if (idx !== -1) {
					const raw = buffer.slice(0, idx);
					buffer = buffer.slice(idx + 2);
					const line = raw.split('\n').find((l) => l.startsWith('data:'));
					if (!line) continue;
					try {
						return JSON.parse(line.slice(5).trim());
					} catch {
						/* 忽略解析失败的心跳/注释 */
					}
					continue;
				}
				const chunk = await reader.read();
				if (chunk.done) return null;
				buffer += decoder.decode(chunk.value, { stream: true });
			}
		}

		// 提交 call_external 命令(与 audited-llm.ts 同形态:prompt 全文入 messages)
		const messages = [
			{ role: 'system', content: '你是审计桥验证助手' },
			{ role: 'user', content: '验证消息:请原样回复 ECHO_OK' }
		];
		const cmr = await fetch(`${BASE}/api/sessions/${sid}/command`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				instruction: {
					type: 'call_external',
					params: { model: 'validation', temperature: 0.2, messages, audit_purpose: 'validate' }
				}
			}),
			signal: AbortSignal.timeout(WAIT_MS)
		});
		check('B1. submit_command', cmr.ok, cmr.ok ? '' : `HTTP ${cmr.status}`);

		// B. 等 IoRequest(跳过 Command/StateTransition 等中间事件)
		let ioReq = null;
		for (;;) {
			const ev = await nextEvent();
			if (ev === null) break;
			if (ev.type === 'IoRequest') {
				ioReq = ev;
				break;
			}
			if (ev.type === 'Error') {
				check('B. IoRequest', false, `引擎 Error 事件: ${ev.message}`);
				return;
			}
		}
		check(
			'B. IoRequest',
			!!ioReq && ioReq.io_type === 'call_external',
			ioReq
				? `request_id=${ioReq.id} io_type=${ioReq.io_type}`
				: '未收到(SSE 流关闭)'
		);
		if (!ioReq) return;
		const reqMessages = ioReq.params?.messages ?? ioReq.params?.params?.messages;
		const msgEq =
			Array.isArray(reqMessages) &&
			reqMessages.length === messages.length &&
			messages.every(
				(m, i) =>
					reqMessages[i]?.role === m.role &&
					reqMessages[i]?.content === m.content
			);
		check(
			'B2. IoRequest.messages 透传',
			msgEq,
			Array.isArray(reqMessages) ? `${reqMessages.length} 条消息` : 'messages 缺失'
		);

		// C. 回写 io_response → 等 Stable
		const irr = await fetch(`${BASE}/api/sessions/${sid}/io_response`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				request_id: ioReq.id,
				result: { content: 'ECHO_OK:审计桥验证回复' },
				error: null
			}),
			signal: AbortSignal.timeout(WAIT_MS)
		});
		check('C1. submit_io_response', irr.ok, irr.ok ? '' : `HTTP ${irr.status}`);

		let stable = false;
		for (;;) {
			const ev = await nextEvent();
			if (ev === null) break;
			if (ev.type === 'Stable') {
				stable = true;
				break;
			}
			if (ev.type === 'Error') {
				check('C. Stable', false, `引擎 Error 事件: ${ev.message}`);
				return;
			}
		}
		check('C. Stable(回路收敛)', stable, stable ? '' : '未收到(SSE 流关闭)');

		// D. payload 落 llm_response(会话状态快照 GET /api/sessions/{id}/state)
		const pr = await fetch(`${BASE}/api/sessions/${sid}/state`, {
			signal: AbortSignal.timeout(WAIT_MS)
		});
		const pj = await pr.json().catch(() => null);
		const llmResponse = pj?.payload?.llm_response ?? pj?.llm_response;
		check(
			'D. payload.llm_response',
			!!llmResponse && llmResponse.content === 'ECHO_OK:审计桥验证回复',
			llmResponse ? JSON.stringify(llmResponse).slice(0, 120) : 'payload 中无 llm_response'
		);

		// E. 审计链含 Command 与 IoResponse 事实(include_content=true 才返回完整 Fact 内容)
		const ar = await fetch(`${BASE}/api/sessions/${sid}/audit?include_content=true`, {
			signal: AbortSignal.timeout(WAIT_MS)
		});
		const aj = await ar.json().catch(() => null);
		const entries = JSON.stringify(aj);
		const hasCommand = entries.includes('"call_external"') && entries.includes('audit_purpose');
		const hasIoResponse = entries.includes('ECHO_OK:审计桥验证回复');
		check(
			'E1. 审计链含命令事实(prompt 全文)',
			hasCommand,
			hasCommand ? '' : 'audit 未检索到 call_external/audit_purpose'
		);
		check('E2. 审计链含 io_response 事实(结果全文)', hasIoResponse, hasIoResponse ? '' : 'audit 未检索到结果全文');
	} finally {
		await fetch(`${BASE}/api/sessions/${sid}`, {
			method: 'DELETE',
			signal: AbortSignal.timeout(5_000)
		}).catch(() => {});
	}

	console.log('');
	if (failures > 0) {
		console.log(`结果: ${failures} 项失败`);
		process.exit(1);
	}
	console.log('结果: 全部通过 — LLM 审计桥引擎侧回路与审计链落链验证 OK');
}

main().catch((e) => {
	console.error('[validate-audit-bridge] 异常终止:', e.message);
	process.exit(1);
});
