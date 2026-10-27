/**
 * T2 weapon lines match across expansions by class, hand, delay, and proc.
 * Run: node --test tests/weapon_match.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = await import(pathToFileURL(join(root, "js/data.js")).href);
const { isWeaponItem, weaponHand, weaponLineLabel, weaponMatchKey, weaponProcSignature } = data;

const ORDER = ["tov", "cov", "tol", "nos", "ls", "tob", "sor", "fof"];

function loadWeapons() {
  const byExp = {};
  for (const file of readdirSync(join(root, "cache"))) {
    const match = file.match(/^raid_bis_catalog_([a-z]+)\.json$/);
    if (!match) continue;
    const payload = JSON.parse(readFileSync(join(root, "cache", file), "utf8"));
    const items = payload.catalog?.items || [];
    byExp[match[1]] = items.filter(isWeaponItem);
  }
  return byExp;
}

const weapons = loadWeapons();

function classesOf(item) {
  return [...(item.classes || [])].map((c) => c.toUpperCase()).sort().join(",");
}

function findLine(predicate) {
  const hits = [];
  for (const code of ORDER) {
    for (const item of weapons[code] || []) {
      if (predicate(item, code)) hits.push({ code, item, key: weaponMatchKey(item) });
    }
  }
  return hits;
}

describe("proc identity", () => {
  it("strips ranks and collapses rotating damage procs", () => {
    assert.equal(weaponProcSignature({ effect: "Stunning Snap II" }), "stunning snap");
    assert.equal(weaponProcSignature({ effect: "Hand of Holy Wrath XIII" }), "hand of holy wrath");
    assert.equal(weaponProcSignature({ effect: "Alleviating Burst XXI" }), "alleviating burst");
    assert.equal(weaponProcSignature({ effect: "Spike of Ice" }), "elemental");
    assert.equal(weaponProcSignature({ effect: "Vector of Sickness" }), "elemental");
    assert.equal(weaponProcSignature({ effect: "Devout Rune" }), "devout rune");
    assert.equal(
      weaponProcSignature({ effect: "Prismatic Ward XXXIII; Burst of Flames; Improved Dodge VII" }),
      "improved dodge+prismatic ward",
    );
    assert.equal(
      weaponProcSignature({ effect: "Prismatic Ward XXXII; Strike of the Archer XV; Improved Dodge VII" }),
      "improved dodge+prismatic ward+strike of the archer",
    );
  });
});

describe("weapon lines", () => {
  it("gives every weapon in an expansion its own line", () => {
    for (const code of ORDER) {
      const seen = new Map();
      for (const item of weapons[code] || []) {
        const key = weaponMatchKey(item);
        assert.equal(seen.has(key), false, `${code} collision ${seen.get(key)} vs ${item.name} (${key})`);
        seen.set(key, item.name);
      }
    }
  });

  it("keeps class-specific 1H and 2H lines together when damage type and name change", () => {
    const pal1h = findLine((item) => classesOf(item) === "PAL,SHD" && weaponHand(item) === "1h");
    assert.equal(new Set(pal1h.map((h) => h.key)).size, 1);
    assert.equal(pal1h.length, ORDER.length);
    assert.ok(pal1h.some((h) => /war hammer/i.test(h.item.name)));
    assert.ok(pal1h.some((h) => /war sword/i.test(h.item.name) && /slash/i.test(h.item.skill)));
    assert.ok(pal1h.some((h) => /broadsword/i.test(h.item.name) && /blunt/i.test(h.item.skill)));

    const pal2h = findLine((item) => classesOf(item) === "PAL,SHD" && weaponHand(item) === "2h");
    assert.equal(new Set(pal2h.map((h) => h.key)).size, 1);
    assert.ok(pal2h.some((h) => /spear/i.test(h.item.name) && /pierc/i.test(h.item.skill)));
    assert.ok(pal2h.some((h) => /great\s?sword|claymore/i.test(h.item.name)));

    const mnk1h = findLine((item) => classesOf(item) === "BST,MNK" && weaponHand(item) === "1h");
    assert.equal(new Set(mnk1h.map((h) => h.key)).size, 1);
    assert.ok(mnk1h.some((h) => /battle rod|baton|club/i.test(h.item.name)));

    const mnk2h = findLine((item) => classesOf(item) === "BST,MNK" && weaponHand(item) === "2h");
    assert.equal(new Set(mnk2h.map((h) => h.key)).size, 1);
  });

  it("does not pair a warrior broadsword with a paladin broadsword", () => {
    const war = findLine((item) => classesOf(item) === "WAR" && weaponHand(item) === "1h");
    const pal = findLine((item) => classesOf(item) === "PAL,SHD" && weaponHand(item) === "1h");
    assert.equal(new Set(war.map((h) => h.key)).size, 1);
    assert.notEqual(war[0].key, pal[0].key);
  });

  it("keeps the two same-delay melee lines apart while each stays stable", () => {
    const melee = findLine((item) => classesOf(item) === "BRD,RNG,ROG,WAR" && weaponHand(item) === "1h");
    const keys = new Set(melee.map((h) => h.key));
    assert.equal(keys.size, 2);
    for (const key of keys) {
      const codes = new Set(melee.filter((h) => h.key === key).map((h) => h.code));
      assert.equal(codes.size, ORDER.length);
    }
  });

  it("matches caster wands with the piercing ritual dagger, not the athame", () => {
    const casters = findLine((item) => classesOf(item) === "ENC,MAG,NEC,WIZ" && weaponHand(item) === "1h");
    const byKey = new Map();
    for (const hit of casters) {
      if (!byKey.has(hit.key)) byKey.set(hit.key, []);
      byKey.get(hit.key).push(hit);
    }
    assert.equal(byKey.size, 2);
    const lines = [...byKey.values()];
    const daggerLine = lines.find((line) => line.some((h) => /ritual dagger|wand/i.test(h.item.name)));
    const athameLine = lines.find((line) => line.some((h) => /athame/i.test(h.item.name)));
    assert.ok(daggerLine.some((h) => /wand/i.test(h.item.name) && /blunt/i.test(h.item.skill)));
    assert.ok(daggerLine.some((h) => /ritual dagger/i.test(h.item.name) && /pierc/i.test(h.item.skill)));
    assert.ok(athameLine.every((h) => /athame/i.test(h.item.name)));
    assert.notEqual(daggerLine[0].key, athameLine[0].key);
  });

  it("matches bows by class, not by the shared longbow name", () => {
    const bows = findLine((item) => weaponHand(item) === "bow");
    const keys = new Set(bows.map((h) => h.key));
    assert.equal(keys.size, 2);
    const ranger = bows.filter((h) => classesOf(h.item) === "RNG");
    const group = bows.filter((h) => classesOf(h.item) !== "RNG");
    assert.equal(new Set(ranger.map((h) => h.key)).size, 1);
    assert.equal(new Set(group.map((h) => h.key)).size, 1);
    assert.notEqual(ranger[0].key, group[0].key);
  });

  it("labels a renamed class line from the stable proc", () => {
    const pal = findLine((item) => classesOf(item) === "PAL,SHD" && weaponHand(item) === "1h");
    assert.equal(weaponLineLabel(pal[0].item), "1H · PAL, SHD · Devout Rune");
    const rogue = findLine((item) => classesOf(item) === "ROG");
    assert.equal(new Set(rogue.map((h) => h.key)).size, 1);
    assert.equal(weaponLineLabel(rogue[0].item), "1H · ROG · Injection of Poison");
  });
});
