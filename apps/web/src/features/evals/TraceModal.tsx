import { TraceDialog } from '../../shared/trace/TraceView';
import { useEvalTrace, type TraceTarget } from './hooks';

export function TraceModal({
  spaceId,
  target,
  onClose,
}: {
  spaceId: string;
  target: TraceTarget;
  onClose: () => void;
}) {
  const { data, error } = useEvalTrace(spaceId, target);
  return (
    <TraceDialog
      title={`Trace: ${target.case} (${target.arm} ${target.n})`}
      trace={data}
      error={error}
      onClose={onClose}
    />
  );
}
