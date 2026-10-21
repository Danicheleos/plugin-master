import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SoundMenu } from './SoundMenu';
import { setSoundPrefs, SOUNDS, useSoundPrefs } from './sounds';

describe('sound prefs', () => {
  it('default to off and persist the choice', () => {
    function Probe() {
      const p = useSoundPrefs();
      return <span>{`${p.sound}/${p.volume}`}</span>;
    }
    render(<Probe />);
    expect(screen.getByText('off/0.5')).toBeTruthy();
    act(() => setSoundPrefs({ sound: 'drop', volume: 0.2 }));
    expect(screen.getByText('drop/0.2')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('pm.sound') ?? '{}')).toEqual({
      sound: 'drop',
      volume: 0.2,
    });
  });

  it('lists every sound in the menu and selects one', async () => {
    setSoundPrefs({ sound: 'off', volume: 0.5 });
    render(
      <MantineProvider>
        <SoundMenu />
      </MantineProvider>,
    );
    fireEvent.click(screen.getByLabelText('Finish sound'));
    for (const s of Object.values(SOUNDS))
      expect(await screen.findByText(s.label)).toBeTruthy();
    fireEvent.click(screen.getByText('Soft chime'));
    expect(JSON.parse(localStorage.getItem('pm.sound') ?? '{}').sound).toBe(
      'chime',
    );
  });
});
