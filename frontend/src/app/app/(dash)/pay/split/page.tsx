import { Placeholder } from "@/components/dash/placeholder";

export const metadata = { title: "Split · Tender" };

export default function SplitPage() {
  return (
    <Placeholder
      eyebrow="Pay · Split"
      title="Split a payment"
      description="Divide one amount across several addresses in a single flow."
      building={[
        "Add recipients with a share each, by percentage or amount",
        "Shares are checked to total the whole amount before anything sends",
      ]}
    />
  );
}
