-- Reference data baseline (A1.1): grade levels, rank thresholds and Round 1 ship as a data migration instead of the
-- config seed. Migrations run in a fixed order before the seed, so later data migrations (e.g. confirmed grade
-- bands or rank thresholds) always find these rows on a fresh database too.
-- Each INSERT runs only while its table is empty: databases seeded before this migration keep their rows and every
-- admin edit. Later data migrations must match rows by natural key (label, sort_order, name), never by id.
-- Values marked PLACEHOLDER in docs await client confirmation (OPEN-QUESTIONS #3 bands, #13 thresholds).

INSERT INTO "grade_levels" ("id", "label", "sort_order", "category")
SELECT gen_random_uuid(), v.label, v.sort_order, v.category::"Category"
FROM (VALUES
  ('Class 5 / PYP 5 / Taisir', 1, 'activist'),
  ('Class 6 / MYP 1 / Mizan', 2, 'activist'),
  ('Class 7 / MYP 2 / Nahbemir', 3, 'activist'),
  ('Class 8 / MYP 3 / Hidayatunnah', 4, 'activist'),
  ('Class 9 / MYP 4 / Kafiya & Bekaya', 5, 'ambassador'),
  ('Class 10 / MYP 5', 6, 'ambassador'),
  ('SSC / O Level / Dakhil Candidate', 7, 'ambassador'),
  ('Class 11 / DP 1 / Jalalayn', 8, 'ambassador'),
  ('Class 12 / DP 2', 9, 'ambassador'),
  ('HSC / A Level / Alim Candidate', 10, 'ambassador'),
  ('University Admission Candidate / Musannif', 11, 'achiever'),
  ('University 1st Year / Diploma 1st Year / Fazil / Mishkat', 12, 'achiever'),
  ('University 2nd Year / Diploma 2nd Year', 13, 'achiever'),
  ('University 3rd Year / Diploma 3rd Year', 14, 'achiever'),
  ('University 4th Year / Diploma 4th Year', 15, 'achiever'),
  ('University 5th Year & Intern / Kamil / Dawrah', 16, 'achiever'),
  ('Postgraduate (Masters) and Above', 17, 'achiever')
) AS v(label, sort_order, category)
WHERE NOT EXISTS (SELECT 1 FROM "grade_levels");

INSERT INTO "rank_thresholds" ("id", "name", "min_points")
SELECT gen_random_uuid(), v.name, v.min_points
FROM (VALUES ('Bronze', 0), ('Silver', 100), ('Gold', 250)) AS v(name, min_points)
WHERE NOT EXISTS (SELECT 1 FROM "rank_thresholds");

INSERT INTO "rounds" ("id", "name", "sort_order", "type")
SELECT gen_random_uuid(), 'Round 1', 1, 'quiz'::"RoundType"
WHERE NOT EXISTS (SELECT 1 FROM "rounds");
