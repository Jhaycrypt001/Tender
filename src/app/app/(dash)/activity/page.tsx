import { Placeholder } from "@/components/dash/placeholder";

export const metadata = { title: "Activity · Tender" };

export default function ActivityPage() {
  return (
    <Placeholder
      eyebrow="Ledger"
      title="Activity"
      description="Every payment and every state it has moved through."
      building={[
        "Filter by state: paid, pending, underpaid, needs recovery",
        "Payment detail with the full state history",
        "Retry or withdraw a payment whose settlement failed",
      ]}
    />
  );
}
