import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Group,
  NavLink,
  ScrollArea,
  Stack,
  Text,
} from '@mantine/core';
import { BrowseResultSchema } from '@pm/protocol';
import { request } from '../../api/http';

type Props = {
  /** Folder to start in; the user's home when omitted. */
  initialPath?: string;
  onSelect: (path: string) => void;
  onCancel?: () => void;
};

export function FolderPicker({ initialPath, onSelect, onCancel }: Props) {
  const [path, setPath] = useState<string | undefined>(initialPath);
  const { data, error } = useQuery({
    queryKey: ['browse', path ?? null],
    queryFn: () =>
      request(
        'GET',
        `/api/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`,
        undefined,
        BrowseResultSchema,
      ),
  });
  const sep = data?.path.includes('\\') ? '\\' : '/';
  return (
    <Stack gap="xs">
      <Group gap="xs" wrap="nowrap">
        <Button
          variant="default"
          size="compact-sm"
          disabled={!data?.parent}
          onClick={() => setPath(data?.parent ?? undefined)}
        >
          Up
        </Button>
        <Button
          variant="default"
          size="compact-sm"
          onClick={() => setPath(undefined)}
        >
          Home
        </Button>
        <Text size="sm" truncate title={data?.path}>
          {data?.path ?? ''}
        </Text>
      </Group>
      {error && <Alert color="red">{error.message}</Alert>}
      <ScrollArea h={220} type="auto">
        {data?.entries.length === 0 && (
          <Text size="sm" c="dimmed">
            No subfolders
          </Text>
        )}
        {data?.entries.map((e) => (
          <NavLink
            key={e.name}
            label={e.name}
            onClick={() =>
              setPath(
                data.path.endsWith(sep)
                  ? data.path + e.name
                  : data.path + sep + e.name,
              )
            }
          />
        ))}
      </ScrollArea>
      <Group justify="flex-end">
        {onCancel && (
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button disabled={!data} onClick={() => data && onSelect(data.path)}>
          Select this folder
        </Button>
      </Group>
    </Stack>
  );
}
