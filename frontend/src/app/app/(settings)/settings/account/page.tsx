import type { Metadata } from "next";
import { AccountSettings } from "@/components/settings/AccountSettings";

export const metadata: Metadata = { title: "Calgy · Account" };

export default function Page() {
  return <AccountSettings />;
}
