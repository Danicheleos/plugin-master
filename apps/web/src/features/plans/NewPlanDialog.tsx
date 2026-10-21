import { useState, type FormEvent } from 'react';
import {
  Button,
  Checkbox,
  Group,
  Modal,
  Stack,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useCreatePlan, useSetActivePlan } from './hooks';

type Props = {
  spaceId: string;
  onClose: () => void;
  /** Sends a chat message (used to ask the master agent for phases). */
  onAsk: (text: string) => void;
};

export function NewPlanDialog({ spaceId, onClose, onAsk }: Props) {
  const create = useCreatePlan(spaceId);
  const setActive = useSetActivePlan(spaceId);
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [draft, setDraft] = useState(true);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate(
      { title, goal },
      {
        onSuccess: async (plan) => {
          if (draft) {
            // plan_set_phases works on the active plan, so it must be this one
            await setActive.mutateAsync(plan.id).catch(() => undefined);
            onAsk(
              `Draft the phases for the active plan "${plan.title}" and set them with plan_set_phases.`,
            );
          }
          onClose();
        },
      },
    );
  };

  return (
    <Modal opened onClose={onClose} title="New plan">
      <form onSubmit={submit}>
        <Stack>
          <TextInput
            label="Title"
            data-autofocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            label="Goal"
            rows={4}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
          <Checkbox
            label="Ask the master agent to draft phases"
            checked={draft}
            onChange={(e) => setDraft(e.currentTarget.checked)}
          />
          {create.error && <span role="alert">{create.error.message}</span>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!title.trim()}
              loading={create.isPending}
            >
              Create
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
