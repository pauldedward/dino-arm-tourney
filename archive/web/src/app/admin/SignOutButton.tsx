"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";

export default function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        const supa = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
        await supa.auth.signOut();
        router.push("/login");
        router.refresh();
      }}
      className="border border-bone/30 px-2 py-1 hover:border-volt hover:text-volt"
    >
      Sign out
    </button>
  );
}
