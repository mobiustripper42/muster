/**
 * The signing form's look, shared by the server-rendered form and the child-card island: fields
 * are darker wells on a white card (the recover-link page, the admin settings forms). Hand-rolled
 * here because no shared form component exists yet — issue #484.
 */
export const card = "flex flex-col gap-4 rounded-card border border-line bg-card p-4 shadow-sm";
export const input = "min-h-[48px] w-full rounded-card border border-line bg-bg px-3 text-ink";
export const select = "min-h-[48px] rounded-card border border-line bg-bg px-2 text-ink";
