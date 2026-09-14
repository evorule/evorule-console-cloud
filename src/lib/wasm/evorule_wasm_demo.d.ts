/* tslint:disable */
/* eslint-disable */

export class EvoRuleEngine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Execute a single instruction. Pure synchronous path.
     *
     * - `TransitionResult::State` -> commit payload/queue, append the fact chain
     *   (Command -> StateTransition -> TransitionTrace -> Stable), audit, and
     *   return a `state` JSON.
     * - `TransitionResult::IoRequired` -> do **not** commit; remember the
     *   instruction and return an `io_required` JSON for JS to resolve via
     *   `resolve_io` (D11 replay contract).
     */
    execute_instruction(instruction_json: string): string;
    /**
     * Full audit chain: one entry per fact, with fact_id / fact_type /
     * logical_time / content_hash / prev_hash / cause.
     */
    get_audit_chain(): string;
    /**
     * Current working payload + version snapshot.
     */
    get_state(): string;
    /**
     * Load a ruleset. Accepts either a bare JSON array of transform rules, or
     * a full rule-set object whose `transform` field holds the array.
     */
    load_rules(rules_json: string): void;
    /**
     * Create an empty engine (no rules loaded yet).
     */
    constructor();
    /**
     * Clear the working state (payload/queue/audit counter) but keep the loaded
     * ruleset, so a fresh session can start.
     */
    reset(): void;
    /**
     * Resolve a pending `io_request` with a JS-side mock result.
     *
     * Per the D11 contract, this injects `__io_result__` into the (unchanged)
     * payload and **replays** `execute_transition` with the original instruction
     * and inputs. The committed transition then lands on the audit chain.
     */
    resolve_io(io_result_json: string): string;
    /**
     * Time-travel: restore the working payload/queue to the state at `version`
     * (number of committed transitions). The append-only FactsLog is left
     * intact — only the working view moves. Returns the restored state JSON.
     */
    rewind(version: number): string;
    /**
     * Verify the BLAKE3 hash chain end-to-end.
     */
    verify_audit_chain(): boolean;
}

/**
 * Dimension 3: append `n` facts to a pure-memory FactsLog, then
 * Auditor.audit_new() + verify() (BLAKE3 content hash + chain verify).
 */
export function bench_audit(n: number): string;

/**
 * Dimension 2: one `increment` instruction through `execute_transition`,
 * called `iterations` times. Returns a checksum derived from new_payload.
 */
export function bench_execute(iterations: number): string;

/**
 * Dimension 1: load `n` rules (JSON parse + serde_to_tcb), repeated `reps`
 * times. Returns a checksum so the loop is not optimized away.
 */
export function bench_load_rules(n: number, reps: number): string;

/**
 * wasm-bindgen entry point (only compiled for wasm32).
 */
export function run_demo(rules_json: string, command_json: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_evoruleengine_free: (a: number, b: number) => void;
    readonly bench_audit: (a: number) => [number, number];
    readonly bench_execute: (a: number) => [number, number];
    readonly bench_load_rules: (a: number, b: number) => [number, number];
    readonly evoruleengine_execute_instruction: (a: number, b: number, c: number) => [number, number, number, number];
    readonly evoruleengine_get_audit_chain: (a: number) => [number, number];
    readonly evoruleengine_get_state: (a: number) => [number, number];
    readonly evoruleengine_load_rules: (a: number, b: number, c: number) => [number, number];
    readonly evoruleengine_new: () => number;
    readonly evoruleengine_reset: (a: number) => void;
    readonly evoruleengine_resolve_io: (a: number, b: number, c: number) => [number, number, number, number];
    readonly evoruleengine_rewind: (a: number, b: number) => [number, number, number, number];
    readonly evoruleengine_verify_audit_chain: (a: number) => number;
    readonly run_demo: (a: number, b: number, c: number, d: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
