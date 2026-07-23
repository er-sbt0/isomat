/**
 * import-boundary.test.ts — the Stabilize fence (final S4 form).
 *
 * This is the regression guard that keeps the win the Stabilize milestone buys:
 * the main-path packages (the substrate the product actually ships) must not
 * couple back to the quarantined playback machinery or the shed discipline
 * libraries.
 *
 * The main path is `core → substrate → { sandbox, objects } → workspace`. The
 * quarantine is `@isomat/cell` (the timeline player, the lesson authoring verbs
 * and morph, the prose manifest, the playback-only views). Invariants:
 *
 *   1. No main-path source file imports `@isomat/cell`. `cell/` is off the DAG;
 *      a fold, a native object, or the sandbox must never reach into it.
 *
 *   2. No main-path source (other than `core`, which owns `timeline.ts` and
 *      consumes it internally) imports a playback module — `timeline`, `player`,
 *      `lesson`, `morph`, `manifest`, `segments`, `animate`, `supersede`,
 *      `pacing`, `events`. This keeps `core/timeline.ts` unreachable from the
 *      workspace-facing path (§8 risk 8): a future `fold` feature cannot quietly
 *      re-couple to the demoted timeline.
 *
 *   3. No source ANYWHERE — not even the quarantine — imports a shed discipline
 *      (automata / graph / probability / calculus / linalg / field / structure /
 *      interaction). There is nothing left to import; a re-introduction fails
 *      here rather than quietly re-growing the deleted surface.
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

/** The quarantine package — off the main-path DAG. */
const QUARANTINE = ['cell'];

/** Playback module basenames the workspace-facing path must never reach for. */
const PLAYBACK = [
  'timeline',
  'player',
  'lesson',
  'morph',
  'manifest',
  'segments',
  'animate',
  'supersede',
  'pacing',
  'events',
];

/** The whole package set — the main path plus the quarantine. */
const ALL_PACKAGES = ['core', 'substrate', 'sandbox', 'objects', 'workspace', 'cell'];
/** The main path: everything the product ships. `cell` is NOT here. */
const MAIN_PATH = ['core', 'substrate', 'sandbox', 'objects', 'workspace'];
/** The workspace-facing path: the main path minus `core` (which owns timeline). */
const WORKSPACE_FACING = ['substrate', 'sandbox', 'objects', 'workspace'];

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
  it('no main-path source imports the @isomat/cell quarantine', () => {
    const all = MAIN_PATH.flatMap((pkg) => offences(`packages/${pkg}/src`, QUARANTINE));
    expect(all).toEqual([]);
  });

  it('no workspace-facing source imports a playback module (core/timeline.ts stays unreachable — §8 risk 8)', () => {
    const all = WORKSPACE_FACING.flatMap((pkg) => offences(`packages/${pkg}/src`, PLAYBACK));
    expect(all).toEqual([]);
  });

  it('NO package source imports any shed discipline (automata / graph / probability / calculus / linalg / field / structure / interaction)', () => {
    const all = ALL_PACKAGES.flatMap((pkg) => offences(`packages/${pkg}/src`, DISCIPLINES));
    expect(all).toEqual([]);
  });
});
