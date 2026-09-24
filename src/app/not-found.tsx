import Button from "@/components/button";

export default function NotFound() {
  return (
    <section className="flex min-h-[70vh] items-center justify-center px-6 py-32">
      <div className="text-center">
        <p className="font-display text-sand text-2xl">404</p>
        <h1 className="mt-4 text-balance">This page doesn&rsquo;t exist</h1>
        <p className="mx-auto mt-5 max-w-[42ch] text-pretty text-ink/70">
          The link may be out of date, or the page may have moved.
        </p>
        <div className="mt-9 flex justify-center">
          <Button href="/">Back to home</Button>
        </div>
      </div>
    </section>
  );
}
