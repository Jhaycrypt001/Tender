import { Placeholder } from "@/components/dash/placeholder";

export const metadata = { title: "Refund · Tender" };

export default function RefundPage() {
  return (
    <Placeholder
      eyebrow="Pay · Refund"
      title="Refund a payment"
      description="Return a settled payment to the buyer who made it."
      building={[
        "Pick the payment to refund, rather than typing an address",
        "Full or partial amount",
        "The refund stays linked to the original invoice",
      ]}
    />
  );
}
