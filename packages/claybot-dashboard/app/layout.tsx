import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "ClayBot Dashboard",
  description: "Live status for plugins, agents, and cron tasks from the local engine socket."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
