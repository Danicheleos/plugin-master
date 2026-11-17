import { Text, type TextProps } from '@mantine/core';

/** A query/mutation error as red text; renders nothing without an error. */
export function QueryError({
  error,
  ...props
}: { error?: { message: string } | null } & Omit<TextProps, 'c' | 'children'>) {
  return error ? (
    <Text c="red" {...props}>
      {error.message}
    </Text>
  ) : null;
}
