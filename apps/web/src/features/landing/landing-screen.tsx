import { Button } from "@moneytrap/ui";

// Public page at "/". Signed-in users are sent to /overview before this renders, so it only shows to signed-out visitors.
const publisherPoints = [
  "Find affiliate programs you are permitted to promote.",
  "Create tracked links for your websites and keep them in one place.",
  "See attributed earnings, with the time they were last updated.",
  "See your balance and when it reaches the payout threshold.",
];

const advertiserPoints = [
  "See the clicks your programs receive, by property and link.",
  "Review attributed transactions and adjustments from the connected network.",
  "Every figure shows when it was last refreshed, so stale data is labelled.",
];

const features = [
  "Link management for every connected program",
  "Click reports with cursor pagination",
  "Statements that trace each amount to its source transaction",
  "Team members, roles, and invitations",
  "Two-factor sign-in and session management",
];

export function LandingScreen() {
  return (
    <div className="mx-auto max-w-3xl space-y-12">
      <section className="space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          One place for affiliate links, earnings, and payouts
        </h1>
        <p className="text-base text-muted-foreground">
          Moneytrap helps websites and editorial blogs work with affiliate networks from one account. It records
          attributed transactions and shows what is owed, so publishers see their earnings and advertisers see the
          traffic their programs receive.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild>
            <a href="/register">Sign up</a>
          </Button>
          <Button asChild variant="outline">
            <a href="/login">Sign in</a>
          </Button>
        </div>
      </section>

      <section aria-labelledby="landing-publishers" className="space-y-3">
        <h2 id="landing-publishers" className="text-xl font-semibold">
          For publishers
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {publisherPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="landing-advertisers" className="space-y-3">
        <h2 id="landing-advertisers" className="text-xl font-semibold">
          For advertisers
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {advertiserPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="landing-features" className="space-y-3">
        <h2 id="landing-features" className="text-xl font-semibold">
          Main features
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {features.map((feature) => (
            <li key={feature} className="rounded-md border p-4 text-sm">
              {feature}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
