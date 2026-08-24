# Yarmouk Study — ATLAS.ti Export & Coding Guide

*A complete, beginner-friendly guide. It assumes **no prior knowledge** of ATLAS.ti. Read
Sections 1–4 once, then follow Section 7 (Windows) or Section 8 (Web) click-by-click.*

---

## 1. What this is and why it exists

The Yarmouk Study collected written, open-ended answers from **44 experts** across five
questionnaires (Officials–Jordanian, Officials–Syrian, Researchers, Donors, NGOs) in English and
Arabic. To analyse those answers for the thesis — to find themes, compare what different groups
said, and pull quotable evidence — we use **ATLAS.ti**, a standard qualitative data analysis (QDA)
program.

This export packages the answers in exactly the format ATLAS.ti's import wizards expect, so all 44
respondents load into one project with the question wording already attached to every code.
**Nothing here changes the study database — the export only reads it.**

---

## 2. ATLAS.ti in five minutes

You only need five ideas:

| Term | Meaning in this project |
|---|---|
| **Project** | Your whole analysis file. You create **one** project and load all five variants into it. |
| **Document** | One respondent. Each expert becomes one document. There will be 44 documents. |
| **Code** (a.k.a. **tag**) | A label attached to a passage of text. Coding = grouping text by meaning. |
| **Code Group** | A folder of codes. We use two: the namespace (`Q-Core`, `Q-Officials`, …) and the questionnaire name. |
| **Document Group** | A filterable attribute of a respondent — Nationality, Type, Variant, or a rating answer. Lets you ask "what did *Syrian* experts say?" |

Two import tools do all the loading, both under **Import & Export**:
1. **Import Survey** → reads `responses.xlsx`; creates one document per respondent and applies codes.
2. **Import Codebook** → reads `codebook.xlsx`; attaches the full question text to each code.

---

## 3. What you received

```
export_manifest.md                      ← the authoritative record: counts, full code map, decisions
ATLASti_OfficialsJordanian_<date>.zip   ← 17 respondents
ATLASti_OfficialsSyrian_<date>.zip      ←  5
ATLASti_Researchers_<date>.zip          ← 14
ATLASti_Donors_<date>.zip               ←  4
ATLASti_NGOs_<date>.zip                 ←  4
```
Each ZIP holds two files: **`responses.xlsx`** (Import Survey) and **`codebook.xlsx`** (Import Codebook).

---

## 4. The code map — the most important concept

### 4.1 The problem it solves
ATLAS.ti matches codes **by name**. All five questionnaires restart numbering at Q1, so a bare `Q1`
would fuse five different questions into one code — silently. The export prevents this by giving
every code a **namespaced** name, and by **deliberately sharing** a name only when the question is
genuinely identical across variants.

### 4.2 Two situations
- **Shared question → one identical code in every file that has it.** Many questions are word-for-word
  identical across variants (e.g. *"…has the 1987 Agreement achieved its objectives?"* appears in all
  five). These share one code (`Q-Core …` for cross-category, `Q-Officials …` for the two Officials
  files). On import, ATLAS **merges them on purpose** — that is what lets you compare groups on the
  *same* question.
- **Unique question → its own namespaced code** (`Q-Researchers …`, `Q-Donors …`, `Q-NGOs …`, or the
  Officials-only questions), so it can never collide.

### 4.3 How a code is named (and why no "::")
A code name looks like:
```
Q-Core C08 Groundwater absence impact
└──┬──┘ └┬┘ └──────────┬──────────────┘
 namespace  number       short label (3–5 words)
```
> **Important:** the namespace is separated by a **space**, not `::`. In an ATLAS.ti survey file, a
> `::` in a column header means *code::description* — ATLAS takes everything **before** `::` as the
> code name. So we keep `::` out of the code itself and use it only to attach the full question text
> (see §5). This is the single technical detail that prevents an invisible mass-merge.

The short label is deliberately brief because ATLAS also writes it into the document body; the full
question text lives in the code's comment.

### 4.4 The full code map
Namespaces: **Q-Core** = shared across categories · **Q-Officials** = shared by both Officials files ·
**Q-Researchers/Donors/NGOs** = that questionnaire only. **Role:** *content* = a written answer you
code; *rating+comment* = a scale question → a document-group (the choice) **plus** a content code
(the written comment).

#### Q-Core (shared across categories)
| Code | Role | In |
|---|---|---|
| `Q-Core C01 Objectives achieved` | rating+comment | all 5 |
| `Q-Core C02 Continued relevance` | rating+comment | all 5 |
| `Q-Core C03 Flow decline factors` | content | Officials, Researchers |
| `Q-Core C04 Environmental considerations addressed` | rating+comment | all 5 |
| `Q-Core C05 Environmental absence impact` | content | all 5 |
| `Q-Core C06 Future environmental measures` | content | all 5 |
| `Q-Core C07 Surface–groundwater linkage` | rating+comment | Officials, Researchers |
| `Q-Core C08 Groundwater absence impact` | content | Officials, Researchers |
| `Q-Core C09 International law principles` | content | Officials, Researchers |
| `Q-Core C10 Priority reform` | content | Officials, Donors, NGOs |
| `Q-Core C11 Additional remarks` | content | all 5 |

#### Q-Officials (both Officials files)
| Code | Role | In |
|---|---|---|
| `Q-Officials OFF01 Main achievements` | content | both Officials |
| `Q-Officials OFF02 Implementation challenges` | content | both Officials |
| `Q-Officials OFF03 Institutional coordination` | rating+comment | both Officials |
| `Q-Officials OFF04 Groundwater provisions` | content | both Officials |
| `Q-Officials OFF05 Data platform status` | content | both Officials |
| `Q-Officials OFF06 Data platform contents` | content | both Officials |
| `Q-Officials OFF07 Shared benefits` | content | both Officials |
| `Q-Officials OFF08 1994 Peace Treaty governance` | content | Officials-Jordanian only |
| `Q-Officials OFF09 Infrastructure and dams` | content | Officials-Syrian only |
| `Q-Officials OFF10 Agricultural water needs` | content | Officials-Syrian only |

#### Q-Researchers / Q-Donors / Q-NGOs (single questionnaire)
| Code | Role |
|---|---|
| `Q-Researchers RES01 Water availability methods` | content |
| `Q-Researchers RES02 Minimum environmental flow` | content |
| `Q-Researchers RES03 Platform data types` | content |
| `Q-Researchers RES04 Equitable allocation method` | content |
| `Q-Researchers RES05 Provisions worth preserving` | content |
| `Q-Researchers RES06 Equity mechanism` | content |
| `Q-Donors DON01 Organizational lessons` | content |
| `Q-Donors DON02 Institutional success features` | content |
| `Q-Donors DON03 International organizations' role` | rating+comment |
| `Q-Donors DON04 Coordinating initiatives` | content |
| `Q-NGOs NGO01 Observed environmental changes` | content |
| `Q-NGOs NGO02 Community impacts` | content |
| `Q-NGOs NGO03 Civil society consultation` | content |
| `Q-NGOs NGO04 Civil society role` | content |

> The always-current version of this table (with full question text per code) is regenerated into
> `export_manifest.md` on every run. If the two ever disagree, trust the manifest.

### 4.5 Rating questions: two columns, two jobs
Six questions are scale/rating questions (a choice like *"To a large extent / Not at all …"*, most
with a comment box). Each produces **two** columns:
- **`:C01 Objectives achieved rating`** → the chosen option → a **document group** (filter by rating).
- **`Q-Core C01 Objectives achieved`** → the written comment → coded content.

That pairing lets you ask *"what do the people who rated it low actually write?"*

---

## 5. The `responses.xlsx` columns (and their ATLAS markers)

The header row carries small **marker characters** so the Survey wizard assigns each column's role
automatically. You do not have to memorise them — just recognise them:

| Header looks like | Marker | ATLAS role |
|---|---|---|
| `!ID` | `!` | Document **name** (the respondent code, e.g. `OFF-JORDAN-04`) |
| `Name` | *(none)* | Ignored at import (present unless built with `--anonymise`) |
| `:Nationality`, `:Type`, `:Variant` | `:` | Document **groups** (single value) |
| `:C01 … rating` | `:` | Document **group** — the chosen scale option |
| `&Submission_date` | `&` | **Date** attribute |
| `Q-Core C01 …::<question text>` | `::` | **Coded content** — code = text *before* `::`; the question text *after* `::` becomes the code's description |

---

## 6. The `codebook.xlsx`
Three columns, read **by position**:

| Position | Content |
|---|---|
| **A** | Code name — matches the code (the part before `::`) in `responses.xlsx` exactly |
| **B** | The full question text (becomes the code's comment) |
| **C** | Code groups, e.g. `Q-Core; Researchers` (namespace + questionnaire) |

Both files are generated from one source, so column A always matches — comments attach cleanly and
you never get orphan codes.

---

## 7. Step-by-step — ATLAS.ti for **Windows** (desktop)

*Menu names vary a little by version; the flow is the same. Budget ~20 minutes.*

**Prep.** Unzip all five `.zip` files into five clearly-named folders. Each gives a `responses.xlsx`
and a `codebook.xlsx`.

1. **Create the project.** Open ATLAS.ti → **New Project** → name it *Yarmouk Study* → Create.
2. **Import the first variant's responses.** Ribbon **Import & Export → Survey Import (Excel/CSV)** →
   pick that variant's `responses.xlsx`. A mapping screen appears; because of the marker characters it
   is usually already correct:
   - `!ID` → *Document Name*
   - `:Nationality / :Type / :Variant / :… rating` → *Document Groups*
   - `&Submission_date` → *Attribute (date)*
   - `Q-… ::…` columns → *Content with code* (one code per column)
   - `Name` → set to *Skip* (or leave; it isn't analytically used).
   Click **Import**. That variant's respondents are now documents, with codes already applied to each
   answer.
3. **Import that variant's codebook.** **Import & Export → Import Codebook** → pick the same variant's
   `codebook.xlsx` → Import. ATLAS matches each code by name and fills its comment (the full question
   text). Safe to re-run.
4. **Repeat steps 2–3 for the other four variants**, into the **same project**. As you go, shared
   codes (`Q-Core …`, `Q-Officials …`) **merge automatically** — after importing Researchers then
   Officials, `Q-Core C01 …` holds answers from both. This is intended.
5. **Verify (2 minutes).** Open **Code Manager**:
   - A shared code like `Q-Core C05 …` shows groundings from several variants (not duplicated as
     `…C05` and `…C05 (2)`), and its comment is the full question.
   - **Documents = 44**; **Codes ≈ 38**.
   Open **Document Manager** → confirm the document groups (Nationality, Type, Variant, and the
   `… rating` groups) are populated.

---

## 8. Step-by-step — ATLAS.ti **Web**

*ATLAS.ti Web (app.atlasti.com) uses the same concepts; labels differ slightly.*

1. **Sign in** at app.atlasti.com and **Create Project** → name it *Yarmouk Study*.
2. **Import the first variant's responses.** **Import → Survey** (or **Documents → Import → From
   spreadsheet**) → upload that variant's `responses.xlsx`. Confirm the column roles on the mapping
   screen (the markers pre-fill them exactly as in §5). Import.
3. **Import that variant's codebook.** **Import → Codebook** → upload `codebook.xlsx` → Import.
4. **Repeat for the other four variants** into the **same** project; shared codes merge by name.
5. **Verify** in the **Codes** panel (shared codes not duplicated; comments present) and the
   **Documents** panel (44 documents; document groups populated).

> **Tip (both platforms):** always keep each variant's `responses.xlsx` and `codebook.xlsx` together,
> and import *all five* variants before you start coding, so the shared codes are complete.

---

## 9. What you should see (expected output)

**`responses.xlsx`** — one row per respondent. A slice of the real Researchers file (answers
abbreviated; Arabic preserved exactly):

| `!ID` | `:Nationality` | `:Type` | `:C01 … rating` | `Q-Core C03 Flow decline factors::…` |
|---|---|---|---|---|
| RESS-INT-01 | Jordanian | Researchers | Other: (Please Explain) | ان الانخفاض الكبير في تدفق مياه نهر اليرموك كان نتيجة… |
| RESS-INT-02 | Syrian | Researchers | Minimally | ١- التغيرات المناخية ٢- الاستخدام العشوائي للمياه… |
| RESS-INT-04 | Syrian | Researchers | Fully | العامل الرئيس هو الأعمال التي تقوم بها اسرائيل… |

**`codebook.xlsx`** — one row per code:

| A (Code) | B (Comment = full question) | C (Code groups) |
|---|---|---|
| Q-Core C01 Objectives achieved | In your view, to what extent has the 1987 Jordan–Syria Agreement achieved…? | Q-Core; Researchers |
| Q-Core C03 Flow decline factors | In your opinion, what are the main factors that have contributed to the decline…? | Q-Core; Researchers |

**Inside ATLAS.ti after import** — the Code Manager shows codes grouped by namespace:
```
Codes (Code Manager)
├─ Q-Core C01 Objectives achieved        · 44 quotations · comment: "In your view…"
├─ Q-Core C05 Environmental absence…      · 44 quotations
├─ Q-Officials OFF03 Institutional…       · 22 quotations
├─ Q-Researchers RES02 Minimum env flow   · 14 quotations
└─ …
Code Groups:  Q-Core · Q-Officials · Q-Researchers · Q-Donors · Q-NGOs · (per variant)
Documents: 44   Document Groups: Nationality {Jordanian 33, Syrian 8, International 3}, Type, Variant, ratings
```

---

## 10. Using this in your thesis

The export gives you a **question-by-question backbone of codes**. A typical workflow to results:

1. **Familiarise & refine coding.** Read each document. The question codes are applied already; add
   **thematic sub-codes** as patterns emerge (e.g. under `Q-Core C05 Environmental absence impact`,
   create sub-codes *biodiversity loss*, *water quality*, *agricultural decline*). This is your
   thematic analysis layer.
2. **Build themes.** Group related codes into **code groups** representing your themes/chapters. Use
   the **Code–Document Table** to count how often each theme appears, overall and per group.
3. **Compare across groups.** Use **Document Groups** (Nationality, Type, and the `… rating` groups)
   with the **Query Tool / Code–Document Table** to compare what Officials vs Researchers vs Donors vs
   NGOs said to the **shared** questions, and to bridge quantitative↔qualitative ("what do those who
   rated relevance *Minimally* actually write?").
4. **Pull evidence (quotations).** Each code collects its quotations. Export a code's quotations
   (**Output → Quotations**) to drop verbatim evidence into your Findings chapter; the code comment
   reminds you exactly which question produced them. Cite the respondent by **ID** (e.g. *"(RES,
   RESS-INT-04)"*) — never the name — to keep participants anonymous.
5. **Report.** ATLAS.ti's **Reports/Outputs** (code books, code–document tables, networks) become
   thesis tables and figures. A **Network** view (drag codes onto a canvas and link them) makes a
   clean conceptual diagram of how your themes relate.
6. **Methodology paragraph (template you can adapt):**
   > *"Forty-four expert responses were analysed in ATLAS.ti (version X). Responses were imported as
   > documents grouped by stakeholder type and nationality. An initial deductive coding frame
   > followed the questionnaire structure, with codes shared across stakeholder groups where questions
   > were identical, enabling cross-group comparison. Inductive sub-codes were then developed
   > thematically. Coding was reviewed for consistency, and themes were compared across stakeholder
   > groups using code–document co-occurrence."*

**Both languages:** Arabic and English answers sit in the same documents; ATLAS.ti handles Unicode,
so you can code Arabic passages directly and quote them verbatim (they are stored exactly as written).

---

## 11. Re-running the export

Read-only, deterministic, re-runnable whenever the data changes:
```bash
node scripts/atlas-export.mjs --out ./atlas-export-output
```
| Flag | Effect |
|---|---|
| `--anonymise` | Drop the `Name` column (IDs only) |
| `--variant <slug>` | Build one variant, e.g. `--variant main_researchers` |
| `--out <dir>` | Output directory (default `./atlas-export-output`) |

The script **asserts** its code map covers every question and that counts/IDs/codes reconcile — it
exits with an error rather than write a wrong file — and regenerates `export_manifest.md` each run.

---

## 12. Data notes & caveats
- **Intentional merges** (owner-approved): three questions differ only by trivial wording across
  variants (a comma; "mention" vs "treatment"; a dropped phrase) and were merged into single codes
  (`C08`, `C10`, `OFF02`). See the manifest's "Near-duplicate merges."
- **NGO rating cardinality:** the achievement question (`C01`) allows multiple selections in the NGO
  questionnaire (joined with "; ") but single elsewhere — mind this if you tabulate that rating.
- **"International"** = three non-Jordanian/Syrian experts; never blank (a blank breaks the import).
- **Cleaning:** HTML/entities stripped, whitespace normalised, paragraph breaks kept, Arabic
  untouched, placeholder non-answers ("-", "n/a") → empty cells. Every change is logged in the manifest.
- **Personal data:** by default `responses.xlsx` includes respondent **names** — treat the files as
  confidential; use `--anonymise` to omit them.
- **Scope:** only *submitted* main-study responses (pilot and unfinished responses excluded).

---

## 13. Glossary
- **QDA** — Qualitative Data Analysis software (ATLAS.ti is one).
- **Document** — one respondent in ATLAS.ti.
- **Code / tag** — a label attached to a passage of text.
- **Code group** — a folder organising codes (namespace + questionnaire).
- **Document group** — a filterable respondent attribute (nationality, type, a rating).
- **Quotation** — a coded passage of text.
- **Namespace** — the `Q-Core` / `Q-Officials` … prefix that keeps codes from colliding.
- **Shared code** — one code deliberately reused across variants so identical questions merge.
- **Survey import / Codebook import** — the two ATLAS.ti wizards this export feeds.
