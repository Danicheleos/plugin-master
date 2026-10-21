import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { ExperimentSchema, type Experiment } from '@pm/protocol';
import { resolveInSpace } from '../files/safe-path';
import { AppError } from '../lib/errors';
import { withLock } from '../spaces/config-file';

const DIR = '.plugin-master/experiments';
const file = (root: string, n: number) => resolveInSpace(root, `${DIR}/${n}.json`);

/** Serializes experiment read-modify-writes per space. */
export const lockedExp = <T>(root: string, fn: () => Promise<T>) =>
  withLock(`${root}\0exp`, fn);

export async function listExperiments(root: string): Promise<Experiment[]> {
  const names = await readdir(resolveInSpace(root, DIR)).catch(() => []);
  const all = await Promise.all(
    names
      .filter((f) => /^[1-9]\d*\.json$/.test(f))
      .map((f) => readFile(resolveInSpace(root, `${DIR}/${f}`), 'utf8')
        .then((t) => ExperimentSchema.parse(JSON.parse(t)))
        .catch(() => null)),
  );
  return all.filter((e) => e !== null).sort((a, b) => a.id - b.id);
}

export async function getExperiment(root: string, n: number): Promise<Experiment> {
  const text = await readFile(file(root, n), 'utf8').catch(() => null);
  if (text === null) throw new AppError('EXPERIMENT_NOT_FOUND', `No experiment ${n}`, 404);
  try {
    return ExperimentSchema.parse(JSON.parse(text));
  } catch {
    throw new AppError('EXPERIMENT_INVALID', `Experiment ${n} is broken`, 422);
  }
}

/** Atomic (tmp + rename); call under `lockedExp`. */
export async function saveExperiment(root: string, e: Experiment): Promise<Experiment> {
  const target = file(root, e.id);
  await mkdir(resolveInSpace(root, DIR), { recursive: true });
  await writeFile(`${target}.tmp`, JSON.stringify(e, null, 2) + '\n');
  await rename(`${target}.tmp`, target);
  return e;
}

export const nextId = async (root: string) =>
  Math.max(0, ...(await listExperiments(root)).map((e) => e.id)) + 1;
