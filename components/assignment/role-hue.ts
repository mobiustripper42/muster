/**
 * DEC-086 role identity hues — one shared map so the cockpit seat-card glyph
 * and the board's filled pips speak the same color language: a captain-blue /
 * mate-teal square means "a person of that role, aboard." Literal classes for
 * Tailwind's scanner; an unknown role falls to neutral, never a status tone.
 */
export const ROLE_HUE: Record<string, string> = {
  captain: "bg-captain",
  mate: "bg-mate",
};

export function roleHueClass(roleName: string): string {
  return ROLE_HUE[roleName.toLowerCase()] ?? "bg-muted";
}
