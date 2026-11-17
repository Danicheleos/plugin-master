/** `skills/<name>`: the directory of a skill. */
export const skillDir = (name: string) => `skills/${name}`;
/** `skills/<name>/SKILL.md`. */
export const skillPath = (name: string) => `${skillDir(name)}/SKILL.md`;
