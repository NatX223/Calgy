import type { Metadata } from "next";
import { ReminderSettings } from "@/components/settings/ReminderSettings";

export const metadata: Metadata = { title: "Calgy · Reminders" };

export default function Page() {
  return <ReminderSettings />;
}
