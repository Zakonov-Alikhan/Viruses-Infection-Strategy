import test from "node:test";
import assert from "node:assert/strict";
import { EVENT_ITEMS } from "./game.js";
import { getItemCategory, ITEM_CATEGORIES } from "./item-categories.js";
import russian from "./locale-ru.js";
import english from "./locale-en.js";

test("every game item has exactly one valid visual category", () => {
  const categories = new Set(Object.values(ITEM_CATEGORIES));
  assert.deepEqual(
    EVENT_ITEMS.filter((item) => !categories.has(getItemCategory(item))),
    []
  );
  assert.equal(new Set(EVENT_ITEMS.map(getItemCategory)).size, 5);
});

test("attack, defense, mobility, terrain, and unusual items are classified consistently", () => {
  assert.deepEqual({
    attack: ["bomb", "antiBomb", "pointDestroy"].map(getItemCategory),
    defense: ["shield", "gangstaShield"].map(getItemCategory),
    mobility: ["freePlacement", "extraTurn"].map(getItemCategory),
    terrain: ["debris"].map(getItemCategory),
    unusual: ["randomArtifact", "exchange"].map(getItemCategory)
  }, {
    attack: ["attack", "attack", "attack"],
    defense: ["defense", "defense"],
    mobility: ["mobility", "mobility"],
    terrain: ["terrain"],
    unusual: ["unusual", "unusual"]
  });
  assert.equal(getItemCategory("unknown-item"), null);
});

test("each item category has readable Russian and English labels", () => {
  for (const category of Object.values(ITEM_CATEGORIES)) {
    const key = `item.category.${category}`;
    assert.ok(russian[key], `missing Russian translation for ${key}`);
    assert.ok(english[key], `missing English translation for ${key}`);
  }
});
