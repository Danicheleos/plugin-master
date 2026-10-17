import { render } from '@testing-library/react';

import App from './app';

describe('App', () => {
  it('renders the title', () => {
    const { getByText } = render(<App />);
    expect(getByText('plugin-master')).toBeTruthy();
  });
});
