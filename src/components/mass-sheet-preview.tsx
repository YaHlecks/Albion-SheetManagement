/**
 * Live spreadsheet preview for the admin builder (§12). Pure render from
 * PartyDraft[] — updates immediately as the admin edits parties/slots.
 * Mirrors the member view's structure so "what you preview is what fills".
 */
import type { PartyDraft } from "@/lib/mass";
import { Badge } from "@/components/ui";

export function MassSheetPreview({ title, location, setName, massAtLabel, parties }: {
  title: string;
  location?: string;
  setName?: string;
  massAtLabel?: string;
  parties: PartyDraft[];
}) {
  return (
    <div className="panel p-0">
      <div className="border-b border-line-strong px-3 py-2">
        <div className="font-display font-semibold text-ink">{title || "Untitled mass"}</div>
        <div className="text-xs text-faint">
          {location && <>MASS LOCATION: {location} · </>}
          {setName && <>SET: {setName}{massAtLabel ? " · " : ""}</>}
          {massAtLabel && <>MASSING TIME: {massAtLabel}</>}
        </div>
      </div>
      {parties.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted">
          No parties yet — add one to start building the sheet.
        </p>
      ) : (
        <div className="grid gap-px bg-line md:grid-cols-2 xl:grid-cols-3">
          {parties.map((party, pi) => (
            <div key={pi} className="p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="section-title">{party.name || `Party ${pi + 1}`}</span>
                {party.fill_note && <Badge status="pending">★ {party.fill_note}</Badge>}
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-faint">
                    <th className="pb-1 font-semibold">Role</th>
                    <th className="pb-1 font-semibold">Build</th>
                    <th className="pb-1 font-semibold">IGN</th>
                  </tr>
                </thead>
                <tbody>
                  {party.slots.length === 0 && (
                    <tr><td colSpan={3} className="pb-2 text-faint">No slots</td></tr>
                  )}
                  {party.slots.map((slot, si) => (
                    <tr key={si} className={si % 2 === 1 ? "bg-elevated/40" : undefined}>
                      <td className="py-0.5 pr-2 font-medium">{slot.role}</td>
                      <td className="py-0.5 pr-2 font-mono">{slot.build_name}</td>
                      <td className="py-0.5 text-faint">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
