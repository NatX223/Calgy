import type { Metadata } from "next";
import { EmailLinkView } from "./EmailLinkView";

export const metadata: Metadata = { title: "Calgy · Saving to your account" };

export default function EmailLinkPage() {
  return <EmailLinkView />;
}
