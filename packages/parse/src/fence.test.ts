/**
 * fence.test.ts — the no-CAS boundary (roadmap M3 exit, decision #3).
 *
 * mathjs is a full CAS; isomat uses exactly one thing from it — `parse`. This
 * test is the wall: it fails the build if any `parse` source imports `mathjs`
 * outside the single `mathjs.ts` wrapper, if that wrapper's RUNTIME import brings
 * in more than `parse`, or if any CAS operation name appears in a mathjs import
 * anywhere. "No symbolic call escapes the wrapper" is asserted, not trusted — the
 * mitigation the roadmap names for M3's one real risk (parser scope-creep toward
 * a CAS).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));

/** The single file allowed to touch mathjs. */
const WRAPPER = 'mathjs.ts';

/** CAS operations that must never be imported from mathjs — the symbolic surface. */
const SYMBOLIC = [
  'simplify',
  'derivative',
  'rationalize',
  'resolve',
  'evaluate',
  'compile',
  'simplifyConstant',
  'simplifyCore',
  'symbolicEqual',
  'leafCount',
];

/** Shipped source only — the fence guards the package surface, not its tests. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** The clauses `import … from 'mathjs'` in a file, with whether each is `type`. */
function mathjsImports(text: string): Array<{ isType: boolean; names: string[] }> {
  const re = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]mathjs['"]/g;
  const out: Array<{ isType: boolean; names: string[] }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const names = m[2]!
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0]!.trim())
      .filter(Boolean);
    out.push({ isType: m[1] !== undefined, names });
  }
  return out;
}

describe('the no-CAS fence — only `parse` escapes mathjs', () => {
  const files = sourceFiles(SRC);

  it('nothing but the wrapper imports mathjs', () => {
    const offenders = files
      .filter((f) => /from\s+['"]mathjs['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC.length + 1))
      .filter((rel) => rel !== WRAPPER);
    expect(offenders).toEqual([]);
  });

  it("the wrapper's RUNTIME import is exactly { parse }", () => {
    const text = readFileSync(join(SRC, WRAPPER), 'utf8');
    const runtime = mathjsImports(text).filter((i) => !i.isType);
    expect(runtime).toHaveLength(1);
    expect(runtime[0]!.names).toEqual(['parse']);
  });

  it('no symbolic (CAS) operation is imported from mathjs anywhere', () => {
    const leaked: string[] = [];
    for (const f of files) {
      for (const imp of mathjsImports(readFileSync(f, 'utf8'))) {
        for (const name of imp.names) {
          if (SYMBOLIC.includes(name)) leaked.push(`${f.slice(SRC.length + 1)}: ${name}`);
        }
      }
    }
    expect(leaked).toEqual([]);
  });
});
