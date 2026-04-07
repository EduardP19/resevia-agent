import type { Metadata } from "next";
import TestUiPageClient from "../test-ui/TestUiPageClient";

export const metadata: Metadata = {
  title: "Sophia Sandbox | Resevia",
  robots: {
    index: false,
    follow: false,
  },
};

export default function SophiaSandboxPage() {
  return <TestUiPageClient />;
}
