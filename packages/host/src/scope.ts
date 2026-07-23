/**
 * scope.ts — the tiny host util for making a guest fragment independently scoped.
 *
 * `QuickJSHost.run` evaluates in the guest's global scope, so two fragments that
 * both write `const spin = …` collide with a bare `SyntaxError: redeclaration of
 * 'spin'`. They do not collide in the real pipeline, because `compileProgram`
 * emits esbuild's `format: 'iife'` and every turn arrives already wrapped in its
 * own function scope. `isolate()` makes that requirement explicit rather than
 * incidental, and it is idempotent, so a fold may apply it to already-wrapped
 * output.
 *
 * The consequence is the one the design wanted anyway: a fragment cannot see an
 * earlier turn's bindings, so id-based reach-back is the ONLY way to reach back.
 *
 * This lived in `conversation.ts` originally; it is the one export of that
 * (superseded) module still on the live substrate path — `workspace/src/node.ts`
 * wraps every executed act in it — so it is extracted here to stand free of the
 * conversation-replay machinery.
 */

/**
 * Wrap a fragment in its own function scope, unless it plainly already is one.
 *
 * The check is deliberately syntactic and conservative: wrapping twice is
 * harmless, so a false negative costs nothing, while failing to wrap costs a
 * redeclaration error on the next turn that reuses a name.
 */
export function isolate(js: string): string {
  const trimmed = js.trim();
  if (/^\(\s*(\(\s*\)|function)/.test(trimmed) || trimmed.startsWith('(()=>')) return js;
  return `(() => {\n${js}\n})();`;
}
