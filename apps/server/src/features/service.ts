import type { FeatureName, Features } from '@pm/protocol';
import { AppError } from '../lib/errors';
import { readConfig, withLock, writeConfig } from '../spaces/config-file';

export const getFeatures = async (root: string): Promise<Features> =>
  (await readConfig(root)).features;

/** Gate for git routes and WS handlers. */
export async function requireFeature(root: string, name: FeatureName) {
  if (!(await getFeatures(root))[name])
    throw new AppError('FEATURE_DISABLED', `Feature "${name}" is disabled`, 409);
}

/** Partial update; `autoCommit` and `masterLoop` need `git` (after the update); git off turns them off. */
export const setFeatures = (root: string, input: Partial<Features>) =>
  withLock(root, async () => {
    const config = await readConfig(root);
    const off = input.git === false ? { autoCommit: false, masterLoop: false } : {};
    const features = { ...config.features, ...off, ...input };
    for (const name of ['autoCommit', 'masterLoop'] as const)
      if (features[name] && !features.git)
        throw new AppError('INVALID_FEATURES', `${name} requires git`, 400);
    await writeConfig(root, { ...config, features });
    return features;
  });
