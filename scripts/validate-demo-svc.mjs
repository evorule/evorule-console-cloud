// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// call_service 服务调用端到端验证脚本(UV-006 验收工具)
//
// 验证目标:分发包内的演示规则集(app.consolecloud.demo_svc)+
// --service-registry 声明 + server 原生 demo-services 路由在真实 server 上走通。
// 不需要任何外部服务 —— ik_solver 为进程内原生服务,server 自动应答 IoRequest。
//
// 前置条件:
//   evorule-server 以 --rules-dir(含 demo-svc.json)与
//   --service-registry service_registry.json 启动
//
// 运行:node scripts/validate-demo-svc.mjs [baseUrl]
//   baseUrl 默认 http://127.0.0.1:18080
//
// 验收项:
//   A. create_session 成功
//   B. 提交 call_service 命令后,引擎自行收敛(原生服务自动应答,无悬空 IoRequest)
//   C. 会话 payload 落 svc_response(converged=true,joint_positions ≥3 关节)
//   D. 审计链含 Command 与 IoResponse 事实(调用与结果全文入链)

const BASE = (process.argv[2] || 'http://127.0.0.1:18080').replace(/\/+$/, '');
const WAIT_MS = 15_000;
const POLL_MS = 500;

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
		// B. 提交 call_service 命令(service_name/args 自指令透传,镜像 evo-agent 宪法形态)
		const cmr = await fetch(`${BASE}/api/sessions/${sid}/command`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				instruction: {
					type: 'call_service',
					params: {
						service_name: 'inverse_kinematics_solver',
						args: {
							target_pose: { x: '0.5', y: '0.3', z: '0.2' },
							tolerance: '0.001',
							max_iterations: 100
						}
					}
				}
			}),
			signal: AbortSignal.timeout(WAIT_MS)
		});
		check(
			'B1. submit_command(call_service)',
			cmr.ok,
			cmr.ok ? '' : `HTTP ${cmr.status}`
		);
		if (!cmr.ok) return;

		// B2. 轮询状态直到收敛(server 原生服务自动应答,引擎应自行收敛)
		// state 结构:{payload, queue, reactor{phase,pending_io_count,...}, version}
		let state = null;
		for (let i = 0; i * POLL_MS < WAIT_MS; i++) {
			await new Promise((r) => setTimeout(r, POLL_MS));
			const sr = await fetch(`${BASE}/api/sessions/${sid}/state`, {
				signal: AbortSignal.timeout(WAIT_MS)
			});
			state = await sr.json().catch(() => null);
			const phase = state?.reactor?.phase;
			const pending = state?.reactor?.pending_io_count;
			if (pending === 0 && (phase === 'stable' || phase === 'idle') && state?.payload) break;
		}
		const phase = state?.reactor?.phase;
		const pending = state?.reactor?.pending_io_count;
		check(
			'B2. 引擎收敛(原生服务自动应答)',
			pending === 0 && (phase === 'stable' || phase === 'idle'),
			`reactor.phase=${phase} pending_io=${pending}`
		);

		// C. payload.svc_response(逆运动学求解结果)
		const svc = state?.payload?.svc_response ?? state?.svc_response;
		const joints = svc?.joint_positions;
		const okSvc =
			!!svc &&
			svc.converged === true &&
			Array.isArray(joints) &&
			joints.length >= 3;
		check(
			'C. payload.svc_response',
			okSvc,
			okSvc
				? `converged=true joints=${JSON.stringify(joints)}`
				: svc
					? JSON.stringify(svc).slice(0, 120)
					: 'payload 中无 svc_response'
		);

		// D. 审计链含 Command 与 IoResponse 事实(include_content=true 才返回完整 Fact 内容)
		const ar = await fetch(`${BASE}/api/sessions/${sid}/audit?include_content=true`, {
			signal: AbortSignal.timeout(WAIT_MS)
		});
		const aj = await ar.json().catch(() => null);
		const entries = Array.isArray(aj?.entries)
			? aj.entries
			: Array.isArray(aj)
				? aj
				: [];
		const s = JSON.stringify(entries);
		check('D1. 审计链条数 ≥ 4', entries.length >= 4, `共 ${entries.length} 条`);
		check(
			'D2. 审计链含 call_service 请求/应答',
			s.includes('call_service') && s.includes('joint_positions'),
			'Command(call_service) 与 IoResponse(joint_positions) 全文入链'
		);
	} finally {
		await fetch(`${BASE}/api/sessions/${sid}`, {
			method: 'DELETE',
			signal: AbortSignal.timeout(WAIT_MS)
		}).catch(() => {});
	}

	console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
	console.error('验证脚本执行失败:', e.message);
	process.exit(1);
});
