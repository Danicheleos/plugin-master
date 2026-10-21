import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, SegmentedControl, Text } from '@mantine/core';
import { send } from '../../api/ws';
import { evalRunsKey, fetchEvalRuns, useEvalSuite } from './hooks';
import { EvalPrefsScope, useEvalPrefs } from './prefs';
import { BuildSuiteDialog } from './BuildSuiteDialog';
import { EvalRunPanel } from './EvalRunPanel';
import { EvalRunsList } from './EvalRunsList';
import { EvalRunView } from './EvalRunView';
import { EvalSuitesList } from './EvalSuitesList';
import { EvalTargetsList } from './EvalTargetsList';
import styles from './evals.module.scss';

type Props = {
  spaceId: string;
  onOpenFile?: (path: string) => void;
  spaceRoot?: string;
  /** dashboard item id: each evals widget keeps its own settings */
  widgetId?: string;
};

const BUILD_SUITE_PROMPT = `Build an eval suite for this plugin. First study the plugin (skills, commands, agents, hooks) and the idea, then propose a plan with plan tools: one case per behavior that matters, including prompts that should not trigger the plugin. After that, write the cases under the eval directory in the documented case format, with cheap deterministic graders first (regex, tool_used, tool_order, file_exists) and an llm grader only where needed. Do not run the evals without asking me first.`;

export function EvalsTab({ widgetId, ...props }: Props) {
  return (
    <EvalPrefsScope spaceId={props.spaceId} widgetId={widgetId}>
      <EvalsBody {...props} />
    </EvalPrefsScope>
  );
}

function EvalsBody({ spaceId, onOpenFile, spaceRoot }: Props) {
  // `page`/`view` are persisted, so Back (and a reload) returns to the same list.
  // `group`: the id is the first run of a group, shown as a merged view; `focusCase`/`compareWith`
  // come from the suites view
  const [{ page: target, view }, update] = useEvalPrefs();
  const setTarget = (page: typeof target) => update(() => ({ page }));
  const [confirmBuild, setConfirmBuild] = useState(false);
  const qc = useQueryClient();
  const suite = useEvalSuite(spaceId).data;
  const empty = suite !== undefined && suite.cases.length === 0;
  const build = () => {
    setConfirmBuild(false);
    send({ type: 'chat.send', spaceId, text: BUILD_SUITE_PROMPT });
  };

  /** A finished run opens its whole group (the run may belong to a batch). */
  async function openFinished(runId: string) {
    const data = await qc
      .fetchQuery({
        queryKey: evalRunsKey(spaceId),
        queryFn: () => fetchEvalRuns(spaceId),
        staleTime: 0,
      })
      .catch(() => undefined);
    const g = data?.groups.find((x) => x.runIds.includes(runId));
    setTarget(
      g && g.runIds.length > 1
        ? { id: g.id, group: true }
        : { id: runId, group: false },
    );
  }

  return (
      <div className={styles.root}>
        <BuildSuiteDialog
          opened={confirmBuild}
          prompt={BUILD_SUITE_PROMPT}
          onCancel={() => setConfirmBuild(false)}
          onSend={build}
        />
        <EvalRunPanel
          spaceId={spaceId}
          onDone={(id) => void openFinished(id)}
          actions={
            <>
              <Button
                size="xs"
                variant={empty ? 'filled' : 'default'}
                onClick={() => setConfirmBuild(true)}
              >
                Build eval suite with agent
              </Button>
              <SegmentedControl
                size="xs"
                aria-label="Group runs by"
                value={view}
                onChange={(v) =>
                  update(() => ({ view: v as typeof view, page: null }))
                }
                data={[
                  { value: 'suites', label: 'Suites' },
                  { value: 'targets', label: 'Skills & agents' },
                  { value: 'invocations', label: 'Invocations' },
                ]}
              />
              {empty && (
                <Text c="dimmed" size="sm">
                  This plugin has no eval cases yet.
                </Text>
              )}
            </>
          }
        />
        {target === null ? (
          view === 'invocations' ? (
            <EvalRunsList
              spaceId={spaceId}
              onOpen={(id, group) => setTarget({ id, group })}
            />
          ) : (
            (() => {
              const List = view === 'suites' ? EvalSuitesList : EvalTargetsList;
              return (
                <List
                  spaceId={spaceId}
                  onOpen={(id, focusCase, compareWith) =>
                    setTarget({ id, group: false, focusCase, compareWith })
                  }
                />
              );
            })()
          )
        ) : (
          <EvalRunView
            spaceId={spaceId}
            runId={target.id}
            group={target.group}
            focusCase={target.focusCase}
            compareWith={target.compareWith}
            onSwitch={(id) =>
              setTarget({ ...target, id, compareWith: undefined })
            }
            onBack={() => setTarget(null)}
            onOpenFile={onOpenFile}
            spaceRoot={spaceRoot}
          />
        )}
      </div>
  );
}
