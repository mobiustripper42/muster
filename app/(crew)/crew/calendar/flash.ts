/** Short-lived carrier for the just-minted plaintext calendar token (#355, DEC-098)
 *  — the show-once channel between `mintCalendarFeed` and the page. Kept out of the
 *  `"use server"` actions module (which may export only async functions) so both the
 *  action and the page can import it. */
export const FLASH_COOKIE = "muster_calendar_flash";
