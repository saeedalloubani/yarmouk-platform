// app/(public)/page.tsx
//
// Public landing — variant chooser. Branches on getSession():
//   - null  → LandingNoSession (marketing-style courtesy page)
//   - valid → LandingInvited (mock-faithful single-language flow)
//
// Both variants are Server Components; the branch happens server-
// side, no client switching, no flash of wrong content.

import { getSession } from "@/lib/cookies";
import LandingInvited from "@/components/LandingInvited";
import LandingNoSession from "@/components/LandingNoSession";

export const dynamic = "force-dynamic";

export default async function PublicLanding() {
  const session = await getSession();
  return session ? (
    <LandingInvited session={session} />
  ) : (
    <LandingNoSession />
  );
}
