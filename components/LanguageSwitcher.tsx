"use client";

// components/LanguageSwitcher.tsx
//
// Client component: two-button language picker. Writes the
// yarmouk_lang cookie via a Server Action (lib/actions/setLang.ts),
// then triggers router.refresh() so Server Components re-render
// with the new lang.
//
// UX model:
//   - Optimistic: button active-state flips immediately on click,
//     before the Server Action completes. useTransition() gives us
//     a pending state we use to fade the inactive button.
//   - On Server Action failure: console.error + revert optimistic
//     state. Acceptable at thesis scale — no toast system yet.
//   - Clicking the already-active button is a no-op (button has the
//     native `disabled` attribute while it matches the active lang).
//     Inactive buttons are also disabled during a pending transition
//     to prevent rapid-fire double-clicks across both.
//
// IMPORTANT: optimisticLang intentionally does NOT track
// currentLang via useEffect. The only path that changes
// currentLang in 2b-2 is our own router.refresh() following a
// successful setLangAction; by the time the new prop arrives,
// optimisticLang already matches.
//
// If a future feature ever changes the lang cookie from outside
// this component (tab-sync mechanism, admin override, a redirect
// flow that calls setLang server-side), this assumption breaks
// and optimisticLang will diverge from currentLang silently. Add
// a useEffect(() => setOptimisticLang(currentLang), [currentLang])
// at that point — but only at that point.
//
// The label/sublabel strings are self-named per language — these
// are hardcoded, not translated (per the LANG_PICKER_LABELS rationale
// in lib/i18n.ts).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLangAction } from "@/lib/actions/setLang";
import type { Lang } from "@/lib/i18n";

export default function LanguageSwitcher({
  currentLang,
}: {
  currentLang: Lang;
}) {
  const router = useRouter();
  const [optimisticLang, setOptimisticLang] = useState<Lang>(currentLang);
  const [isPending, startTransition] = useTransition();

  const handleClick = (target: Lang) => {
    if (target === optimisticLang) return; // no-op on already-active
    setOptimisticLang(target);
    startTransition(async () => {
      try {
        await setLangAction(target);
        router.refresh();
      } catch (err) {
        console.error("[LanguageSwitcher] setLangAction failed", err);
        setOptimisticLang(currentLang); // revert
      }
    });
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <LangButton
        active={optimisticLang === "en"}
        pending={isPending}
        onClick={() => handleClick("en")}
        label="English"
        sublabel="Latin script · left-to-right"
      />
      <LangButton
        active={optimisticLang === "ar"}
        pending={isPending}
        onClick={() => handleClick("ar")}
        label="العربية"
        sublabel="نص عربي · من اليمين إلى اليسار"
        arabic
      />
    </div>
  );
}

function LangButton({
  active,
  pending,
  onClick,
  label,
  sublabel,
  arabic,
}: {
  active: boolean;
  pending: boolean;
  onClick: () => void;
  label: string;
  sublabel: string;
  arabic?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={active || pending}
      className={`text-start p-4 rounded-lg border-2 transition-all ${
        active
          ? "border-brand-600 bg-brand-50 cursor-default"
          : pending
          ? "border-line bg-white opacity-60 cursor-wait"
          : "border-line bg-white hover:border-lineStrong cursor-pointer"
      }`}
    >
      <div
        className={`text-[18px] font-semibold ${
          active ? "text-brand-800" : "text-ink"
        } ${arabic ? "font-arabic" : ""}`}
      >
        {label}
      </div>
      <div
        className={`text-[12px] mt-1 ${
          active ? "text-brand-700" : "text-muted"
        } ${arabic ? "font-arabic" : ""}`}
      >
        {sublabel}
      </div>
    </button>
  );
}
