/**
 * ast.ts — walk a mathjs AST into isomat's own artifacts (roadmap M3).
 *
 * Three projections of one parsed expression, none of them symbolic:
 *
 *  - `toTex` — the display string, generated term by term.
 *  - `toFragments` — the ADDRESSABLE span tree: top-level additive terms become
 *    role-named fragments (`term0`, `term1`, …), the same `{ tex, role? }` shape
 *    `@isomat/objects`' `formula.ts` produces, so a later `edit-span` (M4) can
 *    address a term by role.
 *  - `toJs` — the numeric sampler body, emitted as SANDBOX JavaScript: the
 *    independent variable stays a bare local, bound free variables read a live
 *    handle's `.value`, `^` becomes `Math.pow`, and unknown functions are
 *    REJECTED. This is where "numeric eval" happens — in QuickJS, deterministic
 *    and lint-gated — never in a host-side CAS.
 *
 * The walk is total over the arithmetic grammar (constants, symbols, + − × ÷,
 * ^, unary minus, parentheses, a small whitelist of numeric functions) and
 * throws on anything outside it — which is itself the no-CAS line, enforced at
 * parse time rather than trusted.
 */

import type { FormulaFragment } from '@isomat/objects';
import type {
  ConstantNode,
  FunctionNode,
  MathNode,
  OperatorNode,
  ParenthesisNode,
  SymbolNode,
} from './mathjs.js';

/** Numeric functions the sampler may call, name → (JS, TeX-open, TeX-close). */
const FUNCTIONS: Record<string, { js: string; texOpen: string; texClose: string }> = {
  sin: { js: 'Math.sin', texOpen: '\\sin\\left(', texClose: '\\right)' },
  cos: { js: 'Math.cos', texOpen: '\\cos\\left(', texClose: '\\right)' },
  tan: { js: 'Math.tan', texOpen: '\\tan\\left(', texClose: '\\right)' },
  exp: { js: 'Math.exp', texOpen: 'e^{', texClose: '}' },
  log: { js: 'Math.log', texOpen: '\\ln\\left(', texClose: '\\right)' },
  sqrt: { js: 'Math.sqrt', texOpen: '\\sqrt{', texClose: '}' },
  abs: { js: 'Math.abs', texOpen: '\\left|', texClose: '\\right|' },
};

/** Operator precedence, so TeX wraps a lower-precedence child in parentheses. */
function precedence(node: MathNode): number {
  if (node.type === 'OperatorNode') {
    const op = (node as OperatorNode).op;
    if ((node as OperatorNode).fn === 'unaryMinus') return 35;
    if (op === '^') return 40;
    if (op === '*' || op === '/') return 30;
    return 20; // + -
  }
  return 100; // atoms
}

function isNode(x: unknown): x is MathNode {
  return typeof x === 'object' && x !== null && typeof (x as MathNode).type === 'string';
}

// ─────────────────────────────── free variables ───────────────────────────────

/** Every variable symbol in the expression (function names excluded). */
export function freeVars(node: MathNode): Set<string> {
  const vars = new Set<string>();
  const walk = (n: MathNode): void => {
    switch (n.type) {
      case 'SymbolNode':
        vars.add((n as SymbolNode).name);
        break;
      case 'ConstantNode':
        break;
      case 'ParenthesisNode':
        walk((n as ParenthesisNode).content);
        break;
      case 'FunctionNode':
        // the function NAME is not a variable — recurse only into arguments
        for (const a of (n as FunctionNode).args) walk(a);
        break;
      case 'OperatorNode':
        for (const a of (n as OperatorNode).args) walk(a);
        break;
      default:
        throw new Error(unsupported(n));
    }
  };
  walk(node);
  return vars;
}

// ─────────────────────────────── TeX ───────────────────────────────

function texChild(child: MathNode, parentPrec: number): string {
  const inner = toTex(child);
  return precedence(child) < parentPrec ? `\\left(${inner}\\right)` : inner;
}

/** The display TeX, generated from the AST term by term. */
export function toTex(node: MathNode): string {
  switch (node.type) {
    case 'ConstantNode':
      return String((node as ConstantNode).value);
    case 'SymbolNode':
      return (node as SymbolNode).name;
    case 'ParenthesisNode':
      return `\\left(${toTex((node as ParenthesisNode).content)}\\right)`;
    case 'FunctionNode': {
      const fn = FUNCTIONS[(node as FunctionNode).fn.name];
      if (!fn) throw new Error(unsupported(node));
      const args = (node as FunctionNode).args.map(toTex).join(', ');
      return `${fn.texOpen}${args}${fn.texClose}`;
    }
    case 'OperatorNode': {
      const o = node as OperatorNode;
      if (o.fn === 'unaryMinus') return `-${texChild(o.args[0]!, 35)}`;
      const [l, r] = [o.args[0]!, o.args[1]!];
      switch (o.op) {
        case '+':
          return `${texChild(l, 20)} + ${texChild(r, 20)}`;
        case '-':
          return `${texChild(l, 20)} - ${texChild(r, 20)}`;
        case '*':
          return `${texChild(l, 30)} ${o.implicit ? '' : '\\cdot '}${texChild(r, 30)}`.replace('  ', ' ');
        case '/':
          return `\\frac{${toTex(l)}}{${toTex(r)}}`;
        case '^':
          return `${texChild(l, 41)}^{${toTex(r)}}`;
        default:
          throw new Error(unsupported(node));
      }
    }
    default:
      throw new Error(unsupported(node));
  }
}

// ─────────────────────────── addressable fragments ───────────────────────────

/** Flatten a left-nested chain of `+`/`-` into signed top-level terms. */
function additiveTerms(node: MathNode): ReadonlyArray<{ sign: '+' | '-'; term: MathNode }> {
  if (node.type === 'OperatorNode') {
    const o = node as OperatorNode;
    if (o.fn !== 'unaryMinus' && (o.op === '+' || o.op === '-')) {
      return [...additiveTerms(o.args[0]!), { sign: o.op, term: o.args[1]! }];
    }
  }
  return [{ sign: '+', term: node }];
}

/**
 * The addressable span tree: each top-level additive term is a role-named
 * fragment, the operators between them plain glue — the `{ tex, role? }` shape
 * `formula.ts` renders and M4's `edit-span` will address.
 */
export function toFragments(node: MathNode): FormulaFragment[] {
  const terms = additiveTerms(node);
  const fragments: FormulaFragment[] = [];
  terms.forEach((t, i) => {
    if (i === 0) {
      if (t.sign === '-') fragments.push(Object.freeze({ tex: '-' }));
    } else {
      fragments.push(Object.freeze({ tex: ` ${t.sign} ` }));
    }
    fragments.push(Object.freeze({ tex: toTex(t.term), role: `term${i}` }));
  });
  return fragments;
}

// ─────────────────────────────── JS emission ───────────────────────────────

/**
 * The sampler body as sandbox JS. `indepVar` stays a bare local (the plot's x);
 * every other variable must be in `bindings` (name → a JS reference to a live
 * handle, e.g. `v0.value`) — an unbound one is an error, because the engine
 * cannot sample against a variable nothing supplies.
 */
export function toJs(node: MathNode, indepVar: string, bindings: ReadonlyMap<string, string>): string {
  const walk = (n: MathNode): string => {
    switch (n.type) {
      case 'ConstantNode':
        return String((n as ConstantNode).value);
      case 'SymbolNode': {
        const name = (n as SymbolNode).name;
        if (name === indepVar) return name;
        const ref = bindings.get(name);
        if (ref === undefined) {
          throw new Error(
            `"${name}" is a free variable with no binding. Bind it to a scene object, or use ` +
              `"${indepVar}" as the plotted variable.`,
          );
        }
        return ref;
      }
      case 'ParenthesisNode':
        return `(${walk((n as ParenthesisNode).content)})`;
      case 'FunctionNode': {
        const fn = FUNCTIONS[(n as FunctionNode).fn.name];
        if (!fn) throw new Error(unsupported(n));
        return `${fn.js}(${(n as FunctionNode).args.map(walk).join(', ')})`;
      }
      case 'OperatorNode': {
        const o = n as OperatorNode;
        if (o.fn === 'unaryMinus') return `(-${walk(o.args[0]!)})`;
        const [l, r] = [walk(o.args[0]!), walk(o.args[1]!)];
        switch (o.op) {
          case '+':
            return `(${l} + ${r})`;
          case '-':
            return `(${l} - ${r})`;
          case '*':
            return `(${l} * ${r})`;
          case '/':
            return `(${l} / ${r})`;
          case '^':
            return `Math.pow(${l}, ${r})`;
          default:
            throw new Error(unsupported(n));
        }
      }
      default:
        throw new Error(unsupported(n));
    }
  };
  return walk(node);
}

function unsupported(node: MathNode): string {
  const name = node.type === 'FunctionNode' ? ` "${(node as FunctionNode).fn.name}"` : '';
  return (
    `parse: ${node.type}${name} is outside isomat's arithmetic grammar. Supported: numbers, ` +
    `variables, + − × ÷, ^, unary minus, parentheses, and sin/cos/tan/exp/log/sqrt/abs. ` +
    `Anything symbolic (a CAS operation) is deliberately not available.`
  );
}

export { isNode };
