import { useEffect, useState } from 'react';

/** Returns `value` after it stops changing for `ms` — keeps search boxes from firing a request per keystroke. */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
