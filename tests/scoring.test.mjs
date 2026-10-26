/**
 * Fixture tests for EQGM-aligned scoring.
 * Run: node --test tests/scoring.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Node cannot fetch; inject weight tables before importing scoring helpers.
const roles = JSON.parse(readFileSync(join(root, "data/weights/roles.json"), "utf8"));
const classes = JSON.parse(readFileSync(join(root, "data/weights/classes.json"), "utf8"));
const overlays = JSON.parse(readFileSync(join(root, "data/weights/slot_overlays.json"), "utf8"));

const weightsUrl = pathToFileURL(join(root, "js/weights.js")).href;
const scoringUrl = pathToFileURL(join(root, "js/scoring.js")).href;

const weights = await import(weightsUrl);
// Monkey-patch tables via loadWeightTables replacement
weights.loadWeightTables = async () => ({
  roles: roles.roles,
  classes: classes.classes,
  overlays: overlays.overlays,
});
// Directly set by calling internal path: re-import after injecting
// weights.js keeps tables private; call loadWeightTables with a custom approach:
// Patch fetch for Node.
globalThis.fetch = async (url) => {
  const path = String(url).replace(/.*data\/weights\//, "");
  const file = join(root, "data/weights", path);
  const body = readFileSync(file, "utf8");
  return {
    ok: true,
    json: async () => JSON.parse(body),
  };
};

await weights.loadWeightTables(pathToFileURL(join(root, "data/weights")).href.replace(/\/$/, "") + "/../weights".replace("weights/../weights", "weights"));
// Simpler: absolute file paths won't work with relative fetch. Load manually:
const tablesMod = await import(weightsUrl);
// Re-load using file:// relative hack — loadWeightTables expects HTTP paths.
// Instead patch by evaluating resolve after setting tables through a test helper.

// Force-load: recreate merge by importing and calling with mocked fetch that maps any URL ending in roles/classes/overlays.
globalThis.fetch = async (url) => {
  const u = String(url);
  let file;
  if (u.includes("roles.json")) file = join(root, "data/weights/roles.json");
  else if (u.includes("classes.json")) file = join(root, "data/weights/classes.json");
  else if (u.includes("slot_overlays.json")) file = join(root, "data/weights/slot_overlays.json");
  else throw new Error(`unexpected fetch ${u}`);
  return { ok: true, json: async () => JSON.parse(readFileSync(file, "utf8")) };
};

await tablesMod.loadWeightTables("data/weights");
const scoring = await import(scoringUrl);

describe("scoring fixtures", () => {
  it("lets T1 beat T2 when class weights prefer it", () => {
    const catalog = [
      {
        item_id: 1,
        name: "T2 Ear Weak",
        tier: "T2",
        classes: ["WAR"],
        slots: ["Ear"],
        stats: { hp: 100, hdex: 10, ac: 10 },
      },
      {
        item_id: 2,
        name: "T1 Ear Strong",
        tier: "T1",
        classes: ["WAR"],
        slots: ["Ear"],
        stats: { hp: 100, hdex: 50, ac: 10 },
      },
      {
        item_id: 3,
        name: "T2 Ear Stronger",
        tier: "T2",
        classes: ["WAR"],
        slots: ["Ear"],
        stats: { hp: 100, hdex: 40, ac: 10 },
      },
    ];
    const loadout = scoring.buildIdealLoadout(catalog, "WAR", "BIS");
    // Ear-1 should be the highest HDex among both tiers: T1 Ear Strong (50)
    assert.equal(loadout["Ear-1"].name, "T1 Ear Strong");
    assert.equal(loadout["Ear-1"].tier, "T1");
  });

  it("pins MAG pet-focus ear by Enhanced Minion level", () => {
    const catalog = [
      {
        item_id: 10,
        name: "Summoner Stud Weak Stats",
        tier: "T2",
        classes: ["MAG", "BST", "NEC"],
        slots: ["Ear"],
        focus: "Enhanced Minion VIII",
        stats: { hp: 10, hint: 1 },
      },
      {
        item_id: 11,
        name: "Caster Ear Huge Stats",
        tier: "T2",
        classes: ["MAG"],
        slots: ["Ear"],
        focus: "",
        stats: { hp: 99999, hint: 99 },
      },
      {
        item_id: 12,
        name: "Summoner Stud Higher EM",
        tier: "T1",
        classes: ["MAG", "BST", "NEC"],
        slots: ["Ear"],
        focus: "Enhanced Minion X",
        stats: { hp: 5, hint: 1 },
      },
    ];
    const loadout = scoring.buildIdealLoadout(catalog, "MAG", "BIS");
    assert.equal(loadout["Ear-1"].name, "Summoner Stud Higher EM");
    assert.ok(scoring.isPetFocusEar(loadout["Ear-1"]));
  });

  it("locks waist by role (effect fallback)", () => {
    const catalog = [
      {
        item_id: 20,
        name: "Belt Overdrive",
        tier: "T2",
        classes: [],
        class_all: true,
        slots: ["Waist"],
        effect: "Overdrive Punch",
        stats: { hp: 100, hdex: 20 },
      },
      {
        item_id: 21,
        name: "Belt Boon",
        tier: "T2",
        classes: [],
        class_all: true,
        slots: ["Waist"],
        effect: "Treaded Boon of Potential",
        stats: { hp: 100, hdex: 40 },
      },
      {
        item_id: 22,
        name: "Belt Slicer",
        tier: "T2",
        classes: [],
        class_all: true,
        slots: ["Waist"],
        effect: "Crippling Slicer",
        stats: { hp: 100, hdex: 10 },
      },
      {
        item_id: 23,
        name: "Belt Random High",
        tier: "T2",
        classes: [],
        class_all: true,
        slots: ["Waist"],
        effect: "Something Else",
        stats: { hp: 100, hdex: 99 },
      },
    ];
    assert.equal(scoring.buildIdealLoadout(catalog, "ROG", "BIS").Waist.name, "Belt Overdrive");
    assert.equal(scoring.buildIdealLoadout(catalog, "WAR", "BIS").Waist.name, "Belt Slicer");
    assert.equal(scoring.buildIdealLoadout(catalog, "WIZ", "BIS").Waist.name, "Belt Boon");
    const choices = scoring.waistChoicesForClass(
      catalog.map(scoring.normalizeItem),
      "ROG"
    );
    assert.equal(choices.length, 1);
    assert.equal(choices[0][0], "Acrobat's Belt");
  });

  it("prefers named role belts over higher-stat effect matches", () => {
    const catalog = [
      {
        item_id: 40,
        name: "Acrobat's Belt of Rebellion",
        tier: "T2",
        classes: [],
        class_all: true,
        slots: ["Waist"],
        effect: "Overdrive Punch",
        stats: { hp: 50, hdex: 5 },
      },
      {
        item_id: 41,
        name: "Defender's Waistguard of Rebellion",
        tier: "T2",
        classes: [],
        class_all: true,
        slots: ["Waist"],
        effect: "Crippling Slicer",
        stats: { hp: 50, ac: 5 },
      },
      {
        item_id: 42,
        name: "Mystic's Sash of Rebellion",
        tier: "T2",
        classes: [],
        class_all: true,
        slots: ["Waist"],
        effect: "Expanding Mind",
        focus: "Treaded Boon of Potential",
        stats: { hp: 50, hint: 5 },
      },
      {
        item_id: 43,
        name: "Other Overdrive",
        tier: "T2",
        classes: [],
        class_all: true,
        slots: ["Waist"],
        effect: "Overdrive Punch",
        stats: { hp: 999, hdex: 99 },
      },
    ];
    assert.equal(
      scoring.buildIdealLoadout(catalog, "MNK", "BIS").Waist.name,
      "Acrobat's Belt of Rebellion"
    );
    assert.equal(
      scoring.buildIdealLoadout(catalog, "PAL", "BIS").Waist.name,
      "Defender's Waistguard of Rebellion"
    );
    assert.equal(
      scoring.buildIdealLoadout(catalog, "ENC", "BIS").Waist.name,
      "Mystic's Sash of Rebellion"
    );
  });

  it("pins the ranger-only bow in the ranger range slot", () => {
    const catalog = [
      {
        item_id: 30,
        name: "All Class Idol",
        tier: "T2",
        classes: [],
        class_all: true,
        slots: ["Range"],
        stats: { hp: 99999, hdex: 99, ac: 99 },
      },
      {
        item_id: 31,
        name: "Short Bow",
        tier: "T2",
        classes: ["WAR", "PAL", "SHD", "ROG"],
        slots: ["Range"],
        skill: "Archery",
        stats: { hp: 5000, hdex: 40, ac: 40 },
      },
      {
        item_id: 32,
        name: "Ranger Longbow",
        tier: "T2",
        classes: ["RNG"],
        slots: ["Range"],
        skill: "Archery",
        stats: { hp: 100, hdex: 5, ac: 5 },
      },
    ];
    const ranger = scoring.buildIdealLoadout(catalog, "RNG", "T2");
    assert.equal(ranger.Range.name, "Ranger Longbow");
    assert.ok(scoring.isRangerOnlyBow(ranger.Range));
    const warrior = scoring.buildIdealLoadout(catalog, "WAR", "T2");
    assert.equal(warrior.Range.name, "All Class Idol");
  });
});
