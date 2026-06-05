import type { ReactNode } from "react";

export const metadata = {
  title: "Muster",
  description: "Crew engine for small-passenger-vessel operators",
};

/** Root layout — the single shell over both surface groups (admin + crew). */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
