// lib/email/templates/render.ts
//
// D22 + Stage 2 — pure email template renderer. NO I/O, NO env reads,
// NO side effects. Given a ResolvedTemplate (defaults already merged
// in by the caller) and runtime values, returns { subject, text, html }
// ready for resend.emails.send.
//
// THE LOAD-BEARING DESIGN — "Sura can't accidentally ship an email
// without a working sign-in link":
//
//   The button URL is NEVER a placeholder Sura can put in (or take out
//   of) her body text. The renderer ALWAYS emits a <a href="…"> button
//   in the email HTML. The button's `href` is the system-owned
//   values.button_href — passed by the caller; the editor surface
//   never sees it. The button's LABEL is the section the spec marks
//   as `buttonSection` (always 'cta' today). Removing the link from
//   the email is structurally impossible from the editor; the worst
//   Sura can do is replace the label with an empty string, which fails
//   validation (every declared section is min-length 1).
//
// LAYOUT — driven by spec.placement, NOT hard-coded per template:
//
//   Sections marked placement='lead' render above the button (no
//   divider). Sections marked placement='fine' render below the
//   button after a divider. The button itself renders at the end of
//   the lead block. If a spec declares NO fine sections (submission),
//   the divider is OMITTED entirely.
//
//   Per-paragraph typography rule (uniform across all templates so the
//   chrome stays branded):
//
//     lead (non-last) :  margin 0 0 16px / 16 / introLh / #33322f
//     lead (last)     :  margin 0 0 26px / 16 / introLh / #33322f
//     button          :  margin 0 0 28px (button is inline-block, blue)
//     fine (first)    :  margin 0         / 13 / fineLh / #8a8982
//     fine (middle)   :  margin 4px 0 0   / 13 / fineLh / #8a8982
//     fine (last)     :  margin 12px 0 0  / 14 / fineLh / #5f5e59
//
//   Invitation's existing rendered output is BYTE-EQUIVALENT under
//   this rule: intro is the only-and-last lead → 26px, personal is
//   first-fine → 0, expiry middle-fine → 4px top, contact last-fine →
//   12px top + 14px font + #5f5e59 (matches pre-Stage-2 render.ts:
//   292-302 character for character). Admin-invite gains +1px on lead
//   paragraphs and -2px on the greeting margin vs its pre-Stage-2
//   bespoke shell — accepted as brand-unification (D22 Stage 2 note).
//
// VALIDATION pipeline (called by save AND test-send — same rules):
//   1. Each section the spec declares must be a non-empty string.
//   2. Any {token} appearing in a section must be in the per-section
//      `allowedPlaceholders` allowlist. A typo or stray placeholder
//      is rejected with the offending token in the error message.
//   3. Each section's `requiredPlaceholders` list must all be present.
//      Removing a load-bearing placeholder (e.g. {expiry_date} from
//      invitation's expiry section) is rejected.
//
// ESCAPE-AND-INTERPOLATE order (HTML safety):
//   1. HTML-escape the editable text (which contains {placeholder} tokens
//      — {} aren't HTML-special, so they survive untouched).
//   2. HTML-escape each placeholder VALUE separately.
//   3. Substitute escaped values into the escaped section text.
//   4. For sections in spec.linkify only: post-pass linkifies any email
//      or international phone number. AR locale gets dir="ltr" +
//      unicode-bidi:isolate spans on the linkified atoms so Latin/digit
//      runs don't reorder inside the RTL paragraph (matches the
//      pre-Stage-2 contact-line behavior).
//
// PLAIN TEXT: no escape, no linkification, no HTML — just interpolate
// and join with "\n\n" between lead sections, then `${cta}:\n${href}`,
// then (if fine non-empty) "\n\n" + fine sections joined consecutively
// with a blank line before the LAST fine section. Pre-Stage-2 plain-
// text output for invitation + admin-invite is byte-equivalent under
// this rule.

import { TEMPLATE_SPECS } from "./types";
import type {
  PlaceholderToken,
  ResolvedTemplate,
  RuntimeValues,
  SectionKey,
  TemplateId,
  TemplateSpec,
} from "./types";
import type { Lang } from "@/lib/i18n";

// ============================================================================
// Validation
// ============================================================================

export type ValidationIssue = {
  section: SectionKey;
  message: string;
  /** The offending token (without braces), if the issue is placeholder-shaped. */
  token?: string;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; issues: ValidationIssue[] };

const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Validate one locale's sections against the template spec. Only walks
 *  the sections the spec declares — extra keys in the input map are
 *  ignored (defensive against stale rows). */
export function validateSections(
  spec: TemplateSpec,
  sections: Partial<Record<SectionKey, string>>
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Template-wide "known" set — the union of every section's allowed
  // placeholders. Used to distinguish two distinct error cases:
  //   - token NOT in this set        → truly unknown ("{foo}" — typo)
  //   - token IN this set but not in
  //     allowed[key]                  → wrong section (real placeholder,
  //                                     placed somewhere that doesn't accept it)
  // Without this distinction, a misplaced {expiry_date} surfaces as
  // "unknown placeholder {expiry_date}", which is misleading.
  const knownTokens = new Set<string>();
  for (const k of spec.sections) {
    for (const p of spec.allowedPlaceholders[k]) knownTokens.add(p);
  }

  for (const key of spec.sections) {
    const raw = sections[key];
    if (typeof raw !== "string" || raw.trim().length === 0) {
      issues.push({
        section: key,
        message: `The "${key}" section is required and cannot be empty.`,
      });
      continue;
    }

    // 1. Allowlist check — every {token} must be in allowedPlaceholders[key].
    const allowed = new Set<string>(spec.allowedPlaceholders[key]);
    const allowedHere = spec.allowedPlaceholders[key];
    const allowedHereSuffix =
      allowedHere.length === 0
        ? "This section does not accept placeholders."
        : `Allowed here: ${allowedHere.map((t) => `{${t}}`).join(", ")}.`;

    const found = new Set<string>();
    for (const match of raw.matchAll(PLACEHOLDER_RE)) {
      const token = match[1];
      found.add(token);
      if (!allowed.has(token)) {
        const knownButWrongSection = knownTokens.has(token);
        issues.push({
          section: key,
          token,
          message: knownButWrongSection
            ? `"{${token}}" is a real placeholder, but it is not allowed in the "${key}" section. ${allowedHereSuffix}`
            : `"${key}" contains unknown placeholder "{${token}}". ${allowedHereSuffix}`,
        });
      }
    }

    // 2. Required-placeholder check.
    for (const required of spec.requiredPlaceholders[key]) {
      if (!found.has(required)) {
        issues.push({
          section: key,
          token: required,
          message: `"${key}" must contain "{${required}}".`,
        });
      }
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

// ============================================================================
// HTML escape + interpolate
// ============================================================================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Substitute {token} → value in text. If a token is in the allowlist but
 *  the caller didn't supply a value (e.g. {name} when name is undefined),
 *  the token is left intact rather than rendering "{name}" or empty — the
 *  spec's required-placeholder rule is what guards against missing
 *  load-bearing values at save time, so this is just defensive. */
function interpolate(
  text: string,
  values: Record<string, string | undefined>
): string {
  return text.replace(PLACEHOLDER_RE, (whole, token: string) => {
    const v = values[token];
    return typeof v === "string" ? v : whole;
  });
}

/** Build the per-token value map from RuntimeValues. Only the whitelisted
 *  tokens are exposed (button_href is NEVER a placeholder). */
function valuesFor(
  values: RuntimeValues
): Record<PlaceholderToken, string | undefined> {
  return {
    name: values.name,
    expiry_date: values.expiry_date,
    ref_code: values.ref_code,
  };
}

// ============================================================================
// Linkification (HTML)
// ============================================================================

// Match an email address (LATIN local-part + domain — covers the contact
// addresses Sura will use). Applied per-section per spec.linkify.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Match an international phone number: + followed by digits and
// optional spaces/dashes. Anchored to start with +Digit so plain dates
// or numbers in the contact line aren't accidentally linkified.
const PHONE_RE = /\+\d[\d\s-]{6,}\d/g;

/** Linkify the (already-escaped) section HTML. In AR (`isAr`), the
 *  anchor gets dir="ltr" + unicode-bidi:isolate so the Latin/digit run
 *  doesn't reorder inside the RTL paragraph — mirrors the pre-Stage-2
 *  contact-line behavior. */
function linkifyAtoms(escapedHtml: string, isAr: boolean): string {
  const ltrAttrs = isAr
    ? ` dir="ltr" style="unicode-bidi:isolate;color:#185FA5;text-decoration:none"`
    : ` style="color:#185FA5;text-decoration:none"`;

  return escapedHtml
    .replace(EMAIL_RE, (addr) => {
      // The matched address contains no HTML-special chars (regex by
      // construction), so it's already escape-safe; use it verbatim in
      // href + text.
      return `<a href="mailto:${addr}"${ltrAttrs}>${addr}</a>`;
    })
    .replace(PHONE_RE, (raw) => {
      // tel: needs digits only — strip spaces + dashes, keep the +.
      const tel = raw.replace(/[\s-]/g, "");
      return `<a href="${tel}"${ltrAttrs}>${raw}</a>`;
    });
}

// ============================================================================
// Renderer
// ============================================================================

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

/** Render a template into subject + text + html. The HTML shell (white
 *  card, blue button, divider when fine sections exist) is uniform
 *  across all templates; the per-template variation is purely:
 *    - which sections appear (spec.sections)
 *    - which side of the button each lives on (spec.placement)
 *    - which is the button LABEL (spec.buttonSection)
 *    - which get email/phone linkification (spec.linkify)
 *
 *  button_href is system-owned (values.button_href) — NEVER an editable
 *  placeholder. The editor surface cannot break the link.
 */
export function renderEmailTemplate(args: {
  template: ResolvedTemplate;
  values: RuntimeValues;
}): RenderedEmail {
  const { template, values } = args;
  const spec = TEMPLATE_SPECS[template.id];
  if (!spec) {
    throw new Error(`renderEmailTemplate: no spec for template id "${template.id}"`);
  }
  const { sections, subject, lang } = template;
  const isAr = lang === "ar";
  const dir: "rtl" | "ltr" = isAr ? "rtl" : "ltr";
  const introLh = isAr ? "1.85" : "1.7";
  const fineLh = isAr ? "1.7" : "1.6";

  // Partition declared sections into lead (above button) and fine
  // (below divider). The button section itself is handled separately;
  // it is NOT a regular paragraph.
  const leadKeys: SectionKey[] = [];
  const fineKeys: SectionKey[] = [];
  for (const k of spec.sections) {
    if (k === spec.buttonSection) continue;
    if (spec.placement[k] === "lead") leadKeys.push(k);
    else fineKeys.push(k);
  }
  const linkifySet = new Set<SectionKey>(spec.linkify);

  // Per-token value maps.
  const tokenValues = valuesFor(values);
  const tokenValuesEscaped: Record<string, string | undefined> = {};
  for (const k of Object.keys(tokenValues) as PlaceholderToken[]) {
    const v = tokenValues[k];
    tokenValuesEscaped[k] = typeof v === "string" ? escapeHtml(v) : undefined;
  }

  // Section accessor with a defensive guard. validateSections (called by
  // save + test-send) guarantees every spec.sections key is a non-empty
  // string; this is belt-and-suspenders against a hand-edited row that
  // bypassed the action layer.
  function sectionText(key: SectionKey): string {
    const v = sections[key];
    if (typeof v !== "string") {
      throw new Error(
        `renderEmailTemplate: section "${key}" missing for template "${template.id}"`
      );
    }
    return v;
  }

  // ---- plain text -------------------------------------------------------
  // Pattern: leadNonCta joined by "\n\n", blank, "${cta}:\n${href}",
  // (if fine non-empty) blank, fineSections joined consecutively with a
  // blank line BEFORE the last one.
  const ctaText = interpolate(sectionText(spec.buttonSection), tokenValues);
  const leadTextParts = leadKeys.map((k) =>
    interpolate(sectionText(k), tokenValues)
  );
  const fineTextParts = fineKeys.map((k) =>
    interpolate(sectionText(k), tokenValues)
  );

  let fineText = "";
  if (fineTextParts.length === 1) {
    fineText = fineTextParts[0];
  } else if (fineTextParts.length >= 2) {
    const head = fineTextParts.slice(0, -1).join("\n");
    const tail = fineTextParts[fineTextParts.length - 1];
    fineText = `${head}\n\n${tail}`;
  }

  const textParts: string[] = [];
  if (leadTextParts.length > 0) textParts.push(leadTextParts.join("\n\n"));
  textParts.push(`${ctaText}:\n${values.button_href}`);
  if (fineText) textParts.push(fineText);
  const text = textParts.join("\n\n");

  // ---- html -------------------------------------------------------------
  // Escape each section's text once; substitute already-escaped values
  // into it; then linkify if the section is in spec.linkify.
  const escapedSections: Partial<Record<SectionKey, string>> = {};
  for (const k of spec.sections) {
    let h = interpolate(escapeHtml(sectionText(k)), tokenValuesEscaped);
    if (linkifySet.has(k)) h = linkifyAtoms(h, isAr);
    escapedSections[k] = h;
  }

  // Assemble lead block (non-cta lead paragraphs).
  const leadHtml: string[] = leadKeys.map((k, i) => {
    const isLast = i === leadKeys.length - 1;
    const marginBottom = isLast ? "26px" : "16px";
    return `<p style="margin:0 0 ${marginBottom};font-size:16px;line-height:${introLh};color:#33322f">${escapedSections[k]}</p>`;
  });

  // Button paragraph — fixed margin 0 0 28px, label = buttonSection text.
  const buttonHtml = `<p style="margin:0 0 28px">
      <a href="${escapeHtml(values.button_href)}" style="display:inline-block;background:#185FA5;color:#ffffff;font-size:15px;font-weight:500;text-decoration:none;padding:13px 30px;border-radius:8px">${escapedSections[spec.buttonSection]}</a>
    </p>`;

  // Fine block — divider + fine paragraphs (per-position styling).
  // OMITTED ENTIRELY if no fine sections (submission).
  let fineBlock = "";
  if (fineKeys.length > 0) {
    const fineParas = fineKeys.map((k, i) => {
      const isFirst = i === 0;
      const isLast = i === fineKeys.length - 1;
      let style: string;
      if (isLast) {
        // last fine paragraph — closer styling
        style = `margin:12px 0 0;font-size:14px;line-height:${fineLh};color:#5f5e59`;
      } else if (isFirst) {
        style = `margin:0;font-size:13px;line-height:${fineLh};color:#8a8982`;
      } else {
        style = `margin:4px 0 0;font-size:13px;line-height:${fineLh};color:#8a8982`;
      }
      return `<p style="${style}">${escapedSections[k]}</p>`;
    });
    fineBlock = `<div style="border-top:0.5px solid #ececea;padding-top:18px">
      ${fineParas.join("\n      ")}
    </div>`;
  }

  const html = `<div dir="${dir}" style="margin:0 auto;max-width:520px;background:#ffffff;border:0.5px solid #e6e4de;border-radius:12px;padding:32px 34px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#33322f">
    ${leadHtml.join("\n    ")}
    ${buttonHtml}${fineBlock ? "\n    " + fineBlock : ""}
  </div>`;

  return { subject, text, html };
}

// ============================================================================
// Defaults overlay helper
// ============================================================================

/** Apply a (possibly-partial) DB overlay on top of full defaults to produce
 *  a complete, render-ready ResolvedTemplate. A field-by-field overlay:
 *  any blank/missing piece falls back to the default. This is what makes
 *  "reset to default" = delete the row — if a section is missing, defaults
 *  fill it. */
export function resolveTemplate(args: {
  templateId: TemplateId;
  lang: Lang;
  defaultSubject: string;
  defaultSections: Partial<Record<SectionKey, string>>;
  overlaySubject?: string | null;
  overlaySections?: Partial<Record<SectionKey, string>> | null;
}): ResolvedTemplate {
  const { templateId, lang, defaultSections, defaultSubject } = args;
  const subject =
    typeof args.overlaySubject === "string" && args.overlaySubject.trim().length > 0
      ? args.overlaySubject
      : defaultSubject;

  const sections: Partial<Record<SectionKey, string>> = { ...defaultSections };
  if (args.overlaySections) {
    for (const k of Object.keys(args.overlaySections) as SectionKey[]) {
      const v = args.overlaySections[k];
      if (typeof v === "string" && v.trim().length > 0) {
        sections[k] = v;
      }
    }
  }
  return { id: templateId, lang, subject, sections };
}
