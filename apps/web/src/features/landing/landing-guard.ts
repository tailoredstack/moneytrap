import { redirect } from "@tanstack/react-router";

// The landing route calls this before it renders. A signed-in visitor goes straight to the overview.
export async function redirectSignedInVisitor(isSignedIn: () => Promise<boolean>): Promise<void> {
  if (await isSignedIn()) throw redirect({ href: "/overview" });
}
