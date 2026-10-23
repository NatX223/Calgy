import type { Metadata } from "next";
import { SpendApp } from "@/components/spend/SpendApp";

export const metadata: Metadata = { title: "Calgy" };

export default function SpendPage() {
  return <SpendApp />;
}
