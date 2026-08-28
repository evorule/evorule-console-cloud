/**
 * evorule 规则预校验器(L_console 层)
 *
 * 门禁分层(详见 ./GATE_ALIGNMENT.md):
 *   L0 (权威)   — 核心仓 build.rs + clippy + Kani
 *                 扫描 Rust 源码,编译时拦截,最终权威
 *                 位置: D:\evorule\evorule-{tcb,reactor,governance,cli}\build.rs
 *                 索引: D:\evorule\GATE_REFERENCE.md
 *
 *   L_console    — 本文件 (UX 预校验,非权威)
 *                 扫描 JSON 规则内容,提交前给业务专家即时反馈
 *                 核心仓 build.rs 是最终拦截者,本层只是 UX 反馈
 *
 * evorule-console 基础版无网络,业务专家编辑规则时 evorule-server 不在线,
 * 本地预校验是唯一反馈通道。本层不污染 TCB — 校验在 TS 前端,
 * 核心仓 TCB 仍是确定性执行的最终保证。
 *
 * 检查项(7 条,与核心仓 SPEC 的对齐见每条 G 注释):
 * G1: JSON 格式合法性
 * G2: 元指令类型合法性(set, push, branch, io_request)        → 对齐 TCB_SPEC.md T1 (3+0.5 元指令有限性)
 * G3: I/O 双路径模式(io_request 必须在 exists(__io_result__) 分支内)
 * G4: 域类型合法性(eq, lt, exists, instruction, all, not)     → 对齐 TCB_SPEC.md T2 (6 域类型有限性)
 * G5: 路径引用格式(__ 前缀必须符合 __exec__.payload.xxx)
 * G6: 兜底规则存在(最后一条必须是 all([]))                   → 对齐 TCB_SPEC.md D2 (终止性保证)
 * G7: 递归深度限制(≤ 64 层)                                  → 对齐 TCB_SPEC.md D2 (MAX_BRANCH_DEPTH=64)
 *
 * 同步策略:
 *   - 核心仓 T1/T2/D2 编号变更时,本文件 + GATE_ALIGNMENT.md 必须同步
 *   - L_console 不可能覆盖 L0 全部约束(L0 含 Rust 源码层 23 模式,
 *     那些不适用于 JSON 规则内容)
 *   - 提交规则时,即使 L_console 通过,核心仓 build.rs/executor 仍会做最终拦截
 */

export interface ValidationError {
  gate: string;
  message: string;
  path?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const VALID_META_INSTRUCTIONS = ['set', 'push', 'branch', 'io_request'];
const VALID_DOMAIN_TYPES = ['eq', 'lt', 'exists', 'instruction', 'all', 'not'];
const MAX_RECURSION_DEPTH = 64;

export class RuleValidator {
  /**
   * LLM 输出前的门禁检查
   */
  static validate(json: string): ValidationResult {
    const errors: ValidationError[] = [];

    // G1: JSON 格式合法性
    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      return {
        valid: false,
        errors: [{
          gate: 'G1',
          message: `JSON 格式错误: ${(e as Error).message}`
        }]
      };
    }

    // G2: 元指令类型合法性
    if (parsed.transform && Array.isArray(parsed.transform)) {
      for (const rule of parsed.transform) {
        this.checkMetaInstruction(rule, errors, 'transform');
      }
    }

    // G3: I/O 双路径模式
    this.checkIoTwoPhase(parsed, errors);

    // G4: 域类型合法性
    this.checkDomainTypes(parsed, errors);

    // G5: 路径引用格式
    this.checkPathReferences(parsed, errors);

    // G6: 兜底规则存在
    this.checkFallbackRule(parsed, errors);

    // G7: 递归深度限制
    this.checkRecursionDepth(parsed, errors);

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * G2: 检查元指令类型(set / push / branch / io_request)
   * 对齐: TCB_SPEC.md §一 T1 (3 真元指令 + 0.5 signal 元指令, 指令集有限性 = 确定性来源)
   */
  private static checkMetaInstruction(rule: any, errors: ValidationError[], path: string): void {
    if (!rule || typeof rule !== 'object') {
      errors.push({
        gate: 'G2',
        message: `规则必须是对象，路径: ${path}`,
        path
      });
      return;
    }

    const type = rule.type;
    if (!type || !VALID_META_INSTRUCTIONS.includes(type)) {
      errors.push({
        gate: 'G2',
        message: `无效的元指令类型: ${type}，必须是 ${VALID_META_INSTRUCTIONS.join(', ')} 之一`,
        path
      });
    }

    // 递归检查子指令
    if (rule.params) {
      if (rule.params.on_true && Array.isArray(rule.params.on_true)) {
        rule.params.on_true.forEach((sub: any, i: number) => {
          this.checkMetaInstruction(sub, errors, `${path}.params.on_true[${i}]`);
        });
      }
      if (rule.params.on_false && Array.isArray(rule.params.on_false)) {
        rule.params.on_false.forEach((sub: any, i: number) => {
          this.checkMetaInstruction(sub, errors, `${path}.params.on_false[${i}]`);
        });
      }
    }
  }

  /**
   * G3: 检查 I/O 双路径模式
   * io_request 必须在 exists(__io_result__) 分支内
   */
  private static checkIoTwoPhase(value: any, errors: ValidationError[]): void {
    if (!value.transform || !Array.isArray(value.transform)) return;

    const checkRule = (rule: any, path: string, inIoResultCheck: boolean): void => {
      if (!rule || typeof rule !== 'object') return;

      // 检查当前规则是否是 io_request 且不在 __io_result__ 检查内
      if (rule.type === 'io_request' && !inIoResultCheck) {
        errors.push({
          gate: 'G3',
          message: `io_request 必须在 exists(__io_result__) 分支内，路径: ${path}`,
          path
        });
      }

      // 如果是 branch 类型，检查其子指令
      if (rule.type === 'branch' && rule.params?.domain) {
        const domain = rule.params.domain;
        const isIoResultCheck = domain.type === 'exists' && 
                               domain.path === '__exec__.payload.__io_result__';
        
        if (rule.params.on_true && Array.isArray(rule.params.on_true)) {
          rule.params.on_true.forEach((sub: any, i: number) => {
            checkRule(sub, `${path}.params.on_true[${i}]`, isIoResultCheck);
          });
        }
        if (rule.params.on_false && Array.isArray(rule.params.on_false)) {
          rule.params.on_false.forEach((sub: any, i: number) => {
            checkRule(sub, `${path}.params.on_false[${i}]`, isIoResultCheck);
          });
        }
      } else if (rule.params?.on_true || rule.params?.on_false) {
        // 其他类型也可能有子指令（虽然不规范，但需要检查）
        if (rule.params.on_true && Array.isArray(rule.params.on_true)) {
          rule.params.on_true.forEach((sub: any, i: number) => {
            checkRule(sub, `${path}.params.on_true[${i}]`, inIoResultCheck);
          });
        }
        if (rule.params.on_false && Array.isArray(rule.params.on_false)) {
          rule.params.on_false.forEach((sub: any, i: number) => {
            checkRule(sub, `${path}.params.on_false[${i}]`, inIoResultCheck);
          });
        }
      }
    };

    value.transform.forEach((rule: any, i: number) => {
      checkRule(rule, `transform[${i}]`, false);
    });
  }

  /**
   * G4: 检查域类型合法性(eq / lt / exists / instruction / all / not)
   * 对齐: TCB_SPEC.md §一 T2 (6 域类型, 域类型有限性 = 确定性来源)
   */
  private static checkDomainTypes(value: any, errors: ValidationError[]): void {
    const checkDomain = (domain: any, path: string): void => {
      if (!domain || typeof domain !== 'object') return;

      if (domain.type) {
        if (!VALID_DOMAIN_TYPES.includes(domain.type)) {
          errors.push({
            gate: 'G4',
            message: `无效的域类型: ${domain.type}，必须是 ${VALID_DOMAIN_TYPES.join(', ')} 之一`,
            path
          });
        }

        // 递归检查子域
        if (domain.domains && Array.isArray(domain.domains)) {
          domain.domains.forEach((d: any, i: number) => {
            checkDomain(d, `${path}.domains[${i}]`);
          });
        }
        if (domain.domain) {
          checkDomain(domain.domain, `${path}.domain`);
        }
      }
    };

    const checkRule = (rule: any, path: string): void => {
      if (!rule || typeof rule !== 'object') return;

      // 检查当前规则的 domain
      if (rule.params?.domain) {
        checkDomain(rule.params.domain, `${path}.params.domain`);
      }

      // 递归检查子指令
      if (rule.params?.on_true && Array.isArray(rule.params.on_true)) {
        rule.params.on_true.forEach((sub: any, i: number) => {
          checkRule(sub, `${path}.params.on_true[${i}]`);
        });
      }
      if (rule.params?.on_false && Array.isArray(rule.params.on_false)) {
        rule.params.on_false.forEach((sub: any, i: number) => {
          checkRule(sub, `${path}.params.on_false[${i}]`);
        });
      }
    };

    if (value.transform && Array.isArray(value.transform)) {
      value.transform.forEach((rule: any, i: number) => {
        checkRule(rule, `transform[${i}]`);
      });
    }
  }

  /**
   * G5: 检查路径引用格式
   *
   * 白名单 (与 server rule_translate.rs check_path_references 对齐):
   *   - __exec__.payload.*     输入数据
   *   - __exec__.instruction.* 当前指令参数
   *   - __exec__.queue         队列引用
   *   - __exec__.result.*      规则输出标记 (业务动作 notify/approve/flag)
   *   - __io_result__          IO 结果
   */
  private static checkPathReferences(value: any, errors: ValidationError[]): void {
    const checkPaths = (obj: any, path: string): void => {
      if (!obj || typeof obj !== 'object') return;

      for (const key in obj) {
        const val = obj[key];
        if (typeof val === 'string' && val.startsWith('__')) {
          // 检查 __ 前缀的路径格式
          if (!val.startsWith('__exec__.payload.') &&
              !val.startsWith('__exec__.instruction.') &&
              !val.startsWith('__exec__.queue') &&
              !val.startsWith('__exec__.result.') &&
              val !== '__io_result__') {
            errors.push({
              gate: 'G5',
              message: `无效的路径引用格式: ${val}，必须以 __exec__.payload. / __exec__.instruction. / __exec__.result. 开头`,
              path: `${path}.${key}`
            });
          }
        } else if (typeof val === 'object') {
          checkPaths(val, `${path}.${key}`);
        }
      }
    };

    checkPaths(value, 'root');
  }

  /**
   * G6: 检查兜底规则存在(末条必须是 branch + all([]))
   * 对齐: TCB_SPEC.md §四 D2 (终止性保证, 兜底规则确保未匹配指令有归宿)
   */
  private static checkFallbackRule(value: any, errors: ValidationError[]): void {
    if (!value.transform || !Array.isArray(value.transform) || value.transform.length === 0) {
      errors.push({
        gate: 'G6',
        message: '规则列表为空，缺少兜底规则',
        path: 'transform'
      });
      return;
    }

    const lastRule = value.transform[value.transform.length - 1];
    if (!lastRule || lastRule.type !== 'branch') {
      errors.push({
        gate: 'G6',
        message: '最后一条规则必须是 branch 类型的兜底规则',
        path: `transform[${value.transform.length - 1}]`
      });
      return;
    }

    const domain = lastRule.params?.domain;
    if (!domain || domain.type !== 'all' || !Array.isArray(domain.domains) || domain.domains.length !== 0) {
      errors.push({
        gate: 'G6',
        message: '兜底规则必须使用 all([]) 空域匹配所有未识别指令',
        path: `transform[${value.transform.length - 1}].params.domain`
      });
    }
  }

  /**
   * G7: 检查递归深度限制(≤ 64 层)
   * 对齐: TCB_SPEC.md §四 D2 (MAX_BRANCH_DEPTH = 64 / MAX_DOMAIN_DEPTH = 64, 终止性保证)
   */
  private static checkRecursionDepth(value: any, errors: ValidationError[]): void {
    const checkDepth = (obj: any, depth: number, path: string): void => {
      if (depth > MAX_RECURSION_DEPTH) {
        errors.push({
          gate: 'G7',
          message: `递归深度超过 ${MAX_RECURSION_DEPTH} 层，路径: ${path}`,
          path
        });
        return;
      }

      if (!obj || typeof obj !== 'object') return;

      if (obj.params) {
        if (obj.params.on_true && Array.isArray(obj.params.on_true)) {
          obj.params.on_true.forEach((sub: any, i: number) => {
            checkDepth(sub, depth + 1, `${path}.params.on_true[${i}]`);
          });
        }
        if (obj.params.on_false && Array.isArray(obj.params.on_false)) {
          obj.params.on_false.forEach((sub: any, i: number) => {
            checkDepth(sub, depth + 1, `${path}.params.on_false[${i}]`);
          });
        }
      }
    };

    if (value.transform && Array.isArray(value.transform)) {
      value.transform.forEach((rule: any, i: number) => {
        checkDepth(rule, 0, `transform[${i}]`);
      });
    }
  }
}
