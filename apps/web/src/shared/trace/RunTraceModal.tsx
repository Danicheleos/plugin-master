import { Modal, Text } from '@mantine/core';
import { QueryError } from '../ui/QueryError';
import { useLiveRunTrace, type LiveRun } from './hooks';
import { subagentTrace } from './subagent-trace';
import { SubagentTraceBody, TraceDialog } from './TraceView';

/** A recorded chat run; `live` (chat session info) keeps it fresh while that session streams. */
export function RunTraceModal({
  spaceId,
  runId,
  title,
  live,
  onClose,
}: {
  spaceId: string;
  runId: string;
  title: string;
  live?: LiveRun;
  onClose: () => void;
}) {
  const { data, error } = useLiveRunTrace(spaceId, runId, live);
  return (
    <TraceDialog
      byPrompt
      title={`Run: ${title}`}
      trace={data}
      error={error}
      onClose={onClose}
    />
  );
}

/** Only the subagent of the Agent/Task call `toolUseId` in this run, live while it runs. */
export function SubagentTraceModal({
  spaceId,
  runId,
  toolUseId,
  title,
  live,
  onClose,
}: {
  spaceId: string;
  runId: string;
  toolUseId: string;
  title: string;
  live?: LiveRun;
  onClose: () => void;
}) {
  const { data, error } = useLiveRunTrace(spaceId, runId, live);
  const trace = data && subagentTrace(data, toolUseId);
  return (
    <Modal opened onClose={onClose} size="90%" title={title}>
      <QueryError error={error} />
      {data && !trace && (
        <Text size="sm" c="dimmed">
          Not in the recorded trace yet; it refreshes while the turn runs.
        </Text>
      )}
      {trace && <SubagentTraceBody trace={trace} />}
    </Modal>
  );
}
