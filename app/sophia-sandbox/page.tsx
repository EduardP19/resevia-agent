import type { Metadata } from "next";
import SophiaSandboxPageClient from "./SophiaSandboxPageClient";

export const metadata: Metadata = {
  title: "Agent Sandbox | Resevia",
  robots: {
    index: false,
    follow: false,
  },
};

export default function SophiaSandboxPage() {
  return <SophiaSandboxPageClient />;
}
