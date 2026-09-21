// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// fetchAgentLlmStatus 单测 — GET /admin/llm-status 消费端(mock fetch)

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAgentLlmStatus, type AgentConfig } from '../agent-config';

function makeCfg(over: Partial<AgentConfig> = {}): AgentConfig {
	return {
		enabled: true,
		baseUrl: 'http://127.0.0.1:8081/',
		authToken: 'tok-123',
		tokenStorage: 'plain',
		locked: false,
		...over
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('fetchAgentLlmStatus', () => {
	it('hits the endpoint on the trimmed base with bearer header and parses the payload', async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				configured: true,
				provider: 'minimax',
				model: 'MiniMax-M2.5',
				api_base: 'https://api.minimax.io/v1?x=1',
				api_key: { present: true, hint: 'wxyz', source: 'EVO_AGENT_LLM__API_KEY' }
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await fetchAgentLlmStatus(makeCfg());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.status.configured).toBe(true);
			expect(result.status.provider).toBe('minimax');
			expect(result.status.api_key.present).toBe(true);
			expect(result.status.api_key.hint).toBe('wxyz');
			expect(result.status.api_key.source).toBe('EVO_AGENT_LLM__API_KEY');
		}
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			{ headers?: Record<string, string> }
		];
		expect(url).toBe('http://127.0.0.1:8081/admin/llm-status');
		expect(init?.headers?.Authorization).toBe('Bearer tok-123');
	});

	it('omits the authorization header when no token is set', async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				configured: false,
				provider: '',
				model: '',
				api_base: '',
				api_key: { present: false, hint: null, source: null }
			})
		);
		vi.stubGlobal('fetch', fetchMock);
		const result = await fetchAgentLlmStatus(makeCfg({ authToken: '' }));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.status.configured).toBe(false);
			expect(result.status.api_key.present).toBe(false);
		}
		const [, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			{ headers?: Record<string, string> }
		];
		expect(init?.headers?.Authorization).toBeUndefined();
	});

	it('maps 401 to unauthorized without leaking the token', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('unauthorized', { status: 401 }))
		);
		const result = await fetchAgentLlmStatus(makeCfg());
		expect(result).toEqual({ ok: false, message: 'unauthorized' });
	});

	it('maps non-2xx to http-<status>', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 500 }))
		);
		const result = await fetchAgentLlmStatus(makeCfg());
		expect(result).toEqual({ ok: false, message: 'http-500' });
	});

	it('rejects a payload without api_key shape (bad-payload)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ configured: true })));
		const result = await fetchAgentLlmStatus(makeCfg());
		expect(result).toEqual({ ok: false, message: 'bad-payload' });
	});

	it('maps network errors', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('boom');
			})
		);
		const result = await fetchAgentLlmStatus(makeCfg());
		expect(result).toEqual({ ok: false, message: 'boom' });
	});
});
