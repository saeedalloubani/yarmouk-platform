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
// D81 Item 4 — ICON-ONLY render. Button label is now an inline Bell SVG
// (lucide-style geometry, hand-coded, no new dep). Path Z escape chain
// UNCHANGED — only the button's INNER content changed (text label →
// SVG element); form attributes, onsubmit gate, JSON.stringify wrap, and
// htmlAttrEscape on the action URL all stay byte-identical to D79.
//
// Accessibility:
//   - aria-label embeds the refCode so screen readers read action +
//     target ("Send reminder to OFF-JOR-03"). refCode flows through the
//     same htmlAttrEscape helper used for safeId — single source of
//     truth for HTML-attribute escaping.
//   - title attribute supplies the hover tooltip for the compact icon —
//     keeps the affordance discoverable without leaning on aria-label
//     (screen readers announce it, browsers don't display it).
//   - w-8 h-8 (32×32) hit target meets WCAG 2.5.5 minimum.
//   - aria-hidden + focusable=false on the inner <svg> so the icon
//     doesn't become its own SR target / tab stop alongside the button.
//
// Visual: btn-secondary background with the SVG centered. Sits beside
// the Resend (RotateCw) + Revoke (Trash2) icons (FLAG B coexistence,
// D81 icon-bar treatment) so the three buttons read distinctly by
// symbol rather than by text density.

function htmlAttrEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Bell icon (lucide "Bell" geometry, 24×24 viewBox, hand-coded inline).
// currentColor inherits the button's text color; stroke-width=2 matches
// the Resend / Revoke icons for visual rhythm across the action bar.
const BELL_SVG =
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">` +
  `<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>` +
  `<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>` +
  `</svg>`;

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
  // refCode lives inside the double-quoted aria-label attribute; the same
  // htmlAttrEscape helper handles quote / ampersand / bracket entities.
  const safeAriaLabel = htmlAttrEscape(`Send reminder to ${refCode}`);

  const html =
    `<form method="POST" action="/admin/invitations/${safeId}/send-reminder" ` +
    `style="display:inline" ` +
    `onsubmit='${onsubmitAttr}'>` +
    `<button type="submit" ` +
    `class="btn-secondary inline-flex items-center justify-center w-8 h-8 p-0" ` +
    `aria-label="${safeAriaLabel}" title="Send reminder">` +
    `${BELL_SVG}` +
    `</button>` +
    `</form>`;

  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
