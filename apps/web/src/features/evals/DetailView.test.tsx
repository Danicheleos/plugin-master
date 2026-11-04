import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DetailView } from './DetailView';

const show = (text: string) =>
  render(
    <MantineProvider>
      <DetailView text={text} />
    </MantineProvider>,
  );

it('renders JSON as key/value rows with nested values collapsed until opened', () => {
  show(
    JSON.stringify({
      file_path: '/a.md',
      content: 'line 1\nline 2',
      opts: { deep: { leaf: 'hidden' } },
    }),
  );
  expect(screen.getByText('file_path:')).toBeTruthy();
  expect(screen.getByText('"/a.md"')).toBeTruthy();
  expect(
    screen.getByText('line 1\nline 2', { normalizer: (s) => s }),
  ).toBeTruthy(); // real newline, not an escaped one
  expect(screen.getByText('deep:')).toBeTruthy(); // first nested level is open
  expect(screen.queryByText('leaf:')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: /\{1\}/, expanded: false }),
  );
  expect(screen.getByText('leaf:')).toBeTruthy();
});

it('renders content blocks as text plus labels, and other text raw', () => {
  show(JSON.stringify([{ type: 'text', text: 'hello' }, { type: 'image' }]));
  expect(screen.getByText('hello')).toBeTruthy();
  expect(screen.getByText('image')).toBeTruthy();
  show('{"cut": "prev');
  expect(screen.getByText('{"cut": "prev')).toBeTruthy();
});
