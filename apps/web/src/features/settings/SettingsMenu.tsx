import { ActionIcon, Box, Menu, Tooltip } from '@mantine/core';
import { SoundMenuItems } from '../sound';
import { ColorSchemeToggle } from '../theme';

/** The workspace header's "⚙" menu: the finish sound (with volume) and the color scheme. */
export function SettingsMenu() {
  return (
    <Menu position="bottom-end" closeOnItemClick={false}>
      <Tooltip label="Settings">
        <Menu.Target>
          <ActionIcon variant="default" aria-label="Settings">
            ⚙
          </ActionIcon>
        </Menu.Target>
      </Tooltip>
      <Menu.Dropdown>
        <SoundMenuItems />
        <Menu.Divider />
        <Menu.Label>Color scheme</Menu.Label>
        <Box px="sm" pb="xs">
          <ColorSchemeToggle />
        </Box>
      </Menu.Dropdown>
    </Menu>
  );
}
