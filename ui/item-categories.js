export const ITEM_CATEGORIES = Object.freeze({
  attack: "attack",
  defense: "defense",
  mobility: "mobility",
  terrain: "terrain",
  unusual: "unusual"
});

const ITEM_CATEGORY_BY_TYPE = Object.freeze({
  bomb: ITEM_CATEGORIES.attack,
  pointDestroy: ITEM_CATEGORIES.attack,
  antiBomb: ITEM_CATEGORIES.attack,
  shield: ITEM_CATEGORIES.defense,
  gangstaShield: ITEM_CATEGORIES.defense,
  freePlacement: ITEM_CATEGORIES.mobility,
  extraTurn: ITEM_CATEGORIES.mobility,
  debris: ITEM_CATEGORIES.terrain,
  randomArtifact: ITEM_CATEGORIES.unusual,
  exchange: ITEM_CATEGORIES.unusual
});

export function getItemCategory(itemType) {
  return ITEM_CATEGORY_BY_TYPE[itemType] ?? null;
}

export function getItemCategoryLocalizationKey(itemType) {
  const category = getItemCategory(itemType);
  return category ? `item.category.${category}` : null;
}
