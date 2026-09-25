import { Placeholder } from "@/components/dash/placeholder";

export const metadata = { title: "Earn · Tender" };

export default function EarnPage() {
  return (
    <Placeholder
      eyebrow="Treasury"
      title="Earn"
      description="Settled revenue put to work on Monad, without a second transaction."
      building={[
        "Protocol positions, with live rates and what you have deposited",
        "Deposit settled revenue into a position",
        "Route new payments straight into a position as they land",
      ]}
    />
  );
}
