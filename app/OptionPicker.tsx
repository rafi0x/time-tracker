"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  placeholder: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  /** Persist a value the user typed that wasn't in the list yet. */
  onAdd: (value: string) => void;
  /** Drop a value from the list. Tasks already using it keep it. */
  onRemove: (value: string) => void;
}

type Row = { value: string; isNew: boolean };

/**
 * Typeahead select where the list itself is editable: typing a value that
 * doesn't exist offers to add it, and every existing value can be removed.
 */
export default function OptionPicker({
  placeholder,
  value,
  options,
  onChange,
  onAdd,
  onRemove,
}: Props) {
  const [open, setOpen] = useState(false);
  // null while the input is just displaying `value`; a string once typing starts.
  const [query, setQuery] = useState<string | null>(null);
  const [hi, setHi] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const q = (query ?? "").trim();
  const matches = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  const exact = options.some((o) => o.toLowerCase() === q.toLowerCase());
  // Matches first: Enter should pick the obvious existing option, never
  // silently create a near-duplicate of it. Adding is the last resort.
  const rows: Row[] = [
    ...matches.map((v) => ({ value: v, isNew: false })),
    ...(q && !exact ? [{ value: q, isNew: true }] : []),
  ];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery(null);
    setHi(0);
  }

  function pick(row: Row) {
    if (row.isNew) onAdd(row.value);
    onChange(row.value);
    close();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setHi((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        return rows.length ? (next + rows.length) % rows.length : 0;
      });
    } else if (e.key === "Enter") {
      // Swallow Enter so it never submits the surrounding form mid-pick.
      e.preventDefault();
      if (rows[hi]) pick(rows[hi]);
    } else if (e.key === "Escape") {
      close();
    }
  }

  return (
    <div className="picker" ref={boxRef}>
      <input
        value={query ?? value}
        placeholder={placeholder}
        aria-label={placeholder}
        role="combobox"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        // Picking closes the list but leaves the input focused, so a second
        // click fires no focus event — without this the list never reopens.
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setHi(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {value && !open && (
        <button
          type="button"
          className="picker-clear"
          aria-label={`Clear ${placeholder}`}
          onClick={() => onChange("")}
        >
          ✕
        </button>
      )}
      {open && (
        <ul className="picker-list">
          {rows.length === 0 && <li className="picker-empty">No options yet — type to add one.</li>}
          {rows.map((row, i) => (
            <li
              key={`${row.isNew}-${row.value}`}
              className={`picker-row${i === hi ? " hi" : ""}${row.isNew ? " new" : ""}`}
              onMouseEnter={() => setHi(i)}
            >
              <button type="button" className="picker-pick" onClick={() => pick(row)}>
                {row.isNew ? `Add “${row.value}”` : row.value}
              </button>
              {!row.isNew && (
                <button
                  type="button"
                  className="picker-remove"
                  aria-label={`Remove ${row.value}`}
                  title="Remove from list"
                  onClick={() => onRemove(row.value)}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
