import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
