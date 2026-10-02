/**
 * The `intent` the child-card buttons post when no JS handles them: the `ChildCards` island renders
 * them, and `signWaiver` acts on them. One spelling for both sides, so a rename cannot leave the
 * no-JS path silently doing nothing. A plain module: a value exported from a `"use client"` file
 * reaches a server action as a client reference, not as the string.
 */
export const ADD_CHILD = "add-child";
/** Followed by the card's position, from 0: `remove-child-2`. */
export const REMOVE_CHILD = "remove-child-";
