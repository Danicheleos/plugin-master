import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Modal, Select, Text } from '@mantine/core';
import { ProjectSessionSchema, TraceSchema, type ProjectSession } from '@pm/protocol';
import { z } from 'zod';
import { request } from '../../api/http';
import { TraceDialog } from '../evals/TraceView';
import { stamp } from '../evals/format';

const useAllSessions = (enabled: boolean) =>
  useQuery({
    enabled,
    queryKey: ['claude-sessions'],
    queryFn: () => request('GET', '/api/claude/sessions', undefined, z.array(ProjectSessionSchema)),
  });

/** Projects (by cwd) ordered by their newest session; sessions inside newest first. */
export function groupSessions(sessions: ProjectSession[]) {
  const groups = new Map<string, ProjectSession[]>();
  for (const s of sessions) {
    const key = s.cwd || s.project;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.entries()]
    .map(([key, items]) => ({ key, name: items[0]?.project ?? key, sessions: items.sort((a, b) => b.lastModified - a.lastModified) }))
    .sort((a, b) => (b.sessions[0]?.lastModified ?? 0) - (a.sessions[0]?.lastModified ?? 0));
}

const sessionLabel = (s: ProjectSession) =>
  `${s.title.replace(/\s+/g, ' ').slice(0, 80)} · ${stamp(new Date(s.lastModified).toISOString())}`;

/** Header button: pick a project, then one of its sessions (by title), and open its flow/trace. */
export function OpenTraceFile() {
  const [picking, setPicking] = useState(false);
  const [project, setProject] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);
  const { data, error, isPending } = useAllSessions(picking);
  const projects = data ? groupSessions(data) : [];
  const trace = useQuery({
    enabled: open !== null,
    queryKey: ['claude-sessions', open?.id, 'trace'],
    queryFn: () => request('GET', `/api/claude/sessions/${open?.id}/trace`, undefined, TraceSchema),
  });
  return (
    <>
      <Button variant="default" size="xs" onClick={() => setPicking(true)}>
        Open trace file
      </Button>
      <Modal opened={picking} onClose={() => setPicking(false)} title="Open a Claude Code session">
        {error && <Text c="red">{error.message}</Text>}
        <Select
          searchable
          data-autofocus
          label="Project"
          placeholder={isPending ? 'Loading…' : 'Search projects'}
          nothingFoundMessage="No projects"
          maxDropdownHeight={300}
          data={projects.map((p) => ({ value: p.key, label: `${p.name} (${p.sessions.length})` }))}
          value={project}
          onChange={setProject}
        />
        <Select
          searchable
          mt="sm"
          label="Session"
          placeholder={project ? 'Search sessions' : 'Pick a project first'}
          nothingFoundMessage="No sessions"
          maxDropdownHeight={300}
          disabled={!project}
          data={(projects.find((p) => p.key === project)?.sessions ?? []).map((s) => ({ value: s.id, label: sessionLabel(s) }))}
          onChange={(id) => {
            const s = data?.find((x) => x.id === id);
            if (!s) return;
            setPicking(false);
            setOpen({ id: s.id, title: `${s.project}: ${s.title.slice(0, 60)}` });
          }}
        />
      </Modal>
      {open && (
        <TraceDialog title={open.title} trace={trace.data} error={trace.error} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
