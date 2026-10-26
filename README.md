# EQ Raid Gear Comparison

Static GitHub Pages site that compares EverQuest raid T1 / T2 / BiS gear from **Torment of Velious** through **Favors of Fortune**.

BiS scoring follows [EQ Gear Management](https://github.com/) rules (class weights, non-lore wrists, MAG/BST/NEC pet-focus ears, three waist effect belts). Item stats are cached from EQ Resource in committed JSON, same pattern as EQGM Web.

## Pages

- [`index.html`](index.html) — class + two expansions + T1 / T2 / BiS, totals, % change chart, per-slot loadout
- [`weapons.html`](weapons.html) — T2 weapons list and skill-matched expansion comparison

## Cache

Committed under [`cache/`](cache/):

- `raid_bis_item_cache.json` — hydrated item details keyed by id
- `raid_bis_catalog_{code}.json` — per-expansion item lists (`tov`, `cov`, `tol`, `nos`, `ls`, `tob`, `sor`, `fof`)

Warm locally (uses parsers from sibling `EQGM_Web` or `EQ Gear Management`):

```powershell
cd "Armor Stats"
py -3 scripts/warm_cache.py --seed-from-eqgm-web
# Optional: only some expansions
py -3 scripts/warm_cache.py --expansions sor,tob
# If you already have a full item cache, rebuild catalogs from inspect.expansionCode:
py -3 scripts/build_catalogs_from_item_cache.py
# Fill Base Dmg / Delay / Skill on T2 weapons:
py -3 scripts/enrich_weapon_stats.py
```

Then commit `cache/`. Live EQ Resource is contacted only on a cache miss.

Favors of Fortune raid pages are EQ Resource Premium. With that session open in the Cursor browser, save the armor matrix and Tier 2 (Tradeskill) weapon lists through `scripts/fof_inbox.py`, then:

```powershell
py -3 scripts/import_fof.py
```

That fills `raid_bis_catalog_fof.json` (T1/T2 armor, T1/T2 non-visible slots, and T2 1-hand, 2-hand, hand-to-hand, and bows). Raw HTML stays in `cache/raw/` and is not committed.

Weights live in [`data/weights/`](data/weights/) (copied from EQGM). Keep scoring aligned with EQGM `raid_bis/compare.py`.

## Local preview

```powershell
py -3 -m http.server 8080
```

Open http://127.0.0.1:8080/

## Tests

```powershell
py -3 -m unittest tests.test_scoring -v
```

(`tests/scoring.test.mjs` mirrors the same fixtures for Node when available.)

## GitHub Pages

Serve the repo root from `main` (no build step).
