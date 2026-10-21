import { Box, Button, Menu, Slider, Text } from '@mantine/core';
import {
  playSound,
  setSoundPrefs,
  SOUNDS,
  useSoundPrefs,
  type SoundName,
} from './sounds';

/** Picks the sound played when the agent finishes; choosing one previews it. */
export function SoundMenu() {
  const { sound, volume } = useSoundPrefs();
  return (
    <Menu position="bottom-end" closeOnItemClick={false}>
      <Menu.Target>
        <Button variant="default" size="compact-sm" aria-label="Finish sound">
          {sound === 'off' ? '🔇' : '🔔'}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Sound when the agent finishes</Menu.Label>
        <Menu.Item
          role="menuitemradio"
          aria-checked={sound === 'off'}
          leftSection={sound === 'off' ? '●' : '○'}
          onClick={() => setSoundPrefs({ sound: 'off' })}
        >
          Off
        </Menu.Item>
        {(Object.keys(SOUNDS) as SoundName[]).map((name) => (
          <Menu.Item
            key={name}
            role="menuitemradio"
            aria-checked={sound === name}
            leftSection={sound === name ? '●' : '○'}
            onClick={() => {
              setSoundPrefs({ sound: name });
              playSound(name, volume);
            }}
          >
            {SOUNDS[name].label}
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Box px="sm" pt={4} pb="xs">
          <Text size="xs" c="dimmed" mb={4}>
            Volume
          </Text>
          <Slider
            aria-label="Sound volume"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            label={null}
            onChange={(v) => setSoundPrefs({ volume: v })}
            onChangeEnd={(v) => sound !== 'off' && playSound(sound, v)}
          />
        </Box>
      </Menu.Dropdown>
    </Menu>
  );
}
