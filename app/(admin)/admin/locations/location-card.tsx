"use client";

import { useState } from "react";
import type { Location } from "@core/domain/entities.js";
import { Field, settingsInputClass } from "../../../../components/admin/settings-field";

/**
 * The "Location" facts card — **controlled client fields (#699)**. Same reasoning as
 * `admin/vessels/vessel-card.tsx`: returning the refusal instead of redirecting is necessary and
 * not sufficient, because the post-action RSC refresh resets uncontrolled inputs on its own. The
 * value survives only if React holds it.
 *
 * The island is this card. The list and the read-only Offerings lookup stay server-rendered and
 * pass through the form as `children`.
 */
export function LocationCard({ location }: { location: Location | null }) {
  const [name, setName] = useState(location?.name ?? "");
  const [pickupDescription, setPickupDescription] = useState(location?.pickupDescription ?? "");
  const [pickupLink, setPickupLink] = useState(location?.pickupLink ?? "");
  const [routeDescription, setRouteDescription] = useState(location?.routeDescription ?? "");

  return (
    <section className="rounded-card border border-line bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Location</h2>
      </div>

      <div className="px-4 py-1">
        <Field label="Name">
          <input
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${settingsInputClass} w-full max-w-[420px]`}
          />
        </Field>

        <Field label="Pickup" sub="where guests meet the boat" align="start">
          <textarea
            name="pickupDescription"
            required
            value={pickupDescription}
            onChange={(e) => setPickupDescription(e.target.value)}
            className={`${settingsInputClass} min-h-[64px] w-full`}
          />
        </Field>

        <Field label="Pickup link" sub="map / directions">
          <input
            name="pickupLink"
            type="url"
            value={pickupLink}
            onChange={(e) => setPickupLink(e.target.value)}
            placeholder="https://maps.google.com/…"
            className={`${settingsInputClass} w-full max-w-[420px]`}
          />
        </Field>

        <Field label="Route" sub="where the trip goes" align="start">
          <textarea
            name="routeDescription"
            required
            value={routeDescription}
            onChange={(e) => setRouteDescription(e.target.value)}
            className={`${settingsInputClass} min-h-[64px] w-full`}
          />
        </Field>
      </div>
    </section>
  );
}
