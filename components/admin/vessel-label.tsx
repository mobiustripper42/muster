import { vesselHueClass } from "../../app/lib/vessel-hue";

/**
 * A vessel's dot and name, the one drawing of "which boat" on the admin lists (All Shifts' rows and
 * Purchases' booking cards). The dot is the DEC-086 identity hue: same boat, same hue, always — it
 * answers "which boat", never state, so it is `aria-hidden` and the name is the accessible answer.
 */
export function VesselLabel({ id, hue, name }: { id: string; hue?: number | undefined; name: string }) {
  return (
    <span className="flex items-center gap-1.5 font-medium text-ink">
      <span
        aria-hidden="true"
        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${vesselHueClass(id, hue)}`}
      />
      {name}
    </span>
  );
}
