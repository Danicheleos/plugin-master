import { CreateSpaceSchema } from './rest.js';

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
