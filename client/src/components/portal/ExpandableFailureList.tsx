import { useState } from "react";

export type FailureEntry = { name: string; error: string };

const INITIAL_VISIBLE = 3;

export function ExpandableFailureList({ failures }: { failures: FailureEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? failures : failures.slice(0, INITIAL_VISIBLE);
  const extra = failures.length - INITIAL_VISIBLE;
  return (
    <span className="block space-y-0.5">
      {visible.map((f, i) => (
        <span key={i} className="block">{f.name}: {f.error}</span>
      ))}
      {!expanded && extra > 0 && (
        <button
          type="button"
          className="underline underline-offset-2 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
        >
          …and {extra} more
        </button>
      )}
    </span>
  );
}
