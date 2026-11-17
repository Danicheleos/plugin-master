import { describe, expect, it } from 'vitest';
import { EvalResultSchema } from './evals.js';

describe('EvalResultSchema', () => {
  it('accepts the nulls the harness writes for an unscored run', () => {
    const unscored = {
      schemaVersion: 1,
      cases: [
        {
          name: 'task-real-fe-vs-6545-reba-submit-chain-plan',
          arms: { with: [{ score: null, passed: null }], without: [] },
          aggregates: { score: null, passRate: null },
        },
      ],
    };
    expect(EvalResultSchema.safeParse(unscored).success).toBe(true);
  });
});
