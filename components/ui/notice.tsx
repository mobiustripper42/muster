import type React from "react";

export function Notice({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "ok" | "bad" | "warn";
}) {
  const cls =
    tone === "ok"
      ? "border-ok-line bg-ok-bg text-ok"
      : tone === "bad"
        ? "border-bad-line bg-bad-bg text-bad"
        : tone === "warn"
          ? "border-warn-line bg-warn-bg text-warn"
          : "border-line bg-card text-muted";
  return (
    <div className={`rounded-card border px-4 py-3 text-sm ${cls}`}>{children}</div>
  );
}
