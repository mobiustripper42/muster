/**
 * The signing form's card look, shared by the server-rendered form and the child-card island.
 * Text fields and selects are `<Input>` and `<Select>` (issue #484); the card moves to a shared
 * component in its own task, and this file goes with it.
 */
export const card = "flex flex-col gap-4 rounded-card border border-line bg-card p-4 shadow-sm";
