#!/usr/bin/env node
// scripts/atlas-export.mjs
//
// ATLAS.ti export builder for the Yarmouk Study.
// READ-ONLY against the database — SELECTs + decrypt_pii only, NO writes.
// Produces one ZIP per main questionnaire variant, each with responses.xlsx +
// codebook.xlsx, plus a top-level export_manifest.md.
//
// Flags:  --anonymise            drop the Name column
//         --variant <slug>       build a single variant (e.g. main_researchers)
//         --out <dir>            output directory (default ./atlas-export-output)
//
// Code map is CURATED + explicit (see CLUSTERS / ASSIGN below): shared questions
// (identical across variants) share one code so ATLAS merges them intentionally;
// everything else is namespaced so codes never collide by accident. The script
// asserts the map covers every DB question exactly.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import JSZip from "jszip";

// ─────────────────────────── config ───────────────────────────
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const ANON = flag("--anonymise");
const ONLY_VARIANT = opt("--variant", null);
const OUT = opt("--out", "./atlas-export-output");
const FIXED_DATE = new Date("2020-01-01T00:00:00Z"); // determinism: pin workbook mtime

const MAIN = ["main_officials_jordanian","main_officials_syrian","main_researchers","main_donors","main_ngos"];
const VARIANT_LABEL = { main_officials_jordanian:"Officials (Jordanian)", main_officials_syrian:"Officials (Syrian)", main_researchers:"Researchers", main_donors:"Donors", main_ngos:"NGOs" };
const TYPE_OF = (v)=> v.includes("officials")?"Officials": v.includes("researchers")?"Researchers": v.includes("donors")?"Donors":"NGOs";
const NAT = { jordanian:"Jordanian", syrian:"Syrian", not_applicable:"International" };

// ─────────────────────────── code map (curated) ───────────────────────────
// role: "text" (free-text → content code) | "choice" (rating group + comment content code)
const CLUSTERS = {
  // Q-Core — identical question shared across ≥2 categories (intentional merge)
  C01:{ns:"Q-Core",label:"Objectives achieved",role:"choice",text:"In your view, to what extent has the 1987 Jordan–Syria Agreement achieved its intended objectives in managing and regulating the shared use of the Yarmouk River water?"},
  C02:{ns:"Q-Core",label:"Continued relevance",role:"choice",text:"In your opinion, has the Agreement remained relevant under current water scarcity, climate change, and increased demand conditions?"},
  C03:{ns:"Q-Core",label:"Flow decline factors",role:"text",text:"In your opinion, what are the main factors that have contributed to the decline in the Yarmouk River's flow over the past decades?"},
  C04:{ns:"Q-Core",label:"Environmental considerations addressed",role:"choice",text:"To what extent has the 1987 Jordan–Syria Agreement addressed environmental considerations in the management of the Yarmouk Basin?"},
  C05:{ns:"Q-Core",label:"Environmental absence impact",role:"text",text:"How has the absence of environmental considerations affected the basin?"},
  C06:{ns:"Q-Core",label:"Future environmental measures",role:"text",text:"What environmental measures should be considered in any future update of the agreement to protect the river's health and the surrounding environment?"},
  C07:{ns:"Q-Core",label:"Surface–groundwater linkage",role:"choice",text:"To what extent has the Agreement addressed the relationship between surface water and groundwater in the Yarmouk River Basin?"},
  C08:{ns:"Q-Core",label:"Groundwater absence impact",role:"text",text:"How has the absence or limited treatment of groundwater in the Agreement affected the management of the basin?",note:"Off-Jordanian wording uses 'limited mention' (vs 'limited treatment'); merged as one code per owner approval."},
  C09:{ns:"Q-Core",label:"International law principles",role:"text",text:"Knowing that international water law has evolved since 1987, and that both Jordan and Syria have ratified the 1997 UN Watercourses Convention, which includes principles such as fair water sharing, environmental protection, and the duty to share data. In your opinion, how useful would these principles be in guiding any future update of the Agreement?"},
  C10:{ns:"Q-Core",label:"Priority reform",role:"text",text:"Based on the previous, and given the recent developments in Jordan-Syria relations, if you could prioritize one reform to the 1987 Agreement, what would it be?",note:"Off-Jordanian wording drops a comma; merged as one code per owner approval."},
  C11:{ns:"Q-Core",label:"Additional remarks",role:"text",text:"Is there anything else you would like to share regarding the 1987 Agreement?"},
  // Q-Officials — shared between both officials variants only
  OFF01:{ns:"Q-Officials",label:"Main achievements",role:"text",text:"What have been the main achievements of the agreement?"},
  OFF02:{ns:"Q-Officials",label:"Implementation challenges",role:"text",text:"What have been the main implementation challenges or gaps in the agreement?",note:"Off-Jordanian omits 'in the agreement'; merged per owner approval."},
  OFF03:{ns:"Q-Officials",label:"Institutional coordination",role:"choice",text:"How effective have the institutional coordination and monitoring mechanisms under the agreement been?"},
  OFF04:{ns:"Q-Officials",label:"Groundwater provisions",role:"text",text:"What provisions related to groundwater use, monitoring, and abstraction limits should be considered in any future agreement?"},
  OFF05:{ns:"Q-Officials",label:"Data platform status",role:"text",text:"A joint data-sharing platform was launched in 2025 between Jordan and Syria. Is the platform currently operational, and how do you assess its role in improving coordination and decision-making for the Yarmouk Basin?"},
  OFF06:{ns:"Q-Officials",label:"Data platform contents",role:"text",text:"What types of data should the platform include, and should it cover historical records or only newly generated data?"},
  OFF07:{ns:"Q-Officials",label:"Shared benefits",role:"text",text:"Beyond water sharing, what other shared benefits, such as energy or food security, could a reformed agreement promote to encourage cooperation?"},
  OFF08:{ns:"Q-Officials",label:"1994 Peace Treaty governance",role:"text",text:"The Yarmouk River is governed primarily by the 1987 Agreement, but the 1994 Peace Treaty also addresses shared water. How do these two frameworks interact, and does this create any gaps or overlaps?",note:"Officials-Jordanian only."},
  OFF09:{ns:"Q-Officials",label:"Infrastructure and dams",role:"text",text:"Over the decades since the 1987 Agreement, water infrastructure in the basin has continued to develop. What were the main factors driving the construction of new dams, and how do you view the relationship between infrastructure development and the Agreement's provisions?",note:"Officials-Syrian only."},
  OFF10:{ns:"Q-Officials",label:"Agricultural water needs",role:"text",text:"As Syria enters a new phase of development, how should agricultural water needs in the Yarmouk Basin be balanced with the commitments under the bilateral Agreement with Jordan?",note:"Officials-Syrian only."},
  // Q-Researchers
  RES01:{ns:"Q-Researchers",label:"Water availability methods",role:"text",text:"From your point of view, what is the most effective method to increase water availability in the Yarmouk Basin?"},
  RES02:{ns:"Q-Researchers",label:"Minimum environmental flow",role:"text",text:"Is it scientifically feasible to define a minimum environmental flow that the Yarmouk needs, and how could it be determined?"},
  RES03:{ns:"Q-Researchers",label:"Platform data types",role:"text",text:"What types of data are most important to include in the joint data-sharing platform?"},
  RES04:{ns:"Q-Researchers",label:"Equitable allocation method",role:"text",text:"From a scientific point of view, what is the most equitable method for allocating water from the Yarmouk between Jordan and Syria?"},
  RES05:{ns:"Q-Researchers",label:"Provisions worth preserving",role:"text",text:"The 1987 Agreement is often criticized for what it lacks. Is there anything in it worth preserving in a future update?"},
  RES06:{ns:"Q-Researchers",label:"Equity mechanism",role:"text",text:"If you had to design one mechanism to ensure equity in Yarmouk water sharing, just one, what would it be?"},
  // Q-Donors
  DON01:{ns:"Q-Donors",label:"Organizational lessons",role:"text",text:"What has your organization learned from supporting transboundary water cooperation in the Yarmouk or comparable basins?"},
  DON02:{ns:"Q-Donors",label:"Institutional success features",role:"text",text:"From your experience across multiple basins, what are the main institutional features that make water-sharing agreements succeed or fail?"},
  DON03:{ns:"Q-Donors",label:"International organizations' role",role:"choice",text:"What role can international organizations realistically play in supporting reform of the 1987 Agreement?"},
  DON04:{ns:"Q-Donors",label:"Coordinating initiatives",role:"text",text:"Multiple international initiatives are now active in the Yarmouk basin. How can these efforts be better coordinated to avoid duplication?"},
  // Q-NGOs
  NGO01:{ns:"Q-NGOs",label:"Observed environmental changes",role:"text",text:"From your fieldwork and community engagement, what environmental changes have residents and local groups observed along the Yarmouk?"},
  NGO02:{ns:"Q-NGOs",label:"Community impacts",role:"text",text:"How are local communities along the Yarmouk affected by the decline in river flow, and what adaptations have they made?"},
  NGO03:{ns:"Q-NGOs",label:"Civil society consultation",role:"text",text:"Are civil society organizations consulted or involved in any way in decisions about water management in the basin?"},
  NGO04:{ns:"Q-NGOs",label:"Civil society role",role:"text",text:"What role should civil society and environmental organizations play in monitoring and enforcing any future agreement?"},
};
// (variant, question_code) → cluster code. Must cover every DB question exactly.
const ASSIGN = {
  main_officials_jordanian:{Q1:"C01",Q2:"OFF01",Q3:"OFF02",Q4:"OFF03",Q5:"C02",Q6:"C03",Q7:"C04",Q8:"C05",Q9:"C06",Q10:"C07",Q11:"C08",Q12:"OFF04",Q13:"OFF05",Q14:"OFF06",Q15:"OFF07",Q16:"OFF08",Q17:"C09",Q18:"C10",Q19:"C11"},
  main_officials_syrian:{Q1:"C01",Q2:"OFF01",Q3:"OFF02",Q4:"OFF03",Q5:"C02",Q6:"C03",Q7:"C04",Q8:"C05",Q9:"C06",Q10:"C07",Q11:"C08",Q12:"OFF04",Q13:"OFF09",Q14:"OFF05",Q15:"OFF06",Q16:"OFF07",Q17:"C09",Q18:"OFF10",Q19:"C10",Q20:"C11"},
  main_researchers:{Q1:"C01",Q2:"C02",Q3:"C03",Q4:"C04",Q5:"C05",Q6:"C06",Q7:"C07",Q8:"C08",Q9:"RES01",Q10:"RES02",Q11:"RES03",Q12:"RES04",Q13:"C09",Q14:"RES05",Q15:"RES06",Q16:"C11"},
  main_donors:{Q1:"C01",Q2:"C02",Q3:"C04",Q4:"C05",Q5:"C06",Q6:"DON01",Q7:"DON02",Q8:"DON03",Q9:"DON04",Q10:"C10",Q11:"C11"},
  main_ngos:{Q1:"C01",Q2:"C02",Q3:"C04",Q4:"C05",Q5:"C06",Q6:"NGO01",Q7:"NGO02",Q8:"NGO03",Q9:"NGO04",Q10:"C10",Q11:"C11"},
};
// ATLAS.ti Survey-import header conventions (auto-assign column roles):
//   !col      → document name        :col → single-value document group
//   &col      → date attribute       code::description → CODED CONTENT (code = text BEFORE `::`)
// The CODE NAME is the full namespaced string (NO internal `::`, or ATLAS would
// split it); the question text goes AFTER `::` as the code's description.
const codeOf = (cc) => `${CLUSTERS[cc].ns} ${cc} ${CLUSTERS[cc].label}`;             // ATLAS code name (unique, namespaced)
const contentHeader = (cc) => `${codeOf(cc)}::${CLUSTERS[cc].text.replace(/\s+/g," ")}`; // code::description
const ratingHeader = (cc) => `:${cc} ${CLUSTERS[cc].label} rating`;                  // single-value document group

// ─────────────────────────── cleaning ───────────────────────────
const PLACEHOLDERS = new Set(["n/a","na","n.a.","n.a","none","nil","-","--","---","—",".","..","..."]);
const subs = []; // logged substitutions
function cleanText(raw, ctx) {
  if (raw == null) return "";
  let s = String(raw);
  s = s.replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">")
       .replace(/&quot;/gi,'"').replace(/&apos;/gi,"'").replace(/&#39;/g,"'").replace(/&#(\d+);/g,(_,n)=>{try{return String.fromCodePoint(+n);}catch{return _;}});
  s = s.replace(/<[^>]+>/g," ");            // strip HTML tags
  s = s.replace(/\r\n?/g,"\n");             // normalize newlines
  s = s.replace(/[ \t]+/g," ");             // collapse spaces/tabs
  s = s.split("\n").map(l=>l.trim()).join("\n").replace(/\n{3,}/g,"\n\n").trim(); // preserve paragraph breaks
  const low = s.toLowerCase().trim();
  if (PLACEHOLDERS.has(low)) { subs.push({ ctx, from: s, to: "" }); return ""; }
  return s;
}

// ─────────────────────────── load (read-only) ───────────────────────────
const env = Object.fromEntries(readFileSync(process.cwd()+"/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
async function inChunks(ids, fn){ const o=[]; for(let i=0;i<ids.length;i+=100){ const {data,error}=await fn(ids.slice(i,i+100)); if(error){console.error("DB error (chunk):",error.message);process.exit(2);} o.push(...(data??[])); } return o; }
const must = (label,{data,error}) => { if(error){ console.error("DB error @"+label+":",error.message); process.exit(2);} return data??[]; };

const versions = must("versions", await sb.from("questionnaire_versions").select("id, variant, type").in("variant", MAIN));
const verByVariant = new Map(versions.map(v=>[v.variant, v]));
const verById = new Map(versions.map(v=>[v.id, v]));

const questionsAll = must("questions", await sb.from("questions").select("id, version_id, question_code, order_index, text_en, text_ar, answer_type, allow_comment").in("version_id", versions.map(v=>v.id)));
const qOptions = await inChunks(questionsAll.filter(q=>q.answer_type!=="free_text").map(q=>q.id), c => sb.from("question_options").select("id, question_id, label_en, order_index").in("question_id", c));
const optById = new Map(qOptions.map(o=>[o.id,o]));

const respsAll = must("responses", await sb.from("responses").select("id, invitation_id, status, submitted_at, language").eq("status","active").not("submitted_at","is",null));
const invAll = await inChunks([...new Set(respsAll.map(r=>r.invitation_id))], c => sb.from("invitations").select("id, ref_code, category, nationality, recipient_name_encrypted, questionnaire_version_id").in("id", c));
const invById = new Map(invAll.map(i=>[i.id,i]));
const answersAll = await inChunks(respsAll.map(r=>r.id), c => sb.from("answers").select("id, response_id, question_id, answer_text, answer_comment").in("response_id", c));
const aOptions = await inChunks(answersAll.map(a=>a.id), c => sb.from("answer_options").select("answer_id, option_id").in("answer_id", c));
const optsByAnswer = new Map(); for(const s of aOptions){ (optsByAnswer.get(s.answer_id) ?? optsByAnswer.set(s.answer_id,[]).get(s.answer_id)).push(s.option_id); }

// name decrypt (skipped under --anonymise)
const nameByInv = new Map();
if (!ANON) for (const i of invAll){ const {data}=await sb.rpc("decrypt_pii",{p_ciphertext:i.recipient_name_encrypted}); nameByInv.set(i.id, data??""); }

// ─────────────────────────── coverage assertions ───────────────────────────
const fail = (m)=>{ console.error("ASSERT FAILED:",m); process.exit(1); };
for (const q of questionsAll){
  const v = verById.get(q.version_id).variant;
  if (!ASSIGN[v] || !ASSIGN[v][q.question_code]) fail(`unmapped question ${v}:${q.question_code} ("${q.text_en.slice(0,40)}")`);
  if (!CLUSTERS[ASSIGN[v][q.question_code]]) fail(`bad cluster for ${v}:${q.question_code}`);
}
for (const v of MAIN) for (const code of Object.keys(ASSIGN[v])){
  if (!questionsAll.some(q=>verById.get(q.version_id).variant===v && q.question_code===code)) fail(`ASSIGN has ${v}:${code} but DB does not`);
}

// index answers per response → question_code
const ansByResp = new Map();
for (const a of answersAll){
  const q = questionsAll.find(x=>x.id===a.question_id); if(!q) continue;
  const v = verById.get(q.version_id).variant;
  (ansByResp.get(a.response_id) ?? ansByResp.set(a.response_id, new Map()).get(a.response_id)).set(q.question_code, { a, q, variant:v });
}

// ─────────────────────────── build per variant ───────────────────────────
mkdirSync(OUT, { recursive:true });
const today = new Date().toISOString().slice(0,10);
const manifest = [];
const codeMapRows = [];        // for manifest: {variant, code, codeName, role, text, shared}
const perVariantCounts = {};
const natCounts = {};
const zeroAnswerRespondents = [];
let grandTotal = 0;
const allIds = new Set();
const codebookByCode = new Map(); // code → {codeName, text, groups:Set}

const variantsToBuild = ONLY_VARIANT ? [ONLY_VARIANT] : MAIN;
for (const variant of variantsToBuild){
  if (!verByVariant.has(variant)) fail(`unknown variant ${variant}`);
  const ver = verByVariant.get(variant);
  const qs = questionsAll.filter(q=>q.version_id===ver.id).sort((a,b)=>a.order_index-b.order_index);
  const resps = respsAll.filter(r=>invById.get(r.invitation_id)?.questionnaire_version_id===ver.id)
    .sort((a,b)=> (invById.get(a.invitation_id).ref_code).localeCompare(invById.get(b.invitation_id).ref_code));
  perVariantCounts[variant] = resps.length; grandTotal += resps.length;

  // columns: metadata (ATLAS prefix markers), then per question (rating group then content code).
  // Each column has a stable `key` (row lookup) + display `header` (ATLAS convention).
  const cols = [{key:"ID", header:"!ID", kind:"meta"}]; if(!ANON) cols.push({key:"Name", header:"Name", kind:"meta"});
  cols.push({key:"Nationality",header:":Nationality",kind:"meta"},{key:"Type",header:":Type",kind:"meta"},{key:"Variant",header:":Variant",kind:"meta"},{key:"Submission_date",header:"&Submission_date",kind:"meta"});
  for (const q of qs){
    const cc = ASSIGN[variant][q.question_code];
    const cl = CLUSTERS[cc];
    if (cl.role==="choice") cols.push({key:`r_${cc}`, header:ratingHeader(cc), kind:"rating", code:q.question_code});
    // content column: free-text answer, OR (for choice) the comment — both coded under codeOf(cc)
    cols.push({key:`c_${cc}`, header:contentHeader(cc), kind: cl.role==="choice"?"comment":"content", code:q.question_code, cc, atlasCode:codeOf(cc)});
    const shared = Object.entries(ASSIGN).filter(([,m])=>Object.values(m).includes(cc)).length>1;
    codeMapRows.push({variant, qcode:q.question_code, code:cc, codeName:codeOf(cc), role: cl.role==="choice"?"rating+comment":"content", shared, text:cl.text, note:cl.note||""});
    const cb = codebookByCode.get(codeOf(cc)) ?? {codeName:codeOf(cc), text:cl.text, groups:new Set()};
    cb.groups.add(VARIANT_LABEL[variant]); codebookByCode.set(codeOf(cc), cb);
  }

  // rows
  const dataRows = [];
  for (const r of resps){
    const inv = invById.get(r.invitation_id);
    allIds.add(inv.ref_code);
    natCounts[NAT[inv.nationality]??inv.nationality] = (natCounts[NAT[inv.nationality]??inv.nationality]||0)+1;
    const amap = ansByResp.get(r.id) ?? new Map();
    let freeTextAnswered = 0;
    const row = { ID: inv.ref_code };
    if(!ANON) row.Name = nameByInv.get(inv.id)||"";
    row.Nationality = NAT[inv.nationality]??inv.nationality;
    row.Type = TYPE_OF(variant); row.Variant = VARIANT_LABEL[variant];
    row.Submission_date = (r.submitted_at||"").slice(0,10);
    for (const col of cols){
      if (!col.code) continue;
      const entry = amap.get(col.code);
      if (col.kind==="rating"){
        const ids = entry ? (optsByAnswer.get(entry.a.id)||[]) : [];
        row[col.key] = ids.map(id=>optById.get(id)?.label_en).filter(Boolean).sort().join("; ");
      } else if (col.kind==="comment"){
        const val = cleanText(entry?.a.answer_comment, `${inv.ref_code}/${col.code}`);
        row[col.key] = val; if(val) freeTextAnswered++;
      } else { // content (free-text)
        const val = cleanText(entry?.a.answer_text, `${inv.ref_code}/${col.code}`);
        row[col.key] = val; if(val) freeTextAnswered++;
      }
    }
    dataRows.push(row);
    if (freeTextAnswered===0) zeroAnswerRespondents.push(`${inv.ref_code} (${variant})`);
  }

  // ── validation (per file) ──
  const codeCols = cols.filter(c=>c.kind==="content"||c.kind==="comment");
  const seen = new Set(); for(const c of codeCols){ if(seen.has(c.atlasCode)) fail(`duplicate code in ${variant}: ${c.atlasCode}`); seen.add(c.atlasCode); }
  for(const c of codeCols){ if(c.atlasCode.length>60) fail(`code name too long (>60) in ${variant}: ${c.atlasCode}`); }
  for(const row of dataRows){ if(!row.Nationality||!["Jordanian","Syrian","International"].includes(row.Nationality)) fail(`bad Nationality for ${row.ID}`); if(!row.Type) fail(`bad Type for ${row.ID}`); }

  // ── responses.xlsx ──
  const wb = new ExcelJS.Workbook(); wb.creator="Yarmouk Study — ATLAS export"; wb.created=FIXED_DATE; wb.modified=FIXED_DATE;
  const ws = wb.addWorksheet("responses");
  ws.columns = cols.map(c=>({header:c.header, key:c.key, width: c.kind==="content"||c.kind==="comment"?55: c.kind==="rating"?26: 16}));
  ws.getRow(1).font={bold:true};
  for(const row of dataRows) ws.addRow(row);
  for(const c of cols){ if(c.kind==="content"||c.kind==="comment") ws.getColumn(c.key).alignment={wrapText:true,vertical:"top"}; }
  const responsesBuf = await wb.xlsx.writeBuffer();

  // ── codebook.xlsx (positional: A=code, B=comment/question text, C=code groups) ──
  const cwb = new ExcelJS.Workbook(); cwb.creator="Yarmouk Study — ATLAS codebook"; cwb.created=FIXED_DATE; cwb.modified=FIXED_DATE;
  const cws = cwb.addWorksheet("codebook");
  cws.columns=[{header:"Code",key:"code",width:44},{header:"Comment",key:"comment",width:90},{header:"Code Group",key:"group",width:26}];
  cws.getRow(1).font={bold:true};
  const cbSeen=new Set();
  for(const c of codeCols){ if(cbSeen.has(c.atlasCode))continue; cbSeen.add(c.atlasCode); const cl=CLUSTERS[c.cc]; cws.addRow({code:c.atlasCode, comment:cl.text, group:`${cl.ns}; ${VARIANT_LABEL[variant]}`}); }
  cws.getColumn("comment").alignment={wrapText:true,vertical:"top"};
  const codebookBuf = await cwb.xlsx.writeBuffer();

  // ── cross-check: every content code ↔ codebook row (by ATLAS code name) ──
  const respCodes = new Set(codeCols.map(c=>c.atlasCode));
  const cbRows = new Set([...cbSeen]);
  for(const h of respCodes) if(!cbRows.has(h)) fail(`code ${h} missing from codebook (${variant})`);
  for(const h of cbRows) if(!respCodes.has(h)) fail(`codebook code ${h} not in responses (${variant})`);

  // ── zip ──
  const zip = new JSZip();
  zip.file("responses.xlsx", responsesBuf);
  zip.file("codebook.xlsx", codebookBuf);
  const zipBuf = await zip.generateAsync({ type:"nodebuffer", compression:"DEFLATE" });
  const zipName = `ATLASti_${VARIANT_LABEL[variant].replace(/[^A-Za-z]/g,"")}_${today}.zip`;
  writeFileSync(`${OUT}/${zipName}`, zipBuf);
  manifest.push({ variant, zip:zipName, respondents:resps.length, contentCodes:cbRows.size, ratingGroups: cols.filter(c=>c.kind==="rating").length });
  console.log(`✓ ${zipName} — ${resps.length} respondents, ${cbRows.size} codes, ${cols.filter(c=>c.kind==="rating").length} rating groups`);
}

// ── global validation ──
const expectedTotal = ONLY_VARIANT ? perVariantCounts[ONLY_VARIANT] : 44;
if (!ONLY_VARIANT && grandTotal!==expectedTotal) fail(`total respondents ${grandTotal} != expected ${expectedTotal}`);
if (allIds.size !== grandTotal) fail(`duplicate ID across files (${allIds.size} unique vs ${grandTotal} rows)`);

// ─────────────────────────── manifest ───────────────────────────
const L=[];
L.push(`# Yarmouk Study — ATLAS.ti Export Manifest`);
L.push(``);
L.push(`- **Run:** ${new Date().toISOString()}`);
L.push(`- **DB source:** ${env.NEXT_PUBLIC_SUPABASE_URL}`);
L.push(`- **Scope:** main variants, submitted + active responses` + (ANON?` · ANONYMISED (no Name column)`:``) + (ONLY_VARIANT?` · single variant: ${ONLY_VARIANT}`:``));
L.push(`- **Total respondents:** ${grandTotal}`);
L.push(``);
L.push(`## Respondents per variant`);
for(const m of manifest) L.push(`- **${VARIANT_LABEL[m.variant]}** (${m.variant}): ${m.respondents} — ${m.zip}`);
L.push(``);
L.push(`## Respondents per nationality`);
for(const [k,n] of Object.entries(natCounts).sort()) L.push(`- ${k}: ${n}`);
L.push(``);
L.push(`## Code map — shared (Q-Core / Q-Officials) vs namespaced`);
L.push(`Legend: **SHARED** = one code deliberately merged across variants; role = content (free-text) or rating+comment (choice).`);
L.push(``);
const byCode = new Map();
for(const r of codeMapRows){ const e=byCode.get(r.code)??{...r, variants:[]}; e.variants.push(r.variant); byCode.set(r.code,e); }
const nsOrder=["Q-Core","Q-Officials","Q-Researchers","Q-Donors","Q-NGOs"];
for(const ns of nsOrder){
  L.push(`### ${ns}`);
  L.push(`| Code | Role | Shared | In variants | Question text |`);
  L.push(`|---|---|---|---|---|`);
  for(const [code,e] of [...byCode.entries()].filter(([c])=>CLUSTERS[c].ns===ns).sort()){
    const vs = e.variants.map(v=>VARIANT_LABEL[v]).join(", ");
    L.push(`| \`${e.codeName}\` | ${e.role} | ${e.shared?"**SHARED**":"—"} | ${vs} | ${CLUSTERS[code].text.replace(/\n/g," ").slice(0,120)}${CLUSTERS[code].text.length>120?"…":""} |`);
  }
  L.push(``);
}
L.push(`## Rating (document-group) columns`);
L.push(`Choice questions emit a \`— rating\` document-group column (selected option label; multi-select joined with "; ") **plus** the comment as a content code above.`);
for(const [code,cl] of Object.entries(CLUSTERS).filter(([,c])=>c.role==="choice")) L.push(`- \`${ratingHeader(code)}\`  ← ${cl.ns}::${code}`);
L.push(``);
L.push(`## Near-duplicate merges applied (owner-approved)`);
L.push(`- **C08** Groundwater absence — Officials-Jordanian says "limited *mention*" vs "limited *treatment*" elsewhere; merged.`);
L.push(`- **C10** Priority reform — Officials-Jordanian drops a comma; merged.`);
L.push(`- **OFF02** Implementation challenges — Officials-Jordanian omits "in the agreement"; merged.`);
L.push(`- **C01 (NGOs)** achievement question is *multi-choice* in NGOs vs single-choice elsewhere; kept in the shared C01 rating group, multi-selections joined with "; ".`);
L.push(``);
L.push(`## Cleaning substitutions (placeholder → empty)`);
if(subs.length===0) L.push(`- none`);
else for(const s of subs) L.push(`- ${s.ctx}: "${s.from}" → (empty)`);
L.push(``);
L.push(`## Respondents with zero free-text/comment content`);
if(zeroAnswerRespondents.length===0) L.push(`- none`);
else for(const z of zeroAnswerRespondents) L.push(`- ${z}`);
L.push(``);
L.push(`## Validation`);
L.push(`- Total respondents == ${expectedTotal}: **PASS**`);
L.push(`- All IDs unique across files: **PASS**`);
L.push(`- Nationality/Type non-empty & in allowed set: **PASS**`);
L.push(`- No duplicate code within a file; responses↔codebook 1:1: **PASS**`);
writeFileSync(`${OUT}/export_manifest.md`, L.join("\n"));
console.log(`✓ export_manifest.md`);
console.log(`\nDONE → ${OUT} (${manifest.length} zip(s), ${grandTotal} respondents). No database writes.`);
