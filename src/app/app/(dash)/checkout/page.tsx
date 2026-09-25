import { Placeholder } from "@/components/dash/placeholder";

export const metadata = { title: "Checkout · Tender" };

export default function CheckoutPage() {
  return (
    <Placeholder
      eyebrow="Get paid"
      title="Checkout"
      description="Create an invoice, hand the buyer a link, and watch it settle."
      building={[
        "Create an invoice: amount, currency, order reference, chains accepted",
        "A pay link and QR the buyer can open on any phone",
        "Live status as the payment moves from detected to settled",
      ]}
    />
  );
}
