/**
 * import-boundary.test.ts — the Stabilize fence.
 *
 * This is the regression guard that keeps the win the Stabilize milestone buys:
 * the main-path packages (the substrate the product actually ships) must not
 * couple back to the demoted playback machinery or the discipline libraries.
 *
 * It is written in its final intended SHAPE but scoped to what is already true
 * today, so it PASSES now and tightens as later stages land. Two invariants:
 *
 *   1. No `workspace` source file imports the lesson / timeline / player modules
 *      (the playback vocabulary being quarantined). `workspace` is the top of
 *      the main path; if it stays clean, a fold can never re-couple to the
 *      demoted timeline (risk 8) or the lesson verbs.
 *
 *   2. No `core`- or `sandbox`-path (`host`) source file imports a discipline
 *      library (automata / graph / probability / calculus / linalg / field /
 *      structure). This is the "host stands on core alone" invariant from §3;
 *      it is true today and must stay true.
 *
 * Later stages EXTEND this (add `objects`/`sandbox` after the renames, forbid
 * main-path → `cell/` imports); they do not rewrite it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/workspace/src → repo root
const ROOT = resolve(HERE, '../../..');

/** Discipline module basenames that shed in Stabilize (§1.1, §2.3). */
const DISCIPLINES = [
  'automata',
  'graph',
  'probability',
  'calculus',
  'linalg',
  'field',
  'structure',
  'interaction',
];

/** Every package's `src` tree — the whole main path plus the quarantine. */
const PACKAGES = ['core', 'lesson', 'render', 'library', 'host', 'workspace', 'substrate'];

/** Playback modules the main path must never reach for. */
const PLAYBACK = ['lesson', 'timeline', 'player'];

function sourceFiles(pkgSrc: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith('.ts')) continue;
      if (name.endsWith('.test.ts')) continue;
      if (name.endsWith('.d.ts')) continue;
      out.push(full);
    }
  };
  walk(pkgSrc);
  return out;
}

/** Every module specifier this file imports/exports from. */
function importSpecifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specs: string[] = [];
  const re = /(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) specs.push(m[1]!);
  // bare `import '...'` side-effect imports
  const bare = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  while ((m = bare.exec(text)) !== null) specs.push(m[1]!);
  return specs;
}

/** Does a module specifier reference one of the forbidden module names? */
function references(spec: string, forbidden: readonly string[]): boolean {
  const segments = spec.split('/').map((s) => s.replace(/\.(ts|js|mjs|cjs)$/, ''));
  return segments.some((seg) => forbidden.includes(seg));
}

function offences(pkgRelDir: string, forbidden: readonly string[]): string[] {
  const problems: string[] = [];
  for (const file of sourceFiles(join(ROOT, pkgRelDir))) {
    for (const spec of importSpecifiers(file)) {
      if (references(spec, forbidden)) {
        problems.push(`${file.slice(ROOT.length + 1)} imports "${spec}"`);
      }
    }
  }
  return problems;
}

describe('import boundary — the Stabilize fence', () => {
  it('workspace source imports no lesson / timeline / player module', () => {
    expect(offences('packages/workspace/src', PLAYBACK)).toEqual([]);
  });

  it('core source imports no discipline library', () => {
    expect(offences('packages/core/src', DISCIPLINES)).toEqual([]);
  });

  it('host (sandbox) source imports no discipline library', () => {
    expect(offences('packages/host/src', DISCIPLINES)).toEqual([]);
  });

  // S3 extension: the disciplines were SHED (§1, §2.3). No source anywhere — not
  // even the quarantine — imports one, because there is nothing left to import.
  // This is the fence that keeps the shed shed: a future re-introduction fails
  // here rather than quietly re-growing the deleted surface.
  it('NO package source imports any shed discipline (automata / graph / probability / calculus / linalg / field / structure / interaction)', () => {
    const all = PACKAGES.flatMap((pkg) => offences(`packages/${pkg}/src`, DISCIPLINES));
    expect(all).toEqual([]);
  });
});
