/**
 * expr.test.ts — the parser's three projections (roadmap M3).
 *
 * Pure, no fold: text in → TeX, addressable span tree, free variables, and the
 * emitted sampler JS. The emitted JS is checked as a string here; the sibling
 * introduce.sandbox.test.ts proves it actually samples the right numbers through
 * a real QuickJS fold.
 */

import { describe, expect, it } from 'vitest';
import { parseExpr } from './expr.js';

describe('parseExpr — free variables and TeX', () => {
  it('names every variable in first-appearance order', () => {
    expect(parseExpr('x^2 + a*x').freeVars).toEqual(['x', 'a']);
  });

  it('generates display TeX from the AST', () => {
    expect(parseExpr('x^2 + a*x').tex).toBe('x^{2} + a \\cdot x');
    expect(parseExpr('a/b').tex).toBe('\\frac{a}{b}');
    expect(parseExpr('-x + 1').tex).toBe('-x + 1');
  });

  it('a function name is not a free variable', () => {
    expect(parseExpr('sin(x)').freeVars).toEqual(['x']);
  });
});

describe('parseExpr — the addressable span tree', () => {
  it('top-level additive terms become role-named fragments', () => {
    const p = parseExpr('x^2 + a*x');
    // fragments reconstruct the tex with role markers on the two terms
    expect(p.fragments).toEqual([
      { tex: 'x^{2}', role: 'term0' },
      { tex: ' + ' },
      { tex: 'a \\cdot x', role: 'term1' },
    ]);
    // and the roles address the terms — the shape M4's edit-span will edit
    expect(p.fragments.filter((f) => f.role).map((f) => f.role)).toEqual(['term0', 'term1']);
  });

  it('a single term is one addressable span', () => {
    expect(parseExpr('a*x').fragments).toEqual([{ tex: 'a \\cdot x', role: 'term0' }]);
  });
});

describe('parseExpr — the emitted sampler is sandbox JS', () => {
  it('the plotted variable stays bare; bound vars read .value; ^ is Math.pow', () => {
    const p = parseExpr('x^2 + a*x');
    const js = p.sampleBody('x', new Map([['a', 'v0.value']]));
    expect(js).toBe('(Math.pow(x, 2) + (v0.value * x))');
  });

  it('an unbound free variable is an error, not a silent global read', () => {
    const p = parseExpr('a*x');
    expect(() => p.sampleBody('x', new Map())).toThrow(/free variable/i);
  });

  it('a whitelisted function emits its Math equivalent', () => {
    expect(parseExpr('sin(x)').sampleBody('x', new Map())).toBe('Math.sin(x)');
  });
});

describe('parseExpr — the no-CAS grammar boundary', () => {
  it('rejects a non-whitelisted (would-be symbolic) function', () => {
    // `derivative` is a mathjs CAS op; as a call it must not parse to anything usable
    expect(() => parseExpr('derivative(x^2, x)').sampleBody('x', new Map())).toThrow(/not available|grammar/i);
  });

  it('empty text is rejected', () => {
    expect(() => parseExpr('   ')).toThrow(/non-empty/);
  });
});
