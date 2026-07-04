import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Command as CommandIcon, X } from "lucide-react";
type MinimalCase = {
  id: string;
  accessCode: string;
  status: string;
  userName?: string | null;
  userEmail?: string | null;
  userMobile?: string | null;
};

type Props = {
  cases: MinimalCase[];
  onPick: (c: MinimalCase) => void;
};

export function AdminCaseFinder({ cases, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // Global Ctrl/Cmd+K opens the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
      setActiveIdx(0);
    } else {
      setQuery("");
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cases.slice(0, 8);
    return cases
      .filter((c) => {
        const hay = [
          c.accessCode,
          c.userName,
          c.userEmail,
          c.userMobile,
          c.id,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 12);
  }, [cases, query]);

  const pick = (c: MinimalCase) => {
    onPick(c);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden md:inline-flex items-center gap-2 w-72 rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors"
        data-testid="admin-case-finder-trigger"
        title="Find a case (Ctrl+K)"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="flex-1 text-left">Find a case…</span>
        <kbd className="hidden lg:inline-flex items-center gap-0.5 text-[10px] font-mono border border-slate-700 rounded px-1.5 py-0.5 text-slate-500">
          <CommandIcon className="w-3 h-3" />K
        </kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-lg border border-slate-700/60 bg-slate-900/60 text-slate-300"
        aria-label="Find a case"
      >
        <Search className="w-4 h-4" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[1000] bg-slate-950/80 backdrop-blur-sm flex items-start justify-center pt-20 px-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Find a case"
        >
          <div
            className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-950 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-800">
              <Search className="w-4 h-4 text-slate-500" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveIdx((i) => Math.min(results.length - 1, i + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveIdx((i) => Math.max(0, i - 1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const r = results[activeIdx];
                    if (r) pick(r);
                  }
                }}
                placeholder="Search by access code, name, email, or mobile…"
                className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
                data-testid="admin-case-finder-input"
              />
              <button
                onClick={() => setOpen(false)}
                className="text-slate-500 hover:text-white"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {results.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">
                  No cases match “{query}”.
                </div>
              ) : (
                <ul role="listbox">
                  {results.map((c, i) => {
                    const active = i === activeIdx;
                    return (
                      <li
                        key={c.id}
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIdx(i)}
                        onClick={() => pick(c)}
                        className={`px-3 py-2 cursor-pointer flex items-center gap-3 ${
                          active ? "bg-blue-600/20 text-white" : "text-slate-300 hover:bg-slate-900"
                        }`}
                        data-testid={`admin-case-finder-result-${c.id}`}
                      >
                        <span className="font-mono text-xs text-amber-300 w-20 truncate">
                          {c.accessCode}
                        </span>
                        <span className="flex-1 truncate text-sm">
                          {c.userName || <span className="text-slate-500">— no name —</span>}
                        </span>
                        <span className="text-xs text-slate-500 truncate hidden sm:block max-w-[180px]">
                          {c.userEmail || ""}
                        </span>
                        <span className="text-[10px] uppercase text-slate-500">
                          {c.status}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="px-3 py-2 border-t border-slate-800 text-[10px] text-slate-500 flex items-center justify-between">
              <span>↑↓ to navigate · Enter to open</span>
              <span>Esc to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
