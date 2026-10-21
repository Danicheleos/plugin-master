import { EvalBaselinePinSchema } from './evals.js';
import { CreateSpaceSchema, SpaceConfigSchema } from './rest.js';

describe('CreateSpaceSchema', () => {
  it('defaults description and accepts kebab-case names', () => {
    expect(
      CreateSpaceSchema.parse({ path: '/a', name: 'my-plugin' }).description,
    ).toBe('');
  });

  it('rejects non kebab-case names', () => {
    expect(
      CreateSpaceSchema.safeParse({ path: '/a', name: 'My Plugin' }).success,
    ).toBe(false);
  });
});

describe('eval baseline pins', () => {
  it('defaults evalBaselines to empty and keeps a case -> run id map', () => {
    expect(SpaceConfigSchema.parse({ masterContext: [] }).evalBaselines).toEqual({});
    expect(SpaceConfigSchema.parse({ masterContext: [], evalBaselines: { a: 'r1' } }).evalBaselines).toEqual({ a: 'r1' });
  });

  it('accepts a run id or null (unpin) and rejects an empty case', () => {
    expect(EvalBaselinePinSchema.safeParse({ case: 'a', runId: 'r' }).success).toBe(true);
    expect(EvalBaselinePinSchema.safeParse({ case: 'a', runId: null }).success).toBe(true);
    expect(EvalBaselinePinSchema.safeParse({ case: '', runId: 'r' }).success).toBe(false);
  });
});
