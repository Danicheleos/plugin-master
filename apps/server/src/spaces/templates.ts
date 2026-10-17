/** Files of a minimal valid plugin (relative path -> content). */
export function pluginFiles(
  name: string,
  description: string,
): Record<string, string> {
  return {
    '.claude-plugin/plugin.json':
      JSON.stringify({ name, version: '0.1.0', description }, null, 2) + '\n',
    'skills/.gitkeep': '',
    'CLAUDE.md': 'Before working, read .plugin-master/IDEA.md and STATE.md\n',
  };
}

/** Files of the `.plugin-master/` directory. */
export function pluginMasterFiles(): Record<string, string> {
  return {
    '.plugin-master/config.json':
      JSON.stringify(
        {
          masterContext: ['.plugin-master/IDEA.md', '.plugin-master/STATE.md'],
        },
        null,
        2,
      ) + '\n',
    '.plugin-master/IDEA.md':
      '## End result\n\n## Expected behavior\n\n## Interaction\n',
    '.plugin-master/STATE.md':
      '## Current version\n\n## Open issues\n\n## Next step\n',
  };
}
