import type { Metadata } from "next";
import { SolarApp } from "@/components/solar/SolarApp";

export const metadata: Metadata = { title: "Calgy · Go solar?" };

export default function SolarPage() {
  return <SolarApp />;
}
