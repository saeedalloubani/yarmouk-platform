// app/admin/(protected)/invitations/import/template/route.ts
//
// D97 — owner-gated download of the bulk-invite .xlsx template (the file Sura
// fills, with dropdown-constrained variant/nationality/language/collection_mode
// columns). Mirrors the export download route's gate + header posture
// (app/admin/(protected)/exports/download/route.ts): 401 no admin, 403 non-
// owner, attachment Content-Disposition, no-store. The template carries NO
// data — but inherits no-store for caching-policy uniformity with the
// invitation surface.
//
// AUDIT: a plain info row (no PII — the template has no recipient data).

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { buildBulkInviteTemplate } from "@/lib/bulk-invite/template";

export const dynamic = "force-dynamic";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const admin = await getCurrentAdmin(supabase);
  if (!admin) {
    return new NextResponse(null, {
      status: 401,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
  if (admin.role !== "owner") {
    return new NextResponse(null, {
      status: 403,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }

  let body: Uint8Array;
  try {
    body = await buildBulkInviteTemplate();
  } catch (err) {
    console.error("[bulk-invite] template build failed", err);
    return new NextResponse("Template generation failed", {
      status: 500,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }

  await logAudit(supabase, {
    action: "bulk_invite.template.download",
    resource: "bulk-invite",
    severity: "info",
    metadata: {},
  });

  return new NextResponse(body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition":
        'attachment; filename="yarmouk-bulk-invite-template.xlsx"',
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
