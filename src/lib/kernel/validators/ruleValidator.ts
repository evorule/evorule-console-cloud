/**
 * evorule 规则预校验器(L_console 层)
 *
 * 门禁分层:
 *   L0 (权威)   — evorule-server core/rule_schema(固化 rule_set v1.0 Schema)
 *                 + 核心仓 build.rs + clippy + Kani,最终权威
 *   L_console   — 本文件(UX 预校验,非权威)
 *                 提交前即时反馈;server POST /api/rules/validate(schema gate
 *                 + governance 详细校验)仍是入库前的权威预检
 *
 * 对齐源(UV-074 / UV-058 W2.1,2026-09-04 重对齐):
 *   evorule-server core/rule_schema/schemas/_shared/v1.0.json(固化版,$defs SSOT)
 *   — 6 元指令枚举 + 各指令 params 完备性(_shared L161-281)
 *   — 7 基础域类型(含 has_fields,L30)+ inner 嵌套(禁 domain/domains,P0-03,L59-63)
 *   — path 正则(L9,权威源 evorule-tcb/src/path.rs)+ 单数 __io_result__ 拒绝(P1-03,L10)
 *   — I/O 结果复数 __io_results__.<io_type>(L234)
 *
 * 分级:
 *   errors   — 阻断(结构非法,本地即拦,不等 server)
 *   warnings — 提示(合法但建议:双路径 IO 模式 / 兜底规则)
 *
 * 检查项:
 *   G0: transform 结构存在({transform:[...]} / 顶层数组 / 单条对象,对齐 server 归一化;空数组非法,TCB 非空约束)
 *   G1: JSON 格式合法性
 *   G2: 元指令类型(6 种)+ params 完备性(set: attr/operation/value; branch: domain/on_true;
 *       io_request: io_type; collect: from/each; merge: messages/next_instruction + tool_result[s]; push: instructions)
 *   G3: io_request 双路径模式(裸 io_request → warning;建议包在 exists(__io_results__…) 分支内,参考 core_eval 桥接剧本)
 *   G4: 域类型合法性(7 种)+ 每域必填字段 + inner 嵌套(出现 domain/domains 键即 error,P0-03)
 *   G5: path 语法(正则对齐 _shared $defs/path)+ 单数 __io_result__ 拒绝 + path_or_literal(__ 前缀字符串必须合法路径)
 *   G6: 兜底规则建议(末条非 branch+all(inner:[]) → warning;无匹配→Error fact 是引擎既定显式行为,非 schema 违规)
 *   G7: 递归深度限制(≤ 64 层,对齐 MAX_BRANCH_DEPTH)
 *
 * 同步策略(E 族同步链 tcb→_shared→console→console-cloud 的 cloud 端落点):
 *   _shared/v1.0.json 变更时本文件必须同步;本层不可能是权威,server 校验失败明细照透(不静默)。
 */

export interface ValidationIssue {
  gate: string;
  message: string;
  path?: string;
}

export type ValidationError = ValidationIssue;
export type ValidationWarning = ValidationIssue;

export interface ValidationResult {
  /** true = 无 error(warning 不影响);旧消费方仅依赖此字段与 errors */
  valid: boolean;
  errors: ValidationError[];
  /** W2.1 新增:合法但建议修复项(G3 双路径 / G6 兜底),不阻断 */
  warnings: ValidationWarning[];
}

// 6 元指令(权威源 evorule-tcb/src/executor.rs dispatch;_shared L166)
const VALID_META_INSTRUCTIONS = ['set', 'push', 'branch', 'io_request', 'collect', 'merge'];
// 7 基础域类型(权威源 evorule-tcb/src/domain.rs;_shared L30,派生域不在枚举内)
const VALID_DOMAIN_TYPES = ['eq', 'lt', 'exists', 'instruction', 'all', 'not', 'has_fields'];
// set 元指令 operation 枚举(_shared L181)
const VALID_SET_OPERATIONS = ['set', 'add', 'sub'];
const MAX_RECURSION_DEPTH = 64;

// path 正则,逐字符对齐 _shared/v1.0.json $defs/path pattern(L9,权威源 evorule-tcb/src/path.rs):
// identifier=[A-Za-z0-9_$\-\\](含 $,兼容 __exec__.payload.$schema 迁移写法),index=[0-9]+,
// 拒绝空段/缺闭合括号/空索引/非数字索引/索引后非法拼接。单数 __io_result__ 拒绝见 isValidPath(P1-03)。
const PATH_REGEX =
  /^(?:[A-Za-z0-9_$\-\\]+(?:\[[0-9]+\])?)(?:(?:\.(?:[A-Za-z0-9_$\-\\]+(?:\[[0-9]+\])?))|(?:\.\[[0-9]+\]))*$/;

/** path 校验:正则 + 单数 __io_result__ 拒绝(I/O 结果强制复数 __io_results__,P1-03) */
function isValidPath(p: unknown): boolean {
  return typeof p === 'string' && PATH_REGEX.test(p) && !p.includes('__io_result__');
}

/** path_or_literal(对齐 _shared $defs/path_or_literal,与引擎 resolve_path_or_literal 语义一致):
 *  非字符串或非 __ 前缀字符串按字面量放行;__ 前缀字符串必须解析为合法路径(含复数强制) */
function checkPathOrLiteral(v: unknown): boolean {
  if (typeof v !== 'string') return true;
  if (!v.startsWith('__')) return true;
  return isValidPath(v);
}

/** 输入归一化(对齐 server validate_rules_handler 口径):
 *  {transform:[...]} → transform 数组;顶层数组 → 该数组;单条 {type:...} 对象 → 包装为数组 */
function extractTransforms(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.transform)) return obj.transform;
    if (typeof obj.type === 'string') return [parsed];
  }
  return null;
}

/** 兜底规则判定:末条 branch + all(inner:[]) 空域 */
function isFallbackRule(rule: unknown): boolean {
  if (!rule || typeof rule !== 'object') return false;
  const r = rule as Record<string, unknown>;
  if (r.type !== 'branch' || !r.params || typeof r.params !== 'object') return false;
  const domain = (r.params as Record<string, unknown>).domain;
  if (!domain || typeof domain !== 'object') return false;
  const d = domain as Record<string, unknown>;
  return d.type === 'all' && Array.isArray(d.inner) && (d.inner as unknown[]).length === 0;
}

/** io_request 结果检查分支判定(G3 双路径模式检测:exists __exec__.payload.__io_results__.<io_type>) */
function isIoResultCheckDomain(domain: unknown): boolean {
  if (!domain || typeof domain !== 'object') return false;
  const d = domain as Record<string, unknown>;
  return d.type === 'exists' && typeof d.path === 'string' && d.path.includes('__io_results__');
}

export class RuleValidator {
  /**
   * LLM 输出/人工录入前的门禁检查(错误/警告分级)
   */
  static validate(json: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // G1: JSON 格式合法性
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      return {
        valid: false,
        errors: [{ gate: 'G1', message: `JSON 格式错误: ${(e as Error).message}` }],
        warnings: []
      };
    }

    // G0: transform 结构(对齐 server 归一化;空数组与 TCB 非空约束一致)
    const transforms = extractTransforms(parsed);
    if (transforms === null) {
      errors.push({
        gate: 'G0',
        message: '无法识别规则结构:既不是 {transform:[...]} 文档、transform 数组,也不是单条 {type:...} 指令'
      });
      return { valid: false, errors, warnings };
    }
    if (transforms.length === 0) {
      errors.push({
        gate: 'G0',
        message: 'transform 数组为空(与 TCB 非空约束一致,至少需要一条规则)'
      });
      return { valid: false, errors, warnings };
    }

    transforms.forEach((rule, i) => {
      this.checkRule(rule, `transform[${i}]`, false, 0, errors, warnings);
    });

    // G6: 兜底规则建议(warning 级——无匹配→Error fact 是引擎既定显式行为,非 schema 违规)
    if (!isFallbackRule(transforms[transforms.length - 1])) {
      warnings.push({
        gate: 'G6',
        message:
          '末条规则不是 branch + all(inner:[]) 兜底——未匹配指令将产生 Error fact(引擎既定显式行为);建议添加兜底规则给出未匹配时的明确归宿',
        path: `transform[${transforms.length - 1}]`
      });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * 单条 transform 规则检查(G2 类型+params 完备性 / G3 双路径 / G5 path / G7 深度)
   * inIoBranch: 当前是否已处于 exists(__io_results__…) 检查分支内(双路径模式)
   */
  private static checkRule(
    rule: unknown,
    path: string,
    inIoBranch: boolean,
    depth: number,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    // G7: 递归深度
    if (depth > MAX_RECURSION_DEPTH) {
      errors.push({
        gate: 'G7',
        message: `递归深度超过 ${MAX_RECURSION_DEPTH} 层(对齐 MAX_BRANCH_DEPTH 终止性保证)`,
        path
      });
      return;
    }

    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      errors.push({ gate: 'G2', message: `规则必须是 JSON 对象,路径: ${path}`, path });
      return;
    }
    const r = rule as Record<string, unknown>;
    const params = (r.params ?? null) as Record<string, unknown> | null;

    // G2: 元指令类型
    const type = r.type;
    if (typeof type !== 'string' || !VALID_META_INSTRUCTIONS.includes(type)) {
      errors.push({
        gate: 'G2',
        message: `无效的元指令类型: ${String(type)},必须是 ${VALID_META_INSTRUCTIONS.join(' / ')} 之一(权威源 tcb executor dispatch)`,
        path
      });
      return;
    }
    if (!params || typeof params !== 'object') {
      errors.push({ gate: 'G2', message: `缺少 params 对象(transform_rule 必填)`, path });
      return;
    }

    switch (type) {
      case 'set': {
        // set: attr(path)/operation(set|add|sub)/value(path_or_literal) 全必填(_shared L173-187)
        if (!isValidPath(params.attr)) {
          errors.push({
            gate: 'G5',
            message: `set.attr 必须是合法路径(当前: ${String(params.attr)};拒绝空段/非法索引/单数 __io_result__)`,
            path: `${path}.params.attr`
          });
        }
        if (typeof params.operation !== 'string' || !VALID_SET_OPERATIONS.includes(params.operation)) {
          errors.push({
            gate: 'G2',
            message: `set.operation 必须是 ${VALID_SET_OPERATIONS.join(' / ')} 之一(当前: ${String(params.operation)})`,
            path: `${path}.params.operation`
          });
        }
        if (!('value' in params)) {
          errors.push({
            gate: 'G2',
            message: 'set.value 必填(引擎 exec_set 对缺失 value 报 MissingField)',
            path: `${path}.params.value`
          });
        } else if (!checkPathOrLiteral(params.value)) {
          errors.push({
            gate: 'G5',
            message: `set.value 为 __ 前缀字符串时必须是合法路径(当前: ${String(params.value)})`,
            path: `${path}.params.value`
          });
        }
        break;
      }
      case 'push': {
        // push: instructions 必填(指令数组或 __ 路径引用,_shared L189-208)
        const ins = params.instructions;
        if (ins === undefined) {
          errors.push({
            gate: 'G2',
            message: 'push.instructions 必填(指令数组或 __ 路径引用)',
            path: `${path}.params.instructions`
          });
        } else if (typeof ins === 'string') {
          if (!ins.startsWith('__') || !isValidPath(ins)) {
            errors.push({
              gate: 'G5',
              message: `push.instructions 为字符串时必须是合法 __ 路径引用(当前: ${ins})`,
              path: `${path}.params.instructions`
            });
          }
        } else if (Array.isArray(ins)) {
          ins.forEach((item, i) => this.checkInstructionLayer(item, `${path}.params.instructions[${i}]`, errors));
        } else {
          errors.push({
            gate: 'G2',
            message: 'push.instructions 必须是数组或 __ 路径引用字符串',
            path: `${path}.params.instructions`
          });
        }
        break;
      }
      case 'branch': {
        // branch: domain/on_true 必填(_shared L209-225);子规则递归
        this.checkDomain(params.domain, `${path}.params.domain`, 0, errors);
        if (!Array.isArray(params.on_true)) {
          errors.push({
            gate: 'G2',
            message: 'branch.on_true 必填且必须是数组',
            path: `${path}.params.on_true`
          });
        } else {
          // 双路径模式传播:io 结果检查分支的 on_true/on_false 子规则均视为已在模式内
          const childInIo = inIoBranch || isIoResultCheckDomain(params.domain);
          params.on_true.forEach((sub, i) =>
            this.checkRule(sub, `${path}.params.on_true[${i}]`, childInIo, depth + 1, errors, warnings)
          );
        }
        if (params.on_false !== undefined && !Array.isArray(params.on_false)) {
          errors.push({
            gate: 'G2',
            message: 'branch.on_false 若提供必须是数组',
            path: `${path}.params.on_false`
          });
        } else if (Array.isArray(params.on_false)) {
          const childInIo = inIoBranch || isIoResultCheckDomain(params.domain);
          params.on_false.forEach((sub, i) =>
            this.checkRule(sub, `${path}.params.on_false[${i}]`, childInIo, depth + 1, errors, warnings)
          );
        }
        break;
      }
      case 'io_request': {
        // io_request: io_type 必填(_shared L226-241);其余参数值经 path_or_literal
        if (typeof params.io_type !== 'string' || params.io_type.length === 0) {
          errors.push({
            gate: 'G2',
            message: 'io_request.io_type 必填(I/O 结果按 io_type 隔离写入 __io_results__.<io_type>)',
            path: `${path}.params.io_type`
          });
        }
        for (const [k, v] of Object.entries(params)) {
          if (k === 'io_type') continue;
          if (!checkPathOrLiteral(v)) {
            errors.push({
              gate: 'G5',
              message: `io_request 参数 ${k} 为 __ 前缀字符串时必须是合法路径(当前: ${String(v)})`,
              path: `${path}.params.${k}`
            });
          }
        }
        // G3: 双路径模式建议(warning 级——schema 不强制,core_eval 桥接剧本模式)
        if (!inIoBranch) {
          warnings.push({
            gate: 'G3',
            message:
              'io_request 未包裹在 exists(__exec__.payload.__io_results__.<io_type>) 双路径分支内——建议双路径模式:已有结果走读取分支,无结果才发起请求(参考 core_eval 桥接剧本,避免重复发起)',
            path
          });
        }
        break;
      }
      case 'collect': {
        // collect: from(path)/each(指令模板)必填(_shared L242-258)
        if (!isValidPath(params.from)) {
          errors.push({
            gate: 'G5',
            message: `collect.from 必须是合法路径(当前: ${String(params.from)})`,
            path: `${path}.params.from`
          });
        }
        if (!params.each || typeof params.each !== 'object') {
          errors.push({
            gate: 'G2',
            message: 'collect.each 必填(指令模板对象,支持 {{placeholder}} 插值)',
            path: `${path}.params.each`
          });
        }
        break;
      }
      case 'merge': {
        // merge: messages(path)/next_instruction 必填 + tool_result/tool_results 二选一(_shared L259-280)
        if (!isValidPath(params.messages)) {
          errors.push({
            gate: 'G5',
            message: `merge.messages 必须是合法路径(当前: ${String(params.messages)})`,
            path: `${path}.params.messages`
          });
        }
        const hasToolResult = isValidPath(params.tool_result);
        const hasToolResults = isValidPath(params.tool_results);
        if (!('tool_result' in params) && !('tool_results' in params)) {
          errors.push({
            gate: 'G2',
            message: 'merge 必须提供 tool_result 或 tool_results 之一(引擎两者皆无报 MissingField)',
            path: `${path}.params`
          });
        } else if ('tool_result' in params && !hasToolResult) {
          errors.push({
            gate: 'G5',
            message: `merge.tool_result 必须是合法路径(当前: ${String(params.tool_result)})`,
            path: `${path}.params.tool_result`
          });
        } else if ('tool_results' in params && !hasToolResults) {
          errors.push({
            gate: 'G5',
            message: `merge.tool_results 必须是合法路径(当前: ${String(params.tool_results)})`,
            path: `${path}.params.tool_results`
          });
        }
        if (!params.next_instruction || typeof params.next_instruction !== 'object') {
          errors.push({
            gate: 'G2',
            message: 'merge.next_instruction 必填(下一条指令模板,支持 {{messages}}/{{tools}} 插值)',
            path: `${path}.params.next_instruction`
          });
        }
        break;
      }
    }
  }

  /**
   * 指令层对象检查(push.instructions 项;结构宽松:type 任意字符串 + params 对象,
   * 指令层类型不等于元指令层——_shared $defs/instruction L70-159)
   */
  private static checkInstructionLayer(item: unknown, path: string, errors: ValidationError[]): void {
    if (typeof item === 'string') {
      // __ 路径引用动态指令(如 __exec__.instruction.params.then)
      if (item.startsWith('__') && !isValidPath(item)) {
        errors.push({
          gate: 'G5',
          message: `指令层字符串引用必须是合法 __ 路径(当前: ${item})`,
          path
        });
      }
      return;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push({ gate: 'G2', message: `指令必须是对象或 __ 路径引用,路径: ${path}`, path });
      return;
    }
    const instr = item as Record<string, unknown>;
    if (typeof instr.type !== 'string' || instr.type.length === 0) {
      errors.push({ gate: 'G2', message: `指令缺少 type 字段,路径: ${path}`, path });
    }
  }

  /**
   * 域检查(G4 域类型+必填字段+inner 嵌套 / G5 path / G7 深度)
   * 域形态(_shared $defs/domain L18-69):__ 路径引用字符串(动态域) 或 {type,...} 对象
   */
  private static checkDomain(
    domain: unknown,
    path: string,
    depth: number,
    errors: ValidationError[]
  ): void {
    if (depth > MAX_RECURSION_DEPTH) {
      errors.push({
        gate: 'G7',
        message: `域嵌套深度超过 ${MAX_RECURSION_DEPTH} 层(对齐 MAX_DOMAIN_DEPTH)`,
        path
      });
      return;
    }

    // 动态域:__ 路径引用
    if (typeof domain === 'string') {
      if (!domain.startsWith('__')) {
        errors.push({
          gate: 'G4',
          message: `动态域必须是 __ 前缀路径引用(当前: ${domain};非 __ 字符串会被当字面量并在运行时报 MissingField)`,
          path
        });
      } else if (!isValidPath(domain)) {
        errors.push({
          gate: 'G5',
          message: `动态域路径引用语法非法(当前: ${domain})`,
          path
        });
      }
      return;
    }

    if (!domain || typeof domain !== 'object' || Array.isArray(domain)) {
      errors.push({
        gate: 'G4',
        message: '域必须是 {type:...} 对象或 __ 路径引用字符串',
        path
      });
      return;
    }
    const d = domain as Record<string, unknown>;

    // G4: 域类型(7 种)
    if (typeof d.type !== 'string' || !VALID_DOMAIN_TYPES.includes(d.type)) {
      errors.push({
        gate: 'G4',
        message: `无效的域类型: ${String(d.type)},必须是 ${VALID_DOMAIN_TYPES.join(' / ')} 之一(权威源 tcb domain.rs;派生域由 all/not/lt/eq 组合表达)`,
        path
      });
      return;
    }

    // P0-03: 嵌套一律用 inner,禁止 domain/domains 字段
    if ('domains' in d || 'domain' in d) {
      errors.push({
        gate: 'G4',
        message: `域嵌套禁止使用 ${'domains' in d ? 'domains' : 'domain'} 字段——一律用 inner(P0-03 口径,_shared L31)`,
        path
      });
    }

    switch (d.type) {
      case 'eq':
      case 'lt': {
        if (!isValidPath(d.path)) {
          errors.push({
            gate: 'G5',
            message: `${d.type}.path 必填且必须是合法路径(当前: ${String(d.path)})`,
            path: `${path}.path`
          });
        }
        if (!('value' in d)) {
          errors.push({
            gate: 'G4',
            message: `${d.type} 域必须提供 value(比较值)`,
            path: `${path}.value`
          });
        } else if (!checkPathOrLiteral(d.value)) {
          errors.push({
            gate: 'G5',
            message: `${d.type}.value 为 __ 前缀字符串时必须是合法路径(当前: ${String(d.value)})`,
            path: `${path}.value`
          });
        }
        break;
      }
      case 'exists': {
        if (!isValidPath(d.path)) {
          errors.push({
            gate: 'G5',
            message: `exists.path 必填且必须是合法路径(当前: ${String(d.path)})`,
            path: `${path}.path`
          });
        }
        break;
      }
      case 'instruction': {
        if (typeof d.instruction_type !== 'string' || d.instruction_type.length === 0) {
          errors.push({
            gate: 'G4',
            message: 'instruction 域必须提供 instruction_type(谓词分支匹配的业务指令类型)',
            path: `${path}.instruction_type`
          });
        }
        break;
      }
      case 'has_fields': {
        if (!isValidPath(d.path)) {
          errors.push({
            gate: 'G5',
            message: `has_fields.path 必填且必须是合法路径(当前: ${String(d.path)})`,
            path: `${path}.path`
          });
        }
        if (
          !Array.isArray(d.fields) ||
          (d.fields as unknown[]).length === 0 ||
          !(d.fields as unknown[]).every((f) => typeof f === 'string')
        ) {
          errors.push({
            gate: 'G4',
            message: 'has_fields.fields 必填:非空字符串数组(检查路径下必须存在的字段)',
            path: `${path}.fields`
          });
        }
        break;
      }
      case 'all':
      case 'not': {
        if (!Array.isArray(d.inner)) {
          errors.push({
            gate: 'G4',
            message: `${d.type} 域必须提供 inner 数组(嵌套一律用 inner,P0-03)`,
            path: `${path}.inner`
          });
        } else {
          (d.inner as unknown[]).forEach((sub, i) =>
            this.checkDomain(sub, `${path}.inner[${i}]`, depth + 1, errors)
          );
        }
        break;
      }
    }
  }
}
