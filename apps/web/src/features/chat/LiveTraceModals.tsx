import type { ComponentProps } from 'react';
import {
  RunTraceModal,
  SubagentTraceModal,
} from '../../shared/trace/RunTraceModal';
import { useChatLiveRun } from './ChatContext';

/** The shared run trace dialog, kept live while this chat streams the run's session. */
export function LiveRunTraceModal(props: ComponentProps<typeof RunTraceModal>) {
  return <RunTraceModal {...props} live={useChatLiveRun(props.runId)} />;
}

/** The shared subagent trace dialog, kept live while this chat streams the run's session. */
export function LiveSubagentTraceModal(
  props: ComponentProps<typeof SubagentTraceModal>,
) {
  return <SubagentTraceModal {...props} live={useChatLiveRun(props.runId)} />;
}
