import { Placeholder } from "@/components/dash/placeholder";

export const metadata = { title: "Ask · Tender" };

export default function AskPage() {
  return (
    <Placeholder
      eyebrow="Query"
      title="Ask"
      description="Ask a plain question about your own payments."
      building={[
        "Questions like: how much did I take last week?",
        "Answers drawn from your payments, never invented",
      ]}
    />
  );
}
