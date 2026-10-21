import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { send, useSpaceEvents } from '../api/ws';
import { evalsKey, useEvalRuns } from '../features/evals/hooks';
import { configKey } from '../features/context/hooks';
import { fileKey, treeKey } from '../features/files/hooks';

/**
 * Keeps queries fresh on `fs.changed` and tells the server what to watch: the root, `paths`
 * (expanded dirs, open files) and, while an evals widget is shown, the eval dirs.
 */
export function useWorkspaceWatch(
  id: string,
  paths: readonly string[],
  evalsShown: boolean,
) {
  const evals = useEvalRuns(id, evalsShown).data;
  const evalDir = evals?.dir;
  const resultsDir = evalDir && `${evalDir}/results`;
  // run dirs seen appearing (their aggregate-result.json is written later) plus the newest one
  const [freshRuns, setFreshRuns] = useState<readonly string[]>([]);
  const newestRuns = evals?.groups[0]?.runIds;
  const newestId = newestRuns?.[newestRuns.length - 1];
  const newest = newestId && `${resultsDir}/${newestId}`;
  const qc = useQueryClient();

  useSpaceEvents(id, (msg) => {
    if (msg.type !== 'fs.changed') return;
    if (resultsDir && msg.path.startsWith(`${resultsDir}/`)) {
      void qc.invalidateQueries({ queryKey: evalsKey(id) });
      const depth = msg.path.slice(resultsDir.length + 1).split('/').length;
      if (msg.event === 'addDir' && depth <= 2)
        setFreshRuns((prev) => [...prev.slice(-9), msg.path]);
    }
    if (msg.path === '.plugin-master/config.json')
      void qc.invalidateQueries({ queryKey: configKey(id) });
    if (msg.event !== 'change')
      void qc.invalidateQueries({ queryKey: treeKey(id) });
    if (msg.event === 'change' || msg.event === 'unlink')
      void qc.invalidateQueries({ queryKey: fileKey(id, msg.path) });
  });

  const watchKey = JSON.stringify([...new Set(paths)]);
  useEffect(() => {
    send({
      type: 'fs.watch',
      spaceId: id,
      paths: [
        '',
        ...(JSON.parse(watchKey) as string[]),
        // the eval dir too: `results/` may not exist yet
        ...(evalDir && resultsDir && evalsShown
          ? [evalDir, resultsDir, ...freshRuns, ...(newest ? [newest] : [])]
          : []),
      ],
    });
  }, [id, watchKey, evalDir, resultsDir, freshRuns, newest, evalsShown]);
}
