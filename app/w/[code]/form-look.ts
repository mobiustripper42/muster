import { fieldClass } from "../../../components/ui/input";

/**
 * The signing form's card and select look, shared by the server-rendered form and the child-card
 * island. Text fields are `<Input>` (issue #484); the card and the select move to shared
 * components in their own tasks, and this file goes with them.
 */
export const card = "flex flex-col gap-4 rounded-card border border-line bg-card p-4 shadow-sm";
export const select = fieldClass();
