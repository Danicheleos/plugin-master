import { useState } from 'react';

/** In-memory draft over the disk text: `base` is the last disk text accepted, `conflict` = disk moved under unsaved edits. */
export function useDraft(disk: string) {
  const [value, setValue] = useState(disk);
  const [base, setBase] = useState(disk);
  const [seenDisk, setSeenDisk] = useState(disk);
  const [conflict, setConflict] = useState(false);
  const dirty = value !== base;
  if (disk !== seenDisk) {
    setSeenDisk(disk);
    if (disk !== base) {
      if (dirty) setConflict(true);
      else {
        setValue(disk);
        setBase(disk);
      }
    }
  }
  return {
    value,
    setValue,
    dirty,
    conflict,
    revert: () => setValue(base),
    reload: () => {
      setValue(disk);
      setBase(disk);
      setConflict(false);
    },
    /** Takes the disk text as the new base (the next save overwrites it). */
    accept: () => {
      setBase(disk);
      setConflict(false);
    },
    saved: (text: string) => {
      setBase(text);
      setSeenDisk(text);
      setConflict(false);
    },
  };
}
