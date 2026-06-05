// components/SendReminderButton.tsx
//
// D79 Feature 3 — manual-reminder trigger button. Used by /admin and
// /admin/invitations row actions.
//
// SERVER COMPONENT (no "use client") — emits a native HTML <form> with an
// inline `onsubmit="return confirm(...)"` gate (Path Z LOCKED by D79
// brief — no React state, no client component, no modal). React doesn't
// natively render lowercase `onsubmit` as an inline HTML event attribute
// (it expects camelCase event-handler functions), so we emit the form
// via dangerouslySetInnerHTML.
//
// Inputs are escaped for safe embedding into BOTH the HTML attribute
// context AND the inner JavaScript string literal:
//   - invitationId is a UUID at the call site; we HTML-escape defensively
//     before interpolation into the action URL.
//   - refCode is alphanumeric+hyphen by convention (OFF-JOR-02 etc.) but
//     we JSON.stringify the user-visible string so any quote/backslash
//     would be JS-escaped, then HTML-escape the resulting attribute
//     value so it embeds into a single-quoted attribute cleanly.
//
// Visual: btn-secondary (lighter weight than btn-primary). Sits beside
// the existing btn-ghost "Resend" button (FLAG B coexistence) so the
// two buttons read distinctly — Resend = aggressive (rotates credentials),
// Send reminder = lighter nudge (reuses existing link).

function htmlAttrEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default function SendReminderButton({
  invitationId,
  refCode,
}: {
  invitationId: string;
  refCode: string;
}) {
  // JSON.stringify produces a double-quoted JS string literal with all
  // JS escapes correct (backslashes, control chars, embedded quotes).
  // We embed that literal as the argument to confirm().
  const jsConfirm = JSON.stringify(
    `Send reminder to ${refCode}? They will receive a fresh email.`
  );
  // Use single-quoted HTML attribute so JSON.stringify's double quotes
  // don't collide. Escape any single-quote inside the resulting attribute
  // value to its HTML entity so the attribute remains well-formed.
  const onsubmitAttr = `return confirm(${jsConfirm})`.replace(/'/g, "&#39;");
  const safeId = htmlAttrEscape(invitationId);

  const html =
    `<form method="POST" action="/admin/invitations/${safeId}/send-reminder" ` +
    `style="display:inline" ` +
    `onsubmit='${onsubmitAttr}'>` +
    `<button type="submit" class="btn-secondary text-[12px]">Send reminder</button>` +
    `</form>`;

  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
