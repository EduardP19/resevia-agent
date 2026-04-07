import type { Metadata } from "next";
import TestUiPageClient from "./TestUiPageClient";

export const metadata: Metadata = {
  title: "Test UI | Resevia",
  robots: {
    index: false,
    follow: false,
  },
};

export default function TestUiPage() {
  return <TestUiPageClient />;
}
