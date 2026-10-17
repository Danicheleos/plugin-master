import { z } from 'zod';

export const SpaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  createdAt: z.string(),
});
export type Space = z.infer<typeof SpaceSchema>;

export const CreateSpaceSchema = z.object({
  path: z.string().min(1), // absolute path; created if missing
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/), // kebab-case, goes into plugin.json
  description: z.string().default(''),
});
export type CreateSpace = z.infer<typeof CreateSpaceSchema>;

export const OpenSpaceSchema = z.object({ path: z.string().min(1) });
export type OpenSpace = z.infer<typeof OpenSpaceSchema>;

export const SpaceConfigSchema = z.object({
  masterContext: z.array(z.string()),
});
export type SpaceConfig = z.infer<typeof SpaceConfigSchema>;

export type FileNode = {
  name: string;
  path: string; // relative to the space root, `/`-separated
  type: 'file' | 'dir';
  children?: FileNode[];
};

export const FileNodeSchema: z.ZodType<FileNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(['file', 'dir']),
    children: z.array(FileNodeSchema).optional(),
  }),
);

export const FileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
});
export type FileContent = z.infer<typeof FileContentSchema>;
