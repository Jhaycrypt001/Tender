import { Placeholder } from "@/components/dash/placeholder";

export const metadata = { title: "Payout · Tender" };

export default function PayoutPage() {
  return (
    <Placeholder
      eyebrow="Pay · Payout"
      title="Pay someone"
      description="Send settled revenue to a supplier, a contractor or your own wallet."
      building={[
        "Amount, destination and chain",
        "Paid from settled revenue, so the balance is checked first",
      ]}
    />
  );
}
