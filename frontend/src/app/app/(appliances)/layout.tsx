import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppliancesApp } from "@/components/appliances/AppliancesApp";

export const metadata: Metadata = { title: "Calgy · My Home" };

// One AppliancesApp instance spans /app/home and /app/simulator so the
// simulator's scratch copy survives switching tabs.
export default function AppliancesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppliancesApp />
      {children}
    </>
  );
}
