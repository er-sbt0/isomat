/**
 * scope.test.ts — `isolate`, extracted from conversation.ts (the redeclaration
 * trap it exists to close).
 */

import { describe, expect, it } from 'vitest';
import { isolate } from './scope.js';

describe('isolate — the redeclaration trap', () => {
  it('wraps a bare fragment so two turns can both declare `const spin`', () => {
    expect(isolate('const spin = 1;')).toContain('(() => {');
  });

  it('leaves an already-wrapped iife alone, and is idempotent either way', () => {
    const iife = '(() => { const spin = 1; })();';
    expect(isolate(iife)).toBe(iife);
    expect(isolate(isolate('const a = 1;'))).toBe(isolate('const a = 1;'));
  });
});
