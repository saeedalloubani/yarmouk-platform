// app/admin/unauthorized/page.tsx
//
// Shown to a user who authenticated successfully but whose email isn't an
// active admin (the (protected) layout redirects here). UNGUARDED — it must
// sit outside (protected) or it would redirect-loop. Offers sign-out so they
// can leave the wrong account.

import { signOut } from "@/lib/actions/auth";

export default function AdminUnauthorizedPage() {
  return (
    <main className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="max-w-sm w-full text-center">
        <div className="eyebrow mb-3">Researcher Access</div>
        <h1 className="text-[20px] font-semibold text-ink mb-3">
          Not authorized
        </h1>
        <p className="text-[14px] text-muted-strong leading-relaxed mb-8">
          You&rsquo;re signed in, but this account isn&rsquo;t authorized for
          the admin area. If you believe this is an error, contact the
          researcher.
        </p>
        <form action={signOut}>
          <button type="submit" className="btn-secondary">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
