import { useState } from "react";
import { EventRow, TechToggle, useLines } from "./Feed";

/**
 * History — the full audit trail.
 *
 * The rail card on the home screen shows the last dozen; this is all of it,
 * filterable. Both render through the same `EventRow` over the same `useLines`
 * subscription, so the phrasing can never drift between the two.
 */

type Filter = "all" | "no" | "eye" | "ok";

const TABS: { id: Filter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "no", label: "Refused" },
  { id: "eye", label: "Needed you" },
  { id: "ok", label: "Went through" },
];

export function History() {
  const [filter, setFilter] = useState<Filter>("all");
  const lines = useLines();
  const shown = filter === "all" ? lines : lines.filter((l) => l.kind === filter);

  const count = (f: Filter) => (f === "all" ? lines.length : lines.filter((l) => l.kind === f).length);

  return (
    <div className="hist">
      <div className="view-head">
        <h1>History</h1>
        <p>
          Every decision this house made, in the order it made them — what ran, what was refused,
          and what it asked you about. Registrations are in here too, because a tool appearing is
          itself something that happened.
        </p>
      </div>

      <div className="filters">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="filter"
            aria-pressed={filter === t.id}
            onClick={() => setFilter(t.id)}
          >
            {t.label} · {count(t.id)}
          </button>
        ))}
      </div>

      <div className="feed">
        {shown.length === 0 ? (
          <div className="quiet">
            {lines.length === 0
              ? "Nothing has happened yet. Ask your assistant to do something."
              : "Nothing in this category."}
          </div>
        ) : (
          shown.map((l) => <EventRow key={l.id} line={l} />)
        )}
      </div>

      <TechToggle />
    </div>
  );
}
