-- 20260519170011_seed_pilot_v1_officials.sql
--
-- Pilot V1 Officials questionnaire seed data.
--
-- Source: ~/Downloads/yarmouk-mock/lib/questions.ts (verbatim copy of
-- both English and Arabic question text). After this migration applies,
-- the database is the source of truth — the mock is not authoritative.
--
-- Contents:
-- - 1 active questionnaire_versions row (variant='pilot_officials',
--   version_number=1, status='active', includes_feedback_block=TRUE)
-- - 14 main questions Q1-Q14 (order_index 1-14, is_feedback=FALSE).
--   Q10-Q13 are visible_nationalities=ARRAY['syrian'] per D32; the
--   rest are visible to all (NULL).
-- - 4 feedback questions F1-F4 (order_index 15-18, is_feedback=TRUE).
--   All shared (NULL visible_nationalities).
-- - 6 Draft placeholder rows in questionnaire_versions for the other
--   variants (status='draft', version_number=1, no questions attached).
--
-- Idempotency: explicit BEGIN/COMMIT + ON CONFLICT DO NOTHING on both
-- (variant, version_number) and (version_id, question_code). Re-running
-- is a no-op.
--
-- Partial unique index check: exactly one 'active' row inserted; all
-- other variants are 'draft'. one_active_version_per_variant satisfied.
--
-- Verification after apply:
--   SELECT count(*) FROM questions;                                       -- expect 18
--   SELECT count(*) FROM questionnaire_versions;                          -- expect 7
--   SELECT count(*) FROM questionnaire_versions WHERE status = 'active';  -- expect 1
--
-- Text encoding: UTF-8. English uses dollar-quoting ($en$...$en$) and
-- Arabic uses ($ar$...$ar$) so internal apostrophes / right-to-left
-- marks / em-dashes need no escaping.

BEGIN;

-- ---------- Active version: pilot_officials v1 ----------

INSERT INTO questionnaire_versions
  (type, variant, version_number, status, includes_feedback_block, published_at)
VALUES
  ('pilot', 'pilot_officials', 1, 'active', TRUE, NOW())
ON CONFLICT (variant, version_number) DO NOTHING;

-- ---------- Draft placeholders for the other 6 variants ----------
-- Pilot researchers/donors/NGOs gets includes_feedback_block=TRUE
-- per D9. Main variants are FALSE (CHECK constraint enforces).

INSERT INTO questionnaire_versions
  (type, variant, version_number, status, includes_feedback_block)
VALUES
  ('pilot', 'pilot_researchers_donors_ngos', 1, 'draft', TRUE),
  ('main',  'main_researchers',              1, 'draft', FALSE),
  ('main',  'main_donors',                   1, 'draft', FALSE),
  ('main',  'main_ngos',                     1, 'draft', FALSE),
  ('main',  'main_officials_jordanian',      1, 'draft', FALSE),
  ('main',  'main_officials_syrian',         1, 'draft', FALSE)
ON CONFLICT (variant, version_number) DO NOTHING;

-- ---------- 18 questions for pilot_officials v1 ----------
-- Q1-Q9, Q14: shared (visible_nationalities = NULL)
-- Q10-Q13: Syria-only (visible_nationalities = ARRAY['syrian'])
-- F1-F4: feedback block, shared

INSERT INTO questions
  (version_id, question_code, order_index, text_en, text_ar,
   is_feedback, is_required, visible_nationalities)
SELECT
  qv.id,
  q.question_code,
  q.order_index,
  q.text_en,
  q.text_ar,
  q.is_feedback,
  q.is_required,
  q.visible_nationalities
FROM (VALUES
  -- ===== Main questions Q1-Q14 =====
  ('Q1', 1,
    $en$How would you assess the overall performance of the 1987 Yarmouk Agreement in managing the shared water resources of the basin?$en$,
    $ar$كيف تُقيّم الأداء العام لاتفاقية اليرموك لعام 1987 في إدارة الموارد المائية المشتركة للحوض؟$ar$,
    FALSE, TRUE, NULL::nationality_type[]),

  ('Q2', 2,
    $en$The Yarmouk River's flow has declined significantly over the past decades. In your opinion, what are the main reasons for this decline — and to what extent has this decline affected the river's ecosystem and surrounding environment?$en$,
    $ar$شهد تدفق نهر اليرموك انخفاضاً ملحوظاً خلال العقود الماضية. برأيك، ما هي الأسباب الرئيسية لهذا الانخفاض — وإلى أي مدى أثّر هذا الانخفاض على النظام البيئي للنهر والبيئة المحيطة؟$ar$,
    FALSE, TRUE, NULL),

  ('Q3', 3,
    $en$In light of recent developments in Jordan–Syria relations, should an opportunity arise to revise the current Yarmouk Agreement, what key modifications would you recommend?$en$,
    $ar$في ضوء التطورات الأخيرة في العلاقات الأردنية السورية، وفي حال أُتيحت الفرصة لتعديل اتفاقية اليرموك الحالية، ما هي التعديلات الأساسية التي توصي بها؟$ar$,
    FALSE, TRUE, NULL),

  ('Q4', 4,
    $en$The 1987 Agreement focuses entirely on water allocation and does not address environmental protection in any form. How has this absence shaped the environmental condition of the Yarmouk basin over the past four decades — and what specific environmental provisions would you consider essential in any future agreement?$en$,
    $ar$تركّز اتفاقية 1987 بالكامل على تخصيص المياه ولا تتناول حماية البيئة بأي شكل. كيف أثّر هذا الغياب على الوضع البيئي لحوض اليرموك خلال العقود الأربعة الماضية — وما هي الأحكام البيئية المحددة التي تعتبرها ضرورية في أي اتفاقية مستقبلية؟$ar$,
    FALSE, TRUE, NULL),

  ('Q5', 5,
    $en$The Agreement covers surface water but does not mention groundwater. From your experience, has this gap created problems in managing the basin?$en$,
    $ar$تتناول الاتفاقية المياه السطحية لكنها لا تتطرق للمياه الجوفية. من واقع تجربتك، هل تسبّب هذا الغياب بمشاكل في إدارة الحوض؟$ar$,
    FALSE, TRUE, NULL),

  ('Q6', 6,
    $en$A joint data-sharing platform has recently been launched for the Yarmouk basin. Does this platform include historical data from previous decades, or only new data going forward? How can the continuity and sustainability of this data collection mechanism be ensured over the long term?$en$,
    $ar$تم مؤخراً إطلاق منصة مشتركة لتبادل البيانات حول حوض اليرموك. هل تشمل هذه المنصة البيانات التاريخية من العقود الماضية أم فقط البيانات الجديدة؟ وكيف يمكن ضمان استمرارية آلية جمع البيانات هذه واستدامتها على المدى البعيد؟$ar$,
    FALSE, TRUE, NULL),

  ('Q7', 7,
    $en$Which environmental impacts do you consider most severe from your country's perspective, and what practical steps have been — or should be — taken by both governments to address biodiversity, riparian vegetation, water quality, or ecosystem health?$en$,
    $ar$أي من هذه الآثار البيئية تعتبره الأكثر خطورة من منظور بلدك، وما هي الخطوات العملية التي اتُّخذت — أو ينبغي اتخاذها — من قبل الحكومتين لمعالجتها من حيث التنوع الحيوي أو الغطاء النباتي على ضفاف النهر أو جودة المياه أو صحة النظام البيئي؟$ar$,
    FALSE, TRUE, NULL),

  ('Q8', 8,
    $en$How much water does the Al Wehda Dam actually receive annually compared to its design capacity? What factors explain this shortfall, and what are the downstream environmental impacts?$en$,
    $ar$كم تبلغ كمية المياه التي يستقبلها سد الوحدة فعلياً سنوياً مقارنةً بسعته التصميمية؟ ما هي العوامل التي تُفسّر هذا العجز، وما هي الآثار البيئية على المجرى السفلي؟$ar$,
    FALSE, TRUE, NULL),

  ('Q9', 9,
    $en$Under the 1994 Peace Treaty, Israel receives 25 MCM per year from the Yarmouk. How is this commitment managed when upstream flows have dropped significantly?$en$,
    $ar$بموجب معاهدة السلام لعام 1994، تحصل إسرائيل على 25 مليون متر مكعب سنوياً من اليرموك. كيف تتم إدارة هذا الالتزام في ظل الانخفاض الكبير في التدفقات من أعلى المجرى؟$ar$,
    FALSE, TRUE, NULL),

  -- ===== Syria-only questions Q10-Q13 =====
  ('Q10', 10,
    $en$The agreement's annex specifies 26 dams. Jordan estimates that significantly more have been built. What was the rationale for the additional dams, and were they coordinated through the Joint Committee?$en$,
    $ar$يُحدد ملحق الاتفاقية 26 سداً. تُقدّر الأردن أن عدداً أكبر بكثير قد أُنشئ. ما هي الأسباب التي دعت لبناء السدود الإضافية، وهل تم التنسيق بشأنها من خلال اللجنة المشتركة؟$ar$,
    FALSE, TRUE, ARRAY['syrian']::nationality_type[]),

  ('Q11', 11,
    $en$Article VII addresses springs above the 250-metre elevation, but the agreement does not mention groundwater. Given that the Basalt Aquifer is hydraulically connected to these springs, how should groundwater use be addressed in the current or any future agreement?$en$,
    $ar$تتناول المادة السابعة الينابيع فوق منسوب 250 متراً، لكن الاتفاقية لا تذكر المياه الجوفية. بما أن طبقة البازلت المائية مرتبطة هيدرولوجياً بهذه الينابيع، كيف ينبغي معالجة موضوع المياه الجوفية في الاتفاقية الحالية أو أي اتفاقية مستقبلية؟$ar$,
    FALSE, TRUE, ARRAY['syrian']::nationality_type[]),

  ('Q12', 12,
    $en$As Syria moves into a new phase of development, how does the government plan to balance agricultural water needs in the Yarmouk basin with the commitments under the bilateral agreement with Jordan?$en$,
    $ar$مع دخول سوريا مرحلة جديدة من التنمية، كيف تخطط الحكومة للموازنة بين الاحتياجات المائية الزراعية في حوض اليرموك والالتزامات بموجب الاتفاقية الثنائية مع الأردن؟$ar$,
    FALSE, TRUE, ARRAY['syrian']::nationality_type[]),

  ('Q13', 13,
    $en$What is the current environmental status of the Yarmouk basin on the Syrian side — in terms of water quality, land degradation, and the impacts of the conflict period on water infrastructure?$en$,
    $ar$ما هو الوضع البيئي الحالي لحوض اليرموك على الجانب السوري — من حيث جودة المياه وتدهور الأراضي وتأثيرات فترة النزاع على البنية التحتية المائية؟$ar$,
    FALSE, TRUE, ARRAY['syrian']::nationality_type[]),

  -- ===== Shared closer Q14 =====
  ('Q14', 14,
    $en$Is there anything else you would like to share regarding the 1987 Agreement, the environmental status of the Yarmouk basin, or the future of transboundary cooperation?$en$,
    $ar$هل هناك أي شيء آخر تودّ مشاركته بخصوص اتفاقية 1987، أو الوضع البيئي لحوض اليرموك، أو مستقبل التعاون العابر للحدود؟$ar$,
    FALSE, TRUE, NULL),

  -- ===== Feedback block F1-F4 =====
  ('F1', 15,
    $en$Were any questions unclear or difficult to understand? Please specify.$en$,
    $ar$هل كانت أي من الأسئلة غير واضحة أو صعبة الفهم؟ يرجى التوضيح.$ar$,
    TRUE, TRUE, NULL),

  ('F2', 16,
    $en$Were any questions too long?$en$,
    $ar$هل كانت أي من الأسئلة طويلة جداً؟$ar$,
    TRUE, TRUE, NULL),

  ('F3', 17,
    $en$Was any important topic missing from the questions?$en$,
    $ar$هل كان هناك أي موضوع مهم مفقود من الأسئلة؟$ar$,
    TRUE, TRUE, NULL),

  ('F4', 18,
    $en$How long did it take you to complete all questions?$en$,
    $ar$كم من الوقت استغرقت للإجابة على جميع الأسئلة؟$ar$,
    TRUE, TRUE, NULL)
) AS q(question_code, order_index, text_en, text_ar,
       is_feedback, is_required, visible_nationalities)
CROSS JOIN (
  SELECT id FROM questionnaire_versions
   WHERE variant = 'pilot_officials' AND version_number = 1
) AS qv
ON CONFLICT (version_id, question_code) DO NOTHING;

COMMIT;
