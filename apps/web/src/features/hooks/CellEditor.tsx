import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  MATCHERLESS_EVENTS,
  validateGroup,
  type Group as HookGroup,
  type HookSource,
  type HooksResponse,
} from '@pm/protocol';
import { HandlerForm } from './HandlerForm';
import { cleanGroup, looseProblems } from './draft';
import { useSaveHooks } from './hooks';

const groupsOf = (
  data: HooksResponse,
  source: HookSource,
  file: string,
  event: string,
): HookGroup[] =>
  data.entries
    .filter((e) => e.source === source && e.file === file && e.event === event)
    .sort((a, b) => a.group - b.group)
    .map((e) => ({
      ...(e.matcher !== undefined && { matcher: e.matcher }),
      hooks: e.handlers,
    }));

type Handler = HookGroup['hooks'][number];
/** A group in the editor: groups and handlers carry generated keys, so removing one does not shift the state of the rest. */
type KGroup = {
  key: string;
  matcher?: string;
  hooks: { key: string; handler: Handler }[];
};
let keySeq = 0;
const nextKey = () => `k${++keySeq}`;
const keyed = (g: HookGroup): KGroup => ({
  key: nextKey(),
  ...(g.matcher !== undefined && { matcher: g.matcher }),
  hooks: g.hooks.map((handler) => ({ key: nextKey(), handler })),
});
const plain = (g: KGroup): HookGroup => ({
  ...(g.matcher !== undefined && { matcher: g.matcher }),
  hooks: g.hooks.map((h) => h.handler),
});

type Props = {
  spaceId: string;
  data: HooksResponse;
  event: string;
  source: HookSource;
  onClose: () => void;
};

/** Editor of the matcher groups of one (event, source) cell. */
export function CellEditor({ spaceId, data, event, source, onClose }: Props) {
  // broken files cannot be written; missing ones only for sources with a canonical new file
  const files = data.sources.filter(
    (s) =>
      s.source === source &&
      !s.error &&
      (s.exists || ['plugin', 'project', 'local'].includes(source)),
  );
  const withEvent = files.find((f) =>
    data.entries.some(
      (e) => e.source === source && e.file === f.file && e.event === event,
    ),
  );
  const [file, setFile] = useState((withEvent ?? files[0])?.file ?? '');
  // what the disk had when the editor loaded the groups; a different value later means the file changed under it
  const onDisk = useMemo(
    () => JSON.stringify(groupsOf(data, source, file, event)),
    [data, source, file, event],
  );
  const [loaded, setLoaded] = useState(onDisk);
  const [groups, setGroups] = useState(() =>
    groupsOf(data, source, file, event).map(keyed),
  );
  const [confirm, setConfirm] = useState(false);
  const save = useSaveHooks(spaceId);
  const matcherless = MATCHERLESS_EVENTS.includes(event);

  const plainGroups = useMemo(() => groups.map(plain), [groups]);
  const problems = plainGroups.map((g) =>
    validateGroup(source, event, cleanGroup(g, event)),
  );
  const invalid = problems.some((p) => p.length > 0);
  const put = (gs: HookGroup[]) =>
    save.mutate(
      { source, file, event, groups: gs.map((g) => cleanGroup(g, event)) },
      { onSuccess: onClose },
    );
  const patch = (key: string, f: (g: KGroup) => KGroup) =>
    setGroups((gs) => gs.map((x) => (x.key === key ? f(x) : x)));
  const reload = (f: string) => {
    setGroups(groupsOf(data, source, f, event).map(keyed));
    setLoaded(JSON.stringify(groupsOf(data, source, f, event)));
  };

  return (
    <Modal opened onClose={onClose} size="xl" title={`${event} / ${source}`}>
      <Stack>
        {files.length === 0 && (
          <Text c="dimmed">No writable file for this source.</Text>
        )}
        {files.length > 1 && (
          <Select
            label="File"
            allowDeselect={false}
            data={files.map((f) => ({
              value: f.file,
              label: f.exists ? f.file : `${f.file} (new)`,
            }))}
            value={file}
            onChange={(f) => {
              if (!f) return;
              setFile(f);
              reload(f);
            }}
          />
        )}
        {onDisk !== loaded && (
          <Alert color="yellow" title="Changed on disk">
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm">
                This event was changed on disk while you were editing. Reloading
                discards your edits.
              </Text>
              <Button size="xs" variant="light" onClick={() => reload(file)}>
                Reload
              </Button>
            </Group>
          </Alert>
        )}
        {files.length === 1 && (
          <Text size="sm" c="dimmed">
            {files[0].file}
            {files[0].exists ? '' : ' (new)'}
          </Text>
        )}
        {groups.map((g, i) => (
          <Stack
            key={g.key}
            gap="xs"
            p="xs"
            style={{
              border: '1px solid var(--mantine-color-default-border)',
              borderRadius: 'var(--mantine-radius-sm)',
            }}
          >
            <Group align="flex-end" wrap="nowrap">
              <TextInput
                flex={1}
                label="Matcher"
                size="xs"
                disabled={matcherless}
                placeholder={
                  matcherless
                    ? `${event} ignores matchers`
                    : 'empty = all, e.g. Bash|Edit'
                }
                description={
                  matcherless
                    ? 'This event always fires; no matcher.'
                    : undefined
                }
                value={matcherless ? '' : (g.matcher ?? '')}
                error={problems[i].find((p) => p.path === 'matcher')?.message}
                onChange={(e) =>
                  patch(g.key, (x) => ({
                    ...x,
                    matcher: e.currentTarget.value,
                  }))
                }
              />
              <Button
                size="xs"
                variant="subtle"
                color="red"
                onClick={() =>
                  setGroups((gs) => gs.filter((x) => x.key !== g.key))
                }
              >
                Remove group
              </Button>
            </Group>
            {g.hooks.map(({ key, handler }, k) => (
              <HandlerForm
                key={key}
                handler={handler}
                index={k}
                event={event}
                source={source}
                problems={problems[i]}
                onChange={(nh) =>
                  patch(g.key, (x) => ({
                    ...x,
                    hooks: x.hooks.map((h) =>
                      h.key === key ? { key, handler: nh } : h,
                    ),
                  }))
                }
                onRemove={() =>
                  patch(g.key, (x) => ({
                    ...x,
                    hooks: x.hooks.filter((h) => h.key !== key),
                  }))
                }
              />
            ))}
            {looseProblems(problems[i]).map((p) => (
              <Text key={p.path + p.message} size="xs" c="red">
                {p.message}
              </Text>
            ))}
            <Button
              size="xs"
              variant="light"
              onClick={() =>
                patch(g.key, (x) => ({
                  ...x,
                  hooks: [
                    ...x.hooks,
                    { key: nextKey(), handler: { type: 'command' } },
                  ],
                }))
              }
            >
              Add handler
            </Button>
          </Stack>
        ))}
        <Button
          variant="light"
          onClick={() =>
            setGroups((gs) => [...gs, keyed({ hooks: [{ type: 'command' }] })])
          }
        >
          Add group
        </Button>
        {save.error && (
          <Alert color="red" title="Not saved">
            {save.error.message.split('\n').map((m) => (
              <div key={m}>{m}</div>
            ))}
          </Alert>
        )}
        <Group justify="space-between">
          {confirm ? (
            <Button
              color="red"
              disabled={!file || save.isPending}
              onClick={() => put([])}
            >
              Confirm clear
            </Button>
          ) : (
            <Button
              variant="subtle"
              color="red"
              disabled={!file}
              onClick={() => setConfirm(true)}
            >
              Clear event
            </Button>
          )}
          <Group>
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!file || invalid || save.isPending}
              onClick={() => put(plainGroups)}
            >
              Save
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
