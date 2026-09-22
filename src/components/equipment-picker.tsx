"use client";

/**
 * Albion equipment browser: category → family → search over the catalog in
 * the database (debounced, server-side ilike). Covers the full taxonomy —
 * Weapon, Head, Chest, Feet, Off-Hand, Mount (incl. battle mounts), Cape,
 * Bag — with a permanent free-text escape hatch so group shorthand
 * ("SOB / ICICLE") never has to exist in the catalog.
 *
 * It never recommends or overrides — the admin picks.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase-browser";
import { EQUIPMENT_CATEGORIES, TIER_OPTIONS } from "@/lib/events";

export interface EquipmentRow {
  id: string;
  name: string;
  category: string;
  family: string;
  tier: string;
  icon_url: string | null;
}

export function EquipmentPicker({ onPick, onClose }: {
  onPick: (category: string, name: string, tierRequirement: string) => void;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [family, setFamily] = useState("all");
  const [rows, setRows] = useState<EquipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [customCategory, setCustomCategory] = useState("Weapon");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [families, setFamilies] = useState<string[]>([]);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("albion_equipment")
        .select("category, family")
        .eq("active", true)
        .limit(1000);
      const fams = new Set<string>();
      for (const r of data ?? []) {
        if (category === "all" || r.category === category) fams.add(r.family);
      }
      setFamilies([...fams].sort());
    })();
  }, [supabase, category]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(null);
        let q = supabase
          .from("albion_equipment")
          .select("id, name, category, family, tier, icon_url")
          .eq("active", true)
          .order("name")
          .limit(50);
        if (query.trim()) q = q.ilike("name", `%${query.trim()}%`);
        if (category !== "all") q = q.eq("category", category);
        if (family !== "all") q = q.eq("family", family);
        const { data, error: err } = await q;
        if (err) setError("Could not load the equipment catalog.");
        else setRows((data ?? []) as EquipmentRow[]);
        setLoading(false);
      })();
    }, 220);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [supabase, query, category, family]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          className="field sm:flex-1"
          placeholder="Search equipment… (mace, chariot, guardian)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          aria-label="Search equipment"
        />
        <select className="field sm:w-40" value={category} onChange={(e) => { setCategory(e.target.value); setFamily("all"); }} aria-label="Category">
          <option value="all">All categories</option>
          {EQUIPMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="field sm:w-48" value={family} onChange={(e) => setFamily(e.target.value)} aria-label="Family">
          <option value="all">All families</option>
          {families.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      <div className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line-strong">
        {loading && <p className="p-4 text-sm text-muted">Searching…</p>}
        {error && <p className="p-4 text-sm text-danger" role="alert">{error}</p>}
        {!loading && !error && rows.length === 0 && (
          <p className="p-4 text-sm text-muted">
            No matches. Use the custom entry below — group shorthand like
            &quot;HvyMace (Guardian)&quot; doesn&apos;t need to be a catalog item.
          </p>
        )}
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-3 p-2.5">
            {row.icon_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.icon_url} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded bg-elevated" loading="lazy" />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-elevated text-xs text-faint">?</span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{row.name}</p>
              <p className="text-xs text-faint">{row.category} · {row.family}</p>
            </div>
            <select
              className="field h-8 w-24 text-xs"
              defaultValue="any"
              aria-label={`Tier requirement for ${row.name}`}
              onChange={(e) => {
                onPick(row.category, row.name, e.target.value);
                onClose();
              }}
            >
              {TIER_OPTIONS.map((t) => <option key={t} value={t}>{t === "any" ? "Any tier" : t}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-dashed border-line-strong p-3">
        <label htmlFor="custom-build" className="field-label">Custom entry / group shorthand</label>
        <div className="flex flex-wrap gap-2">
          <select className="field w-32" value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} aria-label="Custom category">
            {EQUIPMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            id="custom-build"
            className="field min-w-0 flex-1"
            placeholder="e.g. HvyMace (Guardian), SOB/ICICLE…"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            maxLength={80}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={custom.trim().length < 2}
            onClick={() => {
              onPick(customCategory, custom.trim(), "any");
              onClose();
            }}
          >
            Use
          </button>
        </div>
      </div>
    </div>
  );
}
