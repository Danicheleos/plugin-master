import { Alert } from '@mantine/core';
import { ApiError } from '../../api/http';

const HINTS: Record<string, string> = {
  EVAL_UNTRUSTED: 'Tick "Trust this plugin" in the form first.',
  EVAL_RUNNING: 'Wait for the running eval to finish or cancel it in the Evals widget.',
  EXPERIMENT_RUNNING: 'Cancel the running experiment or wait for it to finish.',
  GIT_DIRTY: 'Commit or discard the changes in the Git widget, then merge again.',
};

/** An API error with a short hint for the known codes. */
export function ApiAlert({ error }: { error: Error }) {
  const hint = error instanceof ApiError ? HINTS[error.code] : undefined;
  return (
    <Alert color="red" p="xs">
      {error.message}
      {hint && ` ${hint}`}
    </Alert>
  );
}
