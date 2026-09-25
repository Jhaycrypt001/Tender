import { Placeholder } from "@/components/dash/placeholder";

export const metadata = { title: "Pay · Tender" };

export default function PayPage() {
  return (
    <Placeholder
      eyebrow="Outbound"
      title="Pay"
      description="Money going back out: refunds to buyers, payouts to suppliers, splits across a team."
      building={[
        "Refund a payment, linked to the invoice it came from",
        "Pay a supplier or contractor from settled revenue",
        "Split one payment across several addresses",
      ]}
    />
  );
}
