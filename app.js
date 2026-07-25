/* ============================================================
   RUSTLE UP — a fully local recipe manager, meal planner and
   shopping list. Everything lives in IndexedDB on this device.

   Data model:
   - recipes: the recipe library (IndexedDB object store).
   - meta.mealPlan: array of {id, recipeId|null, title, ingredients}.
     recipeId-linked entries always look up live from the recipe;
     manual entries carry their own title/ingredients.
   - meta.shopItems: the shopping list. Independent of the meal
     plan -- nothing here is added automatically. Each item is
     {id, catalogId|null, mergeKey, name, quantity, unit, step,
      checked, staple, meals}.
   - meta.itemCatalog: your reusable item list (name, aliases,
     staple flag, unit/step/default quantity) used for autocomplete
     and for matching differently-worded ingredients together.
   - meta.shopOrderMain / meta.shopOrderStaple: the last order you
     saved with "Update order" -- new items slot in next to their
     nearest recognized neighbour from that saved order.
   ============================================================ */

const DB_NAME = "recipe-box";
const DB_VERSION = 1;
const STORE = "recipes";
let db;
let currentTab = "recipes";
let currentSearch = "";
let currentTagFilter = "";
let currentShopSearch = "";
let pendingImport = null; // recipes parsed but awaiting serves confirmation
let showCheckedItems = false;
let shopSelectMode = false;
let selectedShopIds = new Set();
let mealPlanNotesOpen = false;
let shopNotesOpen = false;

const DEFAULT_ITEM_CATALOG = [
  { id: "salt", name: "Salt", staple: true, aliases: ["salt"], unit: "", step: 1, defaultQty: 1 },
  { id: "black-pepper", name: "Black pepper", staple: true, aliases: ["black pepper", "pepper"], unit: "", step: 1, defaultQty: 1 },
  { id: "olive-oil", name: "Olive oil", staple: true, aliases: ["olive oil", "extra virgin olive oil"], unit: "", step: 1, defaultQty: 1 },
  { id: "cooking-oil", name: "Cooking oil", staple: true, aliases: ["vegetable oil", "sesame oil", "sunflower oil"], unit: "", step: 1, defaultQty: 1 },
  { id: "sugar", name: "Sugar", staple: true, aliases: ["sugar"], unit: "", step: 1, defaultQty: 1 },
  { id: "flour", name: "Plain flour", staple: true, aliases: ["plain flour", "flour"], unit: "", step: 1, defaultQty: 1 },
  { id: "vinegar", name: "Vinegar", staple: true, aliases: ["vinegar"], unit: "", step: 1, defaultQty: 1 },
  { id: "soy-sauce", name: "Soy sauce", staple: true, aliases: ["soy sauce"], unit: "", step: 1, defaultQty: 1 },
  { id: "stock-cube", name: "Stock cubes", staple: true, aliases: ["stock cube", "stock cubes"], unit: "", step: 1, defaultQty: 1 },
  { id: "rice-pouch", name: "Basmati rice (pouch)", staple: false,
    aliases: ["rice sachet", "packet of rice", "wholegrain rice", "basmati rice", "wholegrain basmati rice", "cooked rice"], unit: "", step: 1, defaultQty: 1 }
];

function genId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("meta")) {
        database.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function getAllRecipes() {
  return new Promise((resolve, reject) => {
    const req = tx(STORE, "readonly").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function putRecipe(recipe) {
  return new Promise((resolve, reject) => {
    const req = tx(STORE, "readwrite").put(recipe);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function deleteRecipe(id) {
  return new Promise((resolve, reject) => {
    const req = tx(STORE, "readwrite").delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function getMeta(key) {
  return new Promise((resolve) => {
    const req = tx("meta", "readonly").get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => resolve(null);
  });
}

function setMeta(key, value) {
  return new Promise((resolve, reject) => {
    const req = tx("meta", "readwrite").put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/* ---------- Global undo toast ----------
   Every destructive action (delete, clear, edit) routes through this
   instead of a confirm() dialog: do the action immediately, then show
   a toast with an Undo button for a few seconds. */

let toastUndoFn = null;
let toastRefreshFn = null;
let toastTimer = null;

function showToast(message, undoFn, refreshFn, actionLabel, durationMs) {
  clearTimeout(toastTimer);
  toastUndoFn = undoFn || null;
  toastRefreshFn = refreshFn || null;
  const toast = document.getElementById("undoToast");
  document.getElementById("undoToastMsg").textContent = message;
  const btn = document.getElementById("undoToastBtn");
  btn.style.display = undoFn ? "" : "none";
  btn.textContent = actionLabel || "Undo";
  toast.classList.remove("hidden");
  toastTimer = setTimeout(hideToast, durationMs || 7000);
}

function hideToast() {
  document.getElementById("undoToast").classList.add("hidden");
  toastUndoFn = null;
  toastRefreshFn = null;
}

/* ---------- Meta-backed collections ---------- */

async function getMealPlan() { return (await getMeta("mealPlan")) || []; }
async function saveMealPlan(entries) { await setMeta("mealPlan", entries); }

async function getShopItems() { return (await getMeta("shopItems")) || []; }
async function saveShopItems(items) { await setMeta("shopItems", items); }

async function getItemCatalog() { return (await getMeta("itemCatalog")) || []; }
async function saveItemCatalog(cat) { await setMeta("itemCatalog", cat); }
async function seedItemCatalogIfEmpty() {
  const existing = await getItemCatalog();
  if (existing.length > 0) return;
  // Migrate a previous version's ingredient catalog if present, otherwise seed defaults.
  const legacy = await getMeta("ingredientCatalog");
  if (legacy && legacy.length > 0) {
    await saveItemCatalog(legacy.map(e => ({
      id: e.id, name: e.name, aliases: e.aliases || [], staple: !!e.staple,
      unit: "", step: 1, defaultQty: 1
    })));
  } else {
    await saveItemCatalog(DEFAULT_ITEM_CATALOG.map(e => ({ ...e })));
  }
}

async function getMealPlanNotes() { return (await getMeta("mealPlanNotes")) || ""; }
async function saveMealPlanNotesText(text) { await setMeta("mealPlanNotes", text); }
async function getShopNotes() { return (await getMeta("shopNotes")) || ""; }
async function saveShopNotesText(text) { await setMeta("shopNotes", text); }

// Shared collapsible notes card used by both the Meal Plan and Shopping
// List tabs. Rendered into its own container so toggling/saving never
// re-renders (and loses focus on) anything else on the page.
function renderNotesCard(id, notes, isOpen, placeholder) {
  const preview = notes.trim() ? notes.trim().split("\n")[0] : "";
  return `<div class="notes-card">
    <button class="notes-toggle ${isOpen ? "open" : ""}" id="${id}Toggle">
      <span class="chevron">▸</span><span>Notes</span>
      ${!isOpen && preview ? `<span class="notes-preview">– ${escapeHtml(preview)}</span>` : ""}
    </button>
    ${isOpen ? `<div class="notes-body"><textarea id="${id}Text" placeholder="${escapeAttr(placeholder)}">${escapeHtml(notes)}</textarea></div>` : ""}
  </div>`;
}

/* ---------- Ingredient quantity parsing, merging & scaling ----------
   Best-effort: cookbook ingredient lines are messy free text, so this
   only merges/scales when it can confidently extract a quantity and
   name. Anything it can't parse is left untouched. */

const UNIT_MAP = {
  g: "g", gram: "g", grams: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg",
  ml: "ml", millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml",
  l: "l", litre: "l", litres: "l", liter: "l", liters: "l",
  cm: "cm",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  clove: "clove", cloves: "clove",
  head: "head", heads: "head",
  bunch: "bunch", bunches: "bunch",
  tin: "tin", tins: "tin", can: "tin", cans: "tin"
};
const WORD_UNITS = ["clove", "head", "bunch", "tin"];

function normalizeUnit(u) { return UNIT_MAP[u.toLowerCase()] || u.toLowerCase(); }

function unitTypeOf(unit) {
  if (unit === "g" || unit === "kg") return "weight";
  if (unit === "ml" || unit === "l") return "volume";
  return "count";
}

function stepForUnit(unit) {
  if (unit === "g" || unit === "ml") return 50;
  if (unit === "kg" || unit === "l") return 0.5;
  return 1;
}

function parseQtyToken(tok) {
  const fracMap = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
  if (fracMap[tok] !== undefined) return fracMap[tok];
  if (tok.indexOf("/") !== -1) {
    const parts = tok.split("/");
    const n = Number(parts[0]), d = Number(parts[1]);
    if (d) return n / d;
  }
  return parseFloat(tok);
}

function cleanIngredientName(name) {
  let n = name.trim();
  n = n.replace(/^(a|an|of)\s+/i, "");
  n = n.replace(/^(tins?|cans?|packets?|sachets?|jars?|bags?)\s+of\s+/i, "");
  return n.trim();
}

function extractParenWeight(name) {
  const m = name.match(/\((\d+(?:\.\d+)?)\s*(g|kg|ml|l)\)\s*$/i);
  if (!m) return { name, parenAmount: null, parenUnit: null };
  return { name: name.slice(0, m.index).trim(), parenAmount: parseFloat(m[1]), parenUnit: normalizeUnit(m[2]) };
}

function parseIngredient(raw) {
  const text = raw.trim();

  // "N x SIZEunit ..." e.g. "2 x 400g tins of chickpeas"
  let m = text.match(/^(\d+(?:\.\d+)?|\d+\/\d+|½|¼|¾|⅓|⅔)\s*x\s*(\d+(?:\.\d+)?)\s*(g|kg|ml|l)\b\s*(.*)$/i);
  if (m) {
    const packCount = parseQtyToken(m[1]);
    const packSize = parseFloat(m[2]);
    const unit = normalizeUnit(m[3]);
    const extracted = extractParenWeight(cleanIngredientName(m[4]));
    return { amount: packCount * packSize, unit, name: extracted.name, parenAmount: extracted.parenAmount, parenUnit: extracted.parenUnit };
  }

  // leading qty + unit, with an optional qualifier word e.g. "2 heaped tablespoons peanut butter"
  m = text.match(/^(\d+(?:\.\d+)?|\d+\/\d+|½|¼|¾|⅓|⅔)\s*(?:(?:heaped|level|rounded|scant|generous)\s+)?(g|kg|ml|l|cm|tsp|tbsp|teaspoons?|tablespoons?|cloves?|heads?|bunche?s?|tins?|cans?)\b\.?\s*(?:of\s+)?(.*)$/i);
  if (m) {
    const amount = parseQtyToken(m[1]);
    const unit = normalizeUnit(m[2]);
    const extracted = extractParenWeight(cleanIngredientName(m[3]));
    return { amount, unit, name: extracted.name, parenAmount: extracted.parenAmount, parenUnit: extracted.parenUnit };
  }

  // plain leading number, no unit, e.g. "2 onions (320g)"
  m = text.match(/^(\d+(?:\.\d+)?|\d+\/\d+|½|¼|¾|⅓|⅔)\s+(.*)$/);
  if (m) {
    const amount = parseQtyToken(m[1]);
    const extracted = extractParenWeight(cleanIngredientName(m[2]));
    return { amount, unit: null, name: extracted.name, parenAmount: extracted.parenAmount, parenUnit: extracted.parenUnit };
  }

  // Quantity can trail the name too, like typing a task into TickTick --
  // "flour 500g", "onions x2", "milk 2" all read naturally that way.

  // "name x N" e.g. "milk x2", "eggs x 6"
  m = text.match(/^(.+?)\s*[x×]\s*(\d+(?:\.\d+)?|\d+\/\d+|½|¼|¾|⅓|⅔)$/i);
  if (m) {
    const name = cleanIngredientName(m[1].replace(/,\s*$/, ""));
    return { amount: parseQtyToken(m[2]), unit: null, name, parenAmount: null, parenUnit: null };
  }

  // "name N unit" e.g. "flour 500g", "curry paste 3 tbsp"
  m = text.match(/^(.+?),?\s+(\d+(?:\.\d+)?|\d+\/\d+|½|¼|¾|⅓|⅔)\s*(g|kg|ml|l|cm|tsp|tbsp|teaspoons?|tablespoons?|cloves?|heads?|bunche?s?|tins?|cans?)$/i);
  if (m) {
    return { amount: parseQtyToken(m[2]), unit: normalizeUnit(m[3]), name: cleanIngredientName(m[1]), parenAmount: null, parenUnit: null };
  }

  // "name N" e.g. "onions 2", "apples 3"
  m = text.match(/^(.+?),?\s+(\d+(?:\.\d+)?|\d+\/\d+|½|¼|¾|⅓|⅔)$/);
  if (m) {
    return { amount: parseQtyToken(m[2]), unit: null, name: cleanIngredientName(m[1]), parenAmount: null, parenUnit: null };
  }

  const extracted = extractParenWeight(cleanIngredientName(text));
  return { amount: null, unit: null, name: extracted.name, parenAmount: extracted.parenAmount, parenUnit: extracted.parenUnit };
}

function formatNum(n) {
  if (n == null) return "";
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

function pluralizeUnit(unit, amount) {
  if (!WORD_UNITS.includes(unit)) return unit;
  if (amount === 1) return unit;
  return unit === "bunch" ? "bunches" : unit + "s";
}

function formatQuantity(amount, unit) {
  if (amount == null) return "";
  if (!unit) return formatNum(amount);
  if (["g", "kg", "ml", "l", "cm"].includes(unit)) return `${formatNum(amount)}${unit}`;
  return `${formatNum(amount)} ${pluralizeUnit(unit, amount)}`;
}

function formatItemText(item) {
  const qty = formatQuantity(item.amount, item.unit);
  let text = qty ? `${qty} ${item.name}` : item.name;
  if (item.parenAmount != null) text += ` (${formatNum(item.parenAmount)}${item.parenUnit})`;
  return text;
}

function scaleIngredientLine(raw, factor) {
  if (factor === 1) return raw;
  const parsed = parseIngredient(raw);
  if (parsed.amount == null) return raw;
  return formatItemText({
    amount: parsed.amount * factor,
    unit: parsed.unit,
    name: parsed.name,
    parenAmount: parsed.parenAmount != null ? parsed.parenAmount * factor : null,
    parenUnit: parsed.parenUnit
  });
}

function matchCatalog(name, catalog) {
  const norm = name.toLowerCase();
  let best = null, bestLen = 0;
  catalog.forEach(entry => {
    (entry.aliases || []).forEach(alias => {
      const a = alias.toLowerCase().trim();
      if (a && norm.indexOf(a) !== -1 && a.length > bestLen) {
        best = entry;
        bestLen = a.length;
      }
    });
  });
  return best;
}

function buildMergeKey(catalogEntry, name) {
  return catalogEntry ? "cat:" + catalogEntry.id : "text:" + name.toLowerCase().trim();
}

// Auto-creates a catalog entry the first time a genuinely new item name is
// added to the shopping list, so it's available for autocomplete and
// reference-order matching next time.
// matchCatalog only catches the case where the typed/parsed text is the
// *fuller* phrase (it contains a known alias as a substring). It can't
// catch the opposite -- a short personal shorthand like "bronion" for
// "Brown onion" -- since the alias is longer than what was typed. This
// looks for the typed word's letters appearing *in order* (not
// necessarily together) inside a longer existing name/alias, which is
// exactly the shape of a contraction like spronion/bronion/ronion for
// spring/brown/red onion.
function normalizeForFuzzy(s) { return s.toLowerCase().replace(/[^a-z]/g, ""); }

function isSubsequence(needle, haystack) {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

function findFuzzyCatalogSuggestion(name, catalog) {
  const needle = normalizeForFuzzy(name);
  if (needle.length < 3) return null;
  let best = null, bestRatio = 0;
  catalog.forEach(entry => {
    // Only test against the canonical display name, never against other
    // aliases -- once a contraction like "bronion" is stored as an alias
    // it's itself short and would otherwise attract *other* unrelated
    // contractions (e.g. "ronion") purely by being similarly short.
    const hay = normalizeForFuzzy(entry.name);
    if (hay.length <= needle.length) return; // only a "shorthand for something longer" suggestion
    if (!isSubsequence(needle, hay)) return;
    const ratio = needle.length / hay.length;
    if (ratio >= 0.35 && ratio > bestRatio) { bestRatio = ratio; best = entry; }
  });
  return best;
}

async function ensureCatalogEntryForName(name, unit, defaultQty) {
  const catalog = await getItemCatalog();
  const existing = matchCatalog(name, catalog);
  if (existing) return { entry: existing, suggestion: null };
  const suggestion = findFuzzyCatalogSuggestion(name, catalog);
  const entry = {
    id: slugify(name) + "-" + Date.now().toString(36).slice(-4),
    name, aliases: [name.toLowerCase()], staple: false,
    unit: unit || "", step: stepForUnit(unit || ""), defaultQty: defaultQty || 1
  };
  catalog.push(entry);
  await saveItemCatalog(catalog);
  return { entry, suggestion };
}

// Folds a just-created catalog entry into an existing one the user has
// confirmed is really the same thing: the typed word becomes a new alias
// on the target, the redundant entry is removed, and any shopping items
// that were pointing at it get repointed to the canonical item.
async function mergeNewEntryIntoExisting(newEntry, targetId) {
  const catalog = await getItemCatalog();
  const target = catalog.find(e => e.id === targetId);
  if (!target) return;
  const alias = (newEntry.aliases && newEntry.aliases[0]) || newEntry.name.toLowerCase();
  if (!target.aliases.includes(alias)) target.aliases.push(alias);
  await saveItemCatalog(catalog.filter(e => e.id !== newEntry.id));

  const items = await getShopItems();
  items.filter(i => i.catalogId === newEntry.id).forEach(i => {
    i.catalogId = target.id;
    i.mergeKey = "cat:" + target.id;
    i.name = target.name;
    i.staple = !!target.staple;
  });
  await saveShopItems(items);
  refreshItemSuggestions();
}

function offerAliasMerge(newEntry, suggestion, refreshFn) {
  showToast(
    `Is "${newEntry.name}" the same as "${suggestion.name}"?`,
    async () => {
      const catalogBefore = await getItemCatalog();
      const itemsBefore = await getShopItems();
      await mergeNewEntryIntoExisting(newEntry, suggestion.id);
      showToast(`Merged "${newEntry.name}" into "${suggestion.name}".`, async () => {
        await saveItemCatalog(catalogBefore);
        await saveShopItems(itemsBefore);
        refreshItemSuggestions();
        if (refreshFn) refreshFn();
      }, refreshFn);
      if (refreshFn) refreshFn();
    },
    refreshFn,
    "Merge",
    9000
  );
}

function shopItemQty(item) { return item.quantity != null ? item.quantity : (item.amount != null ? item.amount : 1); }
function shopItemStep(item) { return item.step || stepForUnit(item.unit || ""); }
function roundQty(n) { return Math.round(n * 1000) / 1000; }

/* ---------- Reference ordering ----------
   No more automatic category sorting. Instead, "Update order" snapshots
   the current on-screen order (per scope: main / staple) as the reference
   for where future new items should slot in. Anything not recognized
   from that saved order just goes to the end. */

function shopScopeFilter(scope) {
  return scope === "staple" ? (i => !i.checked && i.staple) : (i => !i.checked && !i.staple);
}

function shopOrderMetaKey(scope) { return scope === "staple" ? "shopOrderStaple" : "shopOrderMain"; }

async function updateShopOrder() {
  const items = await getShopItems();
  await setMeta("shopOrderMain", items.filter(shopScopeFilter("main")).map(i => i.catalogId || i.mergeKey));
  await setMeta("shopOrderStaple", items.filter(shopScopeFilter("staple")).map(i => i.catalogId || i.mergeKey));
}

async function insertItemByReferenceOrder(items, newItem) {
  const scope = newItem.staple ? "staple" : "main";
  const refOrder = (await getMeta(shopOrderMetaKey(scope))) || [];
  const key = newItem.catalogId || newItem.mergeKey;
  const refIdx = refOrder.indexOf(key);
  if (refIdx === -1) { items.push(newItem); return; }
  const scopeFilter = shopScopeFilter(scope);
  let insertAt = items.length;
  for (let i = 0; i < items.length; i++) {
    if (!scopeFilter(items[i])) continue;
    const k = items[i].catalogId || items[i].mergeKey;
    const idx = refOrder.indexOf(k);
    if (idx !== -1 && idx > refIdx) { insertAt = i; break; }
  }
  items.splice(insertAt, 0, newItem);
}

// Writes a new id order for one scope (main or staple) back into the full
// items array, leaving every other item's position untouched.
async function applyScopeOrder(scope, newOrderIds) {
  const items = await getShopItems();
  const scopeItems = items.filter(shopScopeFilter(scope));
  const byId = new Map(scopeItems.map(i => [i.id, i]));
  const positions = [];
  items.forEach((it, idx) => { if (byId.has(it.id)) positions.push(idx); });
  newOrderIds.forEach((id, i) => { items[positions[i]] = byId.get(id); });
  await saveShopItems(items);
  return items;
}

// Moves the block of selected ids (within one scope's id order) one slot
// up or down as a group, keeping their relative order. Works whether the
// selection is contiguous or scattered -- after the first move it's
// contiguous, same as most list apps.
function moveSelectedBlock(scopeIds, selectedSet, direction) {
  const selected = scopeIds.filter(id => selectedSet.has(id));
  const others = scopeIds.filter(id => !selectedSet.has(id));
  if (selected.length === 0) return scopeIds;
  const firstSelIdx = scopeIds.findIndex(id => selectedSet.has(id));
  const lastSelIdx = scopeIds.length - 1 - [...scopeIds].reverse().findIndex(id => selectedSet.has(id));

  if (direction < 0) {
    // Consolidate at the TOP of the selection's span (pushing anything
    // between scattered picks downward), then step one more slot up.
    if (firstSelIdx === 0) return scopeIds;
    const othersBeforeFirst = scopeIds.slice(0, firstSelIdx).filter(id => !selectedSet.has(id)).length;
    return spliceBlock(others, selected, othersBeforeFirst - 1);
  }
  // Consolidate at the BOTTOM of the selection's span (pushing anything
  // between scattered picks upward), then step one more slot down.
  if (lastSelIdx === scopeIds.length - 1) return scopeIds;
  const othersUpToLast = scopeIds.slice(0, lastSelIdx + 1).filter(id => !selectedSet.has(id)).length;
  return spliceBlock(others, selected, othersUpToLast + 1);
}

function spliceBlock(others, block, beforeCount) {
  const result = others.slice(0, beforeCount);
  result.push(...block);
  result.push(...others.slice(beforeCount));
  return result;
}

async function moveSelectedItems(direction) {
  for (const scope of ["main", "staple"]) {
    const items = await getShopItems();
    const scopeIds = items.filter(shopScopeFilter(scope)).map(i => i.id);
    const selInScope = new Set(scopeIds.filter(id => selectedShopIds.has(id)));
    if (selInScope.size === 0) continue;
    const newOrder = moveSelectedBlock(scopeIds, selInScope, direction);
    await applyScopeOrder(scope, newOrder);
  }
  renderShopListArea();
}

/* ---------- Drag to reorder (pointer events -- works with touch too) ----------
   Transform-only drag preview: the dragged element's DOM position never
   changes mid-gesture (only its CSS transform does), and other items only
   get a preview shift transform. The real reorder is written once, on
   release. This avoids mutating the DOM under an active pointer capture,
   which is what caused an earlier insertBefore-based version to
   occasionally get stuck "still held down" after lifting a finger. */

let shopDrag = null;

function wireDragHandle(handle, itemEl, scope) {
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* best-effort */ }
    const siblingEls = [...itemEl.parentElement.querySelectorAll(`.shop-item[data-scope="${scope}"]`)];
    const order = siblingEls.map(el => el.dataset.id);
    const draggedId = itemEl.dataset.id;
    const rects = new Map(siblingEls.map(el => [el.dataset.id, el.getBoundingClientRect()]));
    const elsById = new Map(siblingEls.map(el => [el.dataset.id, el]));
    const others = order.filter(id => id !== draggedId);
    shopDrag = {
      draggedId, scope, others, elsById, rects,
      originalBoundary: order.indexOf(draggedId),
      draggedHeight: rects.get(draggedId).height,
      startY: e.clientY,
      targetOthersIdx: order.indexOf(draggedId)
    };
    itemEl.classList.add("dragging");
  });
  handle.addEventListener("pointermove", (e) => {
    if (!shopDrag || shopDrag.draggedId !== itemEl.dataset.id) return;
    const delta = e.clientY - shopDrag.startY;
    itemEl.style.transform = `translateY(${delta}px)`;

    const draggedRect = shopDrag.rects.get(shopDrag.draggedId);
    const draggedCenter = draggedRect.top + draggedRect.height / 2 + delta;

    let othersIdx = 0;
    shopDrag.others.forEach(id => {
      const r = shopDrag.rects.get(id);
      if (r.top + r.height / 2 < draggedCenter) othersIdx++;
    });

    shopDrag.others.forEach((id, i) => {
      const el = shopDrag.elsById.get(id);
      let shift = 0;
      if (othersIdx > shopDrag.originalBoundary && i >= shopDrag.originalBoundary && i < othersIdx) shift = -shopDrag.draggedHeight;
      else if (othersIdx < shopDrag.originalBoundary && i >= othersIdx && i < shopDrag.originalBoundary) shift = shopDrag.draggedHeight;
      el.style.transform = shift ? `translateY(${shift}px)` : "";
    });

    shopDrag.targetOthersIdx = othersIdx;
  });
  const endDrag = async () => {
    if (!shopDrag || shopDrag.draggedId !== itemEl.dataset.id) return;
    const { scope: dragScope, others, targetOthersIdx, elsById, draggedId } = shopDrag;
    const finalOrder = others.slice();
    finalOrder.splice(targetOthersIdx, 0, draggedId);
    elsById.forEach(el => { el.style.transform = ""; });
    itemEl.classList.remove("dragging");
    shopDrag = null;
    await applyScopeOrder(dragScope, finalOrder);
    renderShopListArea();
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
}

/* ---------- Seed data: the recipes already on hand ---------- */
const SEED_RECIPES = [
  {
    id: "mothership-overnight-oats",
    title: "Mothership Overnight Oats",
    source: "Cookbook (adapted)",
    tags: ["breakfast", "batch-prep", "vegetarian"],
    servesLabel: "Makes 6 portions",
    time: "10 min + overnight soak",
    ingredients: [
      "2 ripe bananas (320g)",
      "700ml semi-skimmed milk or unsweetened fortified plant milk",
      "2 teaspoons vanilla bean paste",
      "300g porridge oats",
      "2 eating apples"
    ],
    method: [
      "Blend the peeled bananas with the milk and vanilla bean paste until smooth, then pour over the oats in a large bowl.",
      "Coarsely grate in the apples and stir well.",
      "Cover and refrigerate overnight.",
      "The next day, stir well and loosen with a splash more milk if needed. Serve as is, or top with seasonal fruit, nuts or seeds."
    ],
    notes: "Keeps in the fridge for several days. Easy to halve for one person (220g per portion).",
    dateAdded: "2026-07-11"
  },
  {
    id: "comforting-chickpea-cauliflower-soup",
    title: "Comforting Chickpea & Cauliflower Soup",
    source: "Cookbook (adapted)",
    tags: ["soup", "curry", "vegetarian", "batch-prep"],
    servesLabel: "Serves 4",
    time: "Prep 15 min, cook 25 min",
    ingredients: [
      "4cm piece of ginger",
      "4 cloves of garlic",
      "2 onions (320g)",
      "1 small handful of curry leaves",
      "1 head of cauliflower (800g)",
      "500g potatoes",
      "3 tablespoons curry paste",
      "60g coconut cream",
      "2 x 400g tins of chickpeas",
      "200g ripe mixed-colour cherry tomatoes"
    ],
    method: [
      "Finely chop the ginger, garlic and onion, and cook in a large pan with a little oil and the curry leaves over medium heat.",
      "Chop the potatoes and cauliflower into rough dice and add to the pan, cooking for around 10 minutes, stirring regularly.",
      "Stir in the coconut cream, then add the chickpeas (with their liquid) and enough boiling water to just cover. Cover and simmer.",
      "Blend roughly half the soup until smooth, then stir back through the rest for a creamier texture.",
      "Divide between bowls, top with quartered cherry tomatoes, and drizzle with olive oil if you like."
    ],
    notes: "Inspired by aloo gobi. Good with warmed flatbread.",
    dateAdded: "2026-07-11"
  },
  {
    id: "super-green-orecchiette",
    title: "Super-Green Orecchiette",
    source: "Cookbook (adapted)",
    tags: ["pasta", "vegetarian", "weeknight"],
    servesLabel: "Serves 4",
    time: "24 min",
    ingredients: [
      "80g rosemary focaccia",
      "4 cloves of garlic",
      "1 head of broccoli (320g)",
      "320g baby spinach",
      "50g Parmesan cheese",
      "1 lemon",
      "dried red chilli flakes",
      "300g dried orecchiette",
      "320g frozen peas",
      "4 tablespoons cottage cheese"
    ],
    method: [
      "Blitz the focaccia into fine crumbs and toast in a dry pan until golden; set aside.",
      "Boil the whole garlic cloves in salted water. Cut the broccoli into florets, roughly chop the stalk, and add the stalk to the water along with the spinach for the final minute.",
      "Lift out the broccoli stalk, spinach and garlic (reserve the water for the pasta) and blend with lemon juice, grated Parmesan, chilli flakes and olive oil into a smooth green sauce. Season to taste.",
      "Cook the orecchiette in the same pot of water according to packet instructions, adding the broccoli florets and peas for the final 2 minutes.",
      "Drain, reserving a mugful of pasta water, then toss the pasta with the green sauce, loosening with a little pasta water if needed.",
      "Divide between bowls, spoon over the cottage cheese, and scatter with the crispy crumbs and a pinch of chilli flakes."
    ],
    notes: "",
    dateAdded: "2026-07-11"
  },
  {
    id: "creamy-peanut-chicken",
    title: "Creamy Peanut Chicken",
    source: "Cookbook (adapted)",
    tags: ["chicken", "quick", "weeknight"],
    servesLabel: "Serves 2",
    time: "10 min",
    ingredients: [
      "2 mixed-colour peppers (320g)",
      "2 x 150g skinless chicken breasts",
      "2 cloves of garlic",
      "6cm piece of ginger",
      "2 limes",
      "1 tablespoon low-salt soy sauce",
      "2 heaped tablespoons peanut butter",
      "½ a bunch of coriander (15g)",
      "160g sugar snap peas",
      "60g dried mango"
    ],
    method: [
      "Slice the peppers into thick strips, discarding the seeds, and dry-fry in a hot pan for 2 minutes.",
      "Slice the chicken into 1cm strips, season, add to the pan with a little oil, and cook for about 4 minutes until golden, tossing regularly.",
      "Meanwhile, blend the garlic, ginger, lime juice, soy sauce, peanut butter, coriander stalks and a splash of water into a smooth sauce, and season to taste.",
      "Add the sugar snaps and dried mango to the pan, pour in the sauce, and let it bubble for 2 minutes.",
      "Plate up, scatter with coriander leaves, and serve with lime wedges and rice or noodles."
    ],
    notes: "",
    dateAdded: "2026-07-11"
  },
  {
    id: "easy-prawn-curry",
    title: "Easy Prawn Curry",
    source: "Cookbook (adapted)",
    tags: ["seafood", "curry", "quick"],
    servesLabel: "Serves 2",
    time: "10 min",
    ingredients: [
      "1 onion (160g)",
      "250g ripe cherry tomatoes",
      "1 x 50g sachet of creamed coconut",
      "1 x 400g tin of chickpeas",
      "1 bunch of coriander (30g)",
      "2 tablespoons curry paste",
      "250g frozen mango",
      "165g raw peeled king prawns",
      "1 x 250g packet of cooked wholegrain basmati rice",
      "30g Bombay mix"
    ],
    method: [
      "Finely slice the onion and dry-fry with the tomatoes for about 4 minutes.",
      "Meanwhile, blend the creamed coconut, chickpeas (with their liquid), half the coriander leaves and a splash of water into a sauce, along with half the cooked onion and tomato.",
      "Stir the curry paste and a little oil into the pan with the remaining onion and tomato, then add the mango and remaining chickpeas and toss for 2 minutes.",
      "Pour in the blended sauce, add the prawns, and simmer until just cooked through, loosening with water if needed.",
      "Cook the rice according to packet instructions and divide between plates. Stir most of the remaining coriander through the curry, spoon over the rice, and finish with crushed Bombay mix."
    ],
    notes: "",
    dateAdded: "2026-07-11"
  },
  {
    id: "chipotle-chicken-bean-soup",
    title: "Chipotle Chicken & Bean Soup",
    source: "Cookbook (adapted)",
    tags: ["soup", "chicken", "batch-prep"],
    servesLabel: "Serves 4",
    time: "Prep 20 min, cook 1 hour",
    ingredients: [
      "4 large chicken thighs, skin on, bone in",
      "320g button mushrooms",
      "2 red onions (320g)",
      "4 carrots (320g)",
      "320g celery",
      "4 teaspoons chipotle chilli paste",
      "2 x 400g tins of butter beans",
      "2 x 400g tins of plum tomatoes",
      "1 small ripe avocado (160g)",
      "1 lime"
    ],
    method: [
      "Render the skin from the chicken thighs in a large casserole pan over medium heat, then remove and reserve the skin, leaving the fat behind.",
      "Season the thighs and brown them in the pan while you trim the mushrooms and finely slice the onions, carrots and celery (reserving any celery leaves). Remove the chicken and cook the vegetables for about 10 minutes.",
      "Stir in the chipotle paste, return the chicken to the pan, add the tomatoes (breaking them up) and a kettle's worth of water. Cover and simmer for 45 minutes.",
      "Pull out the chicken and shred it, discarding the bones, then stir it back into the soup with the beans and simmer to your desired consistency.",
      "Halve, destone, peel and dice the avocado, and dress with lime juice. Serve the soup topped with the avocado, reserved celery leaves, and crumbled crispy tortilla for crunch, if you like."
    ],
    notes: "Good with warmed or roasted corn tortillas on the side.",
    dateAdded: "2026-07-11"
  },
  {
    id: "golden-chicken-peppers-rice",
    title: "Golden Chicken, Peppers & Rice",
    source: "Cookbook (adapted)",
    tags: ["chicken", "quick", "weeknight"],
    servesLabel: "Serves 2",
    time: "14 min",
    ingredients: [
      "160g kale",
      "½ a head of broccoli (160g)",
      "1 red pepper (160g)",
      "2 x 150g skinless chicken breasts",
      "1 x 250g packet of cooked wholegrain rice",
      "1 tablespoon harissa paste, plus extra to serve",
      "1 lemon",
      "30g feta cheese",
      "2 heaped tablespoons houmous"
    ],
    method: [
      "Tear the kale into a hot dry pan, discarding any tough stalks, and let it wilt and lightly char. Meanwhile cut the broccoli into small florets, slice the pepper, and cut the chicken into 1cm strips.",
      "Once the kale has wilted, tip in the rice and harissa paste, add half the lemon juice, and toss over the heat for 2 minutes until hot through. Season and divide between plates.",
      "Add a tablespoon of olive oil to the pan, then the chicken and broccoli. Season and cook for a few minutes until golden and cooked through, tossing regularly. Add the pepper partway through.",
      "Divide the chicken, peppers and broccoli over the rice, crumble over the feta, and spoon over the houmous and a little extra harissa. Serve with the remaining lemon."
    ],
    notes: "",
    dateAdded: "2026-07-11"
  },
  {
    id: "sesame-miso-shred-salad",
    title: "Sesame Miso Shred Salad",
    source: "Cookbook (adapted)",
    tags: ["salad", "side", "vegetarian", "quick"],
    servesLabel: "Serves 1",
    time: "12 min",
    ingredients: [
      "80g each of sugar snap peas, white cabbage, yellow pepper, carrot, asparagus",
      "1 fresh red chilli",
      "1 lime",
      "1 heaped teaspoon tahini",
      "1 heaped teaspoon white miso",
      "1 heaped teaspoon toasted sesame seeds",
      "2 sprigs of coriander"
    ],
    method: [
      "Trim or deseed the vegetables as needed, then finely shred them all, by hand or with a food processor attachment.",
      "Finely chop the chilli and scrunch it through the shredded veg with the lime juice, tahini, miso and a little extra virgin olive oil.",
      "Season to taste, then scatter over the sesame seeds and pick over the coriander leaves.",
      "Good as a side with wholegrain rice or noodles."
    ],
    notes: "",
    dateAdded: "2026-07-11"
  }
];

/* ---------- Rendering ---------- */

async function seedIfEmpty() {
  const existing = await getAllRecipes();
  if (existing.length === 0) {
    for (const r of SEED_RECIPES) await putRecipe(r);
  }
}

function allTags(recipes) {
  const s = new Set();
  recipes.forEach(r => (r.tags || []).forEach(t => s.add(t)));
  return Array.from(s).sort();
}

function searchRank(r, term) {
  const t = term.toLowerCase();
  if (r.title.toLowerCase().includes(t)) return 0;
  if ((r.tags || []).some(tag => tag.toLowerCase().includes(t))) return 1;
  if ((r.ingredients || []).some(i => i.toLowerCase().includes(t))) return 2;
  if ((r.source || "").toLowerCase().includes(t) || (r.notes || "").toLowerCase().includes(t) ||
      (r.method || []).some(m => m.toLowerCase().includes(t))) return 3;
  return 4;
}

/* ---------- Meal plan membership helpers ----------
   Tolerant of the old format (a plain array of recipe id strings)
   as well as the current entry-object format, so existing data
   doesn't break. */

async function isRecipeInPlan(recipeId) {
  const plan = await getMealPlan();
  return plan.some(e => (typeof e === "string" ? e === recipeId : e.recipeId === recipeId));
}
async function addRecipeToPlan(recipeId) {
  if (await isRecipeInPlan(recipeId)) return;
  const plan = await getMealPlan();
  plan.push({ id: genId(), recipeId });
  await saveMealPlan(plan);
}
async function removeRecipeFromPlanByRecipeId(recipeId) {
  const plan = await getMealPlan();
  await saveMealPlan(plan.filter(e => (typeof e === "string" ? e !== recipeId : e.recipeId !== recipeId)));
}
async function removeEntryFromPlan(entryId) {
  const plan = await getMealPlan();
  await saveMealPlan(plan.filter(e => (typeof e === "string" ? e !== entryId : e.id !== entryId)));
}
async function getMealPlanEntries() {
  const plan = await getMealPlan();
  const recipes = await getAllRecipes();
  return plan.map(raw => {
    const entry = typeof raw === "string" ? { id: raw, recipeId: raw } : raw;
    if (entry.recipeId) {
      const r = recipes.find(x => x.id === entry.recipeId);
      if (!r) return null;
      return { id: entry.id, recipeId: r.id, title: r.title, ingredients: r.ingredients || [], recipe: r };
    }
    return { id: entry.id, recipeId: null, title: entry.title || "", ingredients: entry.ingredients || [], recipe: null };
  }).filter(Boolean);
}

// Renders the toolbar (search/tag/add) once, then delegates the actual
// list to renderRecipeList(). Typing in the search box only re-renders
// the list container -- never the toolbar itself -- so the input never
// loses focus (which would otherwise close the on-screen keyboard on
// every keystroke).
async function renderRecipes() {
  const main = document.getElementById("main");
  const recipes = await getAllRecipes();
  const planIds = new Set((await getMealPlan()).map(e => typeof e === "string" ? e : e.recipeId).filter(Boolean));
  const tags = allTags(recipes);

  main.innerHTML = `
    <div class="toolbar">
      <input type="text" id="searchInput" placeholder="Search recipes, tags, ingredients..." value="${escapeAttr(currentSearch)}">
      <select id="tagSelect">
        <option value="">All tags</option>
        ${tags.map(t => `<option value="${escapeAttr(t)}" ${t === currentTagFilter ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
      </select>
      <button class="secondary-btn" id="openAddBtn" title="Add a recipe">+ Add recipe</button>
    </div>
    <div id="recipeListArea"></div>
  `;

  const rerenderList = () => renderRecipeList(recipes, planIds);

  document.getElementById("searchInput").addEventListener("input", (e) => {
    currentSearch = e.target.value;
    rerenderList();
  });
  document.getElementById("tagSelect").addEventListener("change", (e) => {
    currentTagFilter = e.target.value;
    rerenderList();
  });
  document.getElementById("openAddBtn").addEventListener("click", () => renderAdd());

  rerenderList();
}

function renderRecipeList(recipes, planIds) {
  const listArea = document.getElementById("recipeListArea");
  if (!listArea) return;

  let filtered = recipes.filter(r => {
    const matchesTag = !currentTagFilter || (r.tags || []).includes(currentTagFilter);
    if (!matchesTag) return false;
    return !currentSearch || searchRank(r, currentSearch) < 4;
  });

  if (currentSearch) {
    filtered.sort((a, b) => {
      const ra = searchRank(a, currentSearch), rb = searchRank(b, currentSearch);
      return ra !== rb ? ra - rb : a.title.localeCompare(b.title);
    });
  } else {
    filtered.sort((a, b) => a.title.localeCompare(b.title));
  }

  let html = "";
  if (filtered.length === 0) {
    html += `<div class="empty-msg">No matches. Tap "+ Add recipe" above, or clear your search.</div>`;
  } else {
    filtered.forEach(r => {
      const inPlan = planIds.has(r.id);
      const metaParts = [r.servesLabel, r.time].filter(Boolean).join(" &middot; ");
      html += `<div class="recipe-card" data-id="${escapeAttr(r.id)}">
        <h3>${escapeHtml(r.title)}</h3>
        <div class="recipe-meta">${metaParts}</div>
        ${sourceLineHtml(r)}
        <div class="tag-row">${(r.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
        <div class="card-actions">
          <button class="mini-btn ${inPlan ? "selected" : ""}" data-action="plan-toggle" data-id="${escapeAttr(r.id)}">${inPlan ? "✓ In meal plan" : "+ Add to meal plan"}</button>
          <button class="mini-btn danger" data-action="delete" data-id="${escapeAttr(r.id)}">Delete</button>
        </div>
      </div>`;
    });
  }

  listArea.innerHTML = html;

  listArea.querySelectorAll(".recipe-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("button") || e.target.closest("a")) return;
      renderDetail(card.dataset.id);
    });
  });
  listArea.querySelectorAll('[data-action="plan-toggle"]').forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const r = recipes.find(x => x.id === btn.dataset.id);
      if (!r) return;
      if (await isRecipeInPlan(r.id)) {
        const planBefore = await getMealPlan();
        await removeRecipeFromPlanByRecipeId(r.id);
        showToast(`Removed "${r.title}" from meal plan.`, async () => { await saveMealPlan(planBefore); }, renderRecipes);
      } else {
        await addRecipeToPlan(r.id);
        showToast(`Added "${r.title}" to meal plan.`, async () => { await removeRecipeFromPlanByRecipeId(r.id); }, renderRecipes);
      }
      renderRecipes();
    });
  });
  listArea.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const r = recipes.find(x => x.id === btn.dataset.id);
      if (!r) return;
      const planBefore = await getMealPlan();
      await deleteRecipe(r.id);
      await removeRecipeFromPlanByRecipeId(r.id);
      showToast(`Deleted "${r.title}".`, async () => {
        await putRecipe(r);
        await saveMealPlan(planBefore);
      }, renderRecipes);
      renderRecipes();
    });
  });
}

function sourceLineHtml(r) {
  if (!r.source && !r.sourceUrl) return "";
  if (r.sourceUrl) {
    return `<div class="recipe-meta"><a href="${escapeAttr(r.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(r.source || r.sourceUrl)} ↗</a></div>`;
  }
  return `<div class="recipe-meta">${escapeHtml(r.source)}</div>`;
}

async function renderDetail(id) {
  const main = document.getElementById("main");
  const recipes = await getAllRecipes();
  const r = recipes.find(x => x.id === id);
  if (!r) { renderRecipes(); return; }
  const inPlan = await isRecipeInPlan(r.id);
  const baseServes = r.serves || detectDefaultServes(r);

  main.innerHTML = `
    <button class="back-btn" id="backBtn">&larr; Back to recipes</button>
    <div class="detail-card">
      <h2>${escapeHtml(r.title)}</h2>
      <div class="recipe-meta">${[r.servesLabel, r.time].filter(Boolean).map(escapeHtml).join(" &middot; ")}</div>
      ${r.source || r.sourceUrl ? `<div>${r.sourceUrl
        ? `<a class="source-link" href="${escapeAttr(r.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(r.source || "View source")} ↗</a>`
        : `<div class="recipe-meta">${escapeHtml(r.source)}</div>`}</div>` : ""}
      <div class="tag-row">${(r.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>

      <div class="section-label">Ingredients</div>
      ${baseServes ? `<div class="scale-row">
        <label for="scaleServes">Scale to serves</label>
        <input type="number" min="1" id="scaleServes" value="${baseServes}">
      </div>` : ""}
      <ul class="ing-list" id="ingList">${(r.ingredients || []).map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul>

      <div class="section-label">Method</div>
      <ol class="method-list">${(r.method || []).map(m => `<li>${escapeHtml(m)}</li>`).join("")}</ol>

      ${r.notes ? `<div class="section-label">Notes</div><div class="notes-box">${escapeHtml(r.notes)}</div>` : ""}

      <div class="card-actions">
        <button class="mini-btn ${inPlan ? "selected" : ""}" id="planToggleBtn">${inPlan ? "✓ In meal plan" : "+ Add to meal plan"}</button>
        <button class="mini-btn" id="editBtn">Edit recipe</button>
      </div>
    </div>
  `;
  document.getElementById("backBtn").addEventListener("click", renderRecipes);
  document.getElementById("planToggleBtn").addEventListener("click", async () => {
    if (inPlan) {
      const planBefore = await getMealPlan();
      await removeRecipeFromPlanByRecipeId(r.id);
      showToast("Removed from meal plan.", async () => { await saveMealPlan(planBefore); }, () => renderDetail(r.id));
    } else {
      await addRecipeToPlan(r.id);
      showToast("Added to meal plan.", async () => { await removeRecipeFromPlanByRecipeId(r.id); }, () => renderDetail(r.id));
    }
    renderDetail(r.id);
  });
  document.getElementById("editBtn").addEventListener("click", () => renderRecipeForm(r));

  const scaleInput = document.getElementById("scaleServes");
  if (scaleInput) {
    scaleInput.addEventListener("input", () => {
      const target = Number(scaleInput.value);
      const factor = target > 0 ? target / baseServes : 1;
      document.getElementById("ingList").innerHTML =
        (r.ingredients || []).map(i => `<li>${escapeHtml(scaleIngredientLine(i, factor))}</li>`).join("");
    });
  }
}

/* ---------- Meal plan ---------- */

async function renderMealPlanNotesCard() {
  const container = document.getElementById("mealNotesCard");
  if (!container) return;
  const notes = await getMealPlanNotes();
  container.innerHTML = renderNotesCard("mealNotes", notes, mealPlanNotesOpen, "Notes for this meal plan...");
  document.getElementById("mealNotesToggle").addEventListener("click", () => {
    mealPlanNotesOpen = !mealPlanNotesOpen;
    renderMealPlanNotesCard();
  });
  const textarea = document.getElementById("mealNotesText");
  if (textarea) textarea.addEventListener("blur", async () => { await saveMealPlanNotesText(textarea.value); });
}

function renderManualMealForm() {
  const main = document.getElementById("main");
  main.innerHTML = `
    <button class="back-btn" id="mealFormBackBtn">&larr; Back to meal plan</button>
    <div class="detail-card">
      <h2>Add a meal</h2>
      <div class="form-field"><label>Title</label><input type="text" id="mfTitle" placeholder="e.g. Leftovers, Takeout Friday"></div>
      <div class="form-field"><label>Ingredients (one per line, optional)</label><textarea id="mfIngredients" placeholder="Leave blank for a placeholder meal like 'Eating out'"></textarea></div>
      <button class="primary-btn" id="mfSaveBtn">Add to plan</button>
      <div id="mfStatus"></div>
    </div>
  `;
  document.getElementById("mealFormBackBtn").addEventListener("click", renderMealPlan);
  document.getElementById("mfSaveBtn").addEventListener("click", async () => {
    const title = document.getElementById("mfTitle").value.trim();
    if (!title) {
      document.getElementById("mfStatus").innerHTML = `<div class="status-msg status-err">Title is required.</div>`;
      return;
    }
    const ingredients = document.getElementById("mfIngredients").value.split("\n").map(s => s.trim()).filter(Boolean);
    const plan = await getMealPlan();
    const newEntry = { id: genId(), recipeId: null, title, ingredients };
    plan.push(newEntry);
    await saveMealPlan(plan);
    showToast(`Added "${title}" to meal plan.`, async () => {
      const cur = await getMealPlan();
      await saveMealPlan(cur.filter(e => (typeof e === "string" ? true : e.id !== newEntry.id)));
    }, renderMealPlan);
    renderMealPlan();
  });
}

// Aggregates every planned meal's ingredients into one merged, read-only
// list you can compare against your shopping list -- adding is always an
// explicit per-line (or "Add all") action, never automatic.
async function renderMealPlanIngredients(entries) {
  const container = document.getElementById("mealIngredientsArea");
  if (!container) return;

  const catalog = await getItemCatalog();
  const shopItems = await getShopItems();
  const merged = [];

  entries.forEach(en => {
    (en.ingredients || []).forEach(raw => {
      const parsed = parseIngredient(raw);
      const catalogEntry = matchCatalog(parsed.name, catalog);
      const displayName = catalogEntry ? catalogEntry.name : parsed.name;
      const mergeKey = buildMergeKey(catalogEntry, parsed.name);
      let line = merged.find(m => m.mergeKey === mergeKey && m.unit === parsed.unit);
      if (!line) {
        line = {
          mergeKey, catalogId: catalogEntry ? catalogEntry.id : null, name: displayName,
          amount: parsed.amount, unit: parsed.unit, parenAmount: parsed.parenAmount, parenUnit: parsed.parenUnit,
          meals: []
        };
        merged.push(line);
      } else {
        if (parsed.amount != null) line.amount = (line.amount || 0) + parsed.amount;
        if (parsed.parenAmount != null) line.parenAmount = (line.parenAmount || 0) + parsed.parenAmount;
      }
      if (!line.meals.includes(en.title)) line.meals.push(en.title);
    });
  });
  merged.sort((a, b) => a.name.localeCompare(b.name));

  const onListKeys = new Set(shopItems.filter(i => !i.checked).map(i => i.catalogId || i.mergeKey));

  let html = "";
  if (merged.length === 0) {
    html = entries.length ? `<div class="empty-msg">No ingredients to compare yet.</div>` : "";
  } else {
    html += `<div class="section-label">Ingredients for this period</div>`;
    const anyMissing = merged.some(m => !onListKeys.has(m.catalogId || m.mergeKey));
    if (anyMissing) html += `<div class="btn-row" style="margin-bottom:10px;"><button class="secondary-btn" id="addAllIngredientsBtn">Add all to list</button></div>`;
    html += merged.map(line => {
      const text = formatItemText(line);
      const key = line.catalogId || line.mergeKey;
      const onList = onListKeys.has(key);
      return `<div class="compare-item" data-key="${escapeAttr(key)}">
        <div class="item-body">
          <div class="item-text">${escapeHtml(text)}</div>
          <div class="item-src">${escapeHtml(line.meals.join(", "))}</div>
        </div>
        ${onList
          ? `<span class="icon-btn on" style="pointer-events:none;">On list</span>`
          : `<button class="secondary-btn" data-action="add-compare" data-key="${escapeAttr(key)}">+ Add</button>`}
      </div>`;
    }).join("");
  }

  container.innerHTML = html;

  container.querySelectorAll('[data-action="add-compare"]').forEach(btn => {
    btn.addEventListener("click", async () => {
      const line = merged.find(m => (m.catalogId || m.mergeKey) === btn.dataset.key);
      if (!line) return;
      const result = await addComparisonLineToShoppingList(line);
      renderMealPlanIngredients(entries);
      if (result.suggestion) offerAliasMerge(result.catalogEntry, result.suggestion, () => renderMealPlanIngredients(entries));
    });
  });
  const addAllBtn = document.getElementById("addAllIngredientsBtn");
  if (addAllBtn) addAllBtn.addEventListener("click", async () => {
    const toAdd = merged.filter(m => !onListKeys.has(m.catalogId || m.mergeKey));
    let lastSuggestion = null;
    for (const line of toAdd) {
      const result = await addComparisonLineToShoppingList(line);
      if (result.suggestion) lastSuggestion = result;
    }
    renderMealPlanIngredients(entries);
    if (lastSuggestion) offerAliasMerge(lastSuggestion.catalogEntry, lastSuggestion.suggestion, () => renderMealPlanIngredients(entries));
    else showToast(`Added ${toAdd.length} item(s) to your shopping list.`, null, null);
  });
}

async function addComparisonLineToShoppingList(line) {
  const catalog = await getItemCatalog();
  let catalogEntry = line.catalogId ? catalog.find(c => c.id === line.catalogId) : null;
  let suggestion = null;
  if (!catalogEntry) {
    const result = await ensureCatalogEntryForName(line.name, line.unit, line.amount || 1);
    catalogEntry = result.entry;
    suggestion = result.suggestion;
    refreshItemSuggestions();
  }
  const items = await getShopItems();
  const mergeKey = buildMergeKey(catalogEntry, line.name);
  const unit = line.unit || catalogEntry.unit || "";
  const quantity = line.amount != null ? line.amount : catalogEntry.defaultQty;
  const existing = items.find(i => !i.checked && (i.catalogId ? i.catalogId === catalogEntry.id : i.mergeKey === mergeKey) && i.unit === unit);
  if (existing) {
    existing.quantity = roundQty(shopItemQty(existing) + quantity);
  } else {
    const item = {
      id: genId(), catalogId: catalogEntry.id, mergeKey, name: catalogEntry.name,
      quantity, unit, step: catalogEntry.step || stepForUnit(unit),
      checked: false, staple: !!catalogEntry.staple, meals: line.meals.slice()
    };
    await insertItemByReferenceOrder(items, item);
  }
  await saveShopItems(items);
  return { catalogEntry, suggestion };
}

async function renderMealPlan() {
  const main = document.getElementById("main");
  const entries = await getMealPlanEntries();
  entries.sort((a, b) => a.title.localeCompare(b.title));

  let html = `<div id="mealNotesCard"></div>
    <div class="btn-row" style="margin-bottom:14px;">
      <button class="secondary-btn" id="addManualMealBtn">+ Add manually</button>
    </div>`;

  if (entries.length === 0) {
    html += `<div class="empty-msg">Nothing planned yet -- add a recipe from Recipes, or add manually above.</div>`;
  } else {
    entries.forEach(en => {
      const metaParts = en.recipe ? [en.recipe.servesLabel, en.recipe.time].filter(Boolean).join(" &middot; ") : "Manual entry";
      html += `<div class="recipe-card" data-id="${escapeAttr(en.id)}" data-recipe-id="${escapeAttr(en.recipeId || "")}" style="${en.recipe ? "" : "cursor:default;"}">
        <h3>${escapeHtml(en.title)}</h3>
        <div class="recipe-meta">${metaParts}</div>
        ${en.recipe ? `<div class="tag-row">${(en.recipe.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
        <div class="card-actions">
          <button class="mini-btn danger" data-action="remove-entry" data-id="${escapeAttr(en.id)}">Remove from plan</button>
        </div>
      </div>`;
    });
    html += `<div class="btn-row" style="margin:6px 0 20px;"><button class="secondary-btn" id="goShopBtn">Go to Shopping List</button></div>`;
  }

  html += `<div id="mealIngredientsArea"></div>`;

  main.innerHTML = html;
  await renderMealPlanNotesCard();
  await renderMealPlanIngredients(entries);

  main.querySelectorAll(".recipe-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      if (card.dataset.recipeId) renderDetail(card.dataset.recipeId);
    });
  });
  main.querySelectorAll('[data-action="remove-entry"]').forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const entry = entries.find(x => x.id === id);
      const planBefore = await getMealPlan();
      await removeEntryFromPlan(id);
      showToast(`Removed "${entry ? entry.title : "meal"}" from plan.`, async () => { await saveMealPlan(planBefore); }, renderMealPlan);
      renderMealPlan();
    });
  });
  document.getElementById("addManualMealBtn").addEventListener("click", renderManualMealForm);
  const goShopBtn = document.getElementById("goShopBtn");
  if (goShopBtn) goShopBtn.addEventListener("click", () => setTab("shop"));
}

/* ---------- Shopping list ---------- */

async function refreshItemSuggestions() {
  const datalist = document.getElementById("itemSuggestions");
  if (!datalist) return;
  const catalog = await getItemCatalog();
  datalist.innerHTML = catalog.map(e => `<option value="${escapeAttr(e.name)}">`).join("");
}

// Shared by the manual add box and the paste-a-list ingester: parses one
// line of free text, matches/creates a catalog entry (with fuzzy alias
// suggestion), and merges it into the shopping list.
async function addTextToShoppingList(raw) {
  const parsed = parseIngredient(raw);
  const catalog = await getItemCatalog();
  let catalogEntry = matchCatalog(parsed.name, catalog);
  let suggestion = null;
  if (!catalogEntry) {
    const result = await ensureCatalogEntryForName(parsed.name, parsed.unit, parsed.amount || 1);
    catalogEntry = result.entry;
    suggestion = result.suggestion;
    refreshItemSuggestions();
  }
  const items = await getShopItems();
  const mergeKey = buildMergeKey(catalogEntry, parsed.name);
  const unit = parsed.unit || catalogEntry.unit || "";
  const quantity = parsed.amount != null ? parsed.amount : catalogEntry.defaultQty;

  const existing = items.find(i => !i.checked && (i.catalogId ? i.catalogId === catalogEntry.id : i.mergeKey === mergeKey) && i.unit === unit);
  if (existing) {
    existing.quantity = roundQty(shopItemQty(existing) + quantity);
  } else {
    const item = {
      id: genId(), catalogId: catalogEntry.id, mergeKey, name: catalogEntry.name,
      quantity, unit, step: catalogEntry.step || stepForUnit(unit),
      checked: false, staple: !!catalogEntry.staple, meals: []
    };
    await insertItemByReferenceOrder(items, item);
  }
  await saveShopItems(items);
  return { catalogEntry, suggestion };
}

async function addManualItem() {
  const input = document.getElementById("newItemInput");
  const raw = input.value.trim();
  if (!raw) return;
  const result = await addTextToShoppingList(raw);
  input.value = "";
  renderShopListArea();
  if (result.suggestion) offerAliasMerge(result.catalogEntry, result.suggestion, renderShopListArea);
}

// Strips common list-marker prefixes (dashes, bullets, checkboxes,
// numbering) so a pasted list from anywhere (notes app, recipe site,
// another app's export) ingests cleanly line by line.
function stripListMarker(line) {
  return line.replace(/^\s*(?:[-*•‣▪◦○●·]|\[\s?[xX]?\s?\]|\d+[.)]|☐|☑|✓|✔)+\s*/, "").trim();
}

function renderPasteList() {
  const main = document.getElementById("main");
  main.innerHTML = `
    <button class="back-btn" id="pasteBackBtn">&larr; Back to shopping list</button>
    <div class="detail-card">
      <h2>Paste a list</h2>
      <p style="font-size:0.85rem;color:var(--muted);margin:0 0 10px;">One item per line. Dashes, bullets, checkboxes and numbering are stripped automatically.</p>
      <textarea id="pasteListInput" placeholder="- 2 onions&#10;500g flour&#10;[ ] Milk"></textarea>
      <button class="primary-btn" id="pasteListAddBtn">Add to shopping list</button>
    </div>
  `;
  document.getElementById("pasteBackBtn").addEventListener("click", () => setTab("shop"));
  document.getElementById("pasteListAddBtn").addEventListener("click", async () => {
    const raw = document.getElementById("pasteListInput").value;
    const lines = raw.split("\n").map(stripListMarker).filter(Boolean);
    if (lines.length === 0) return;
    const before = await getShopItems();
    let lastSuggestion = null;
    for (const line of lines) {
      const result = await addTextToShoppingList(line);
      if (result.suggestion) lastSuggestion = result;
    }
    setTab("shop");
    if (lastSuggestion) {
      offerAliasMerge(lastSuggestion.catalogEntry, lastSuggestion.suggestion, renderShopListArea);
    } else {
      showToast(`Added ${lines.length} item(s) to your shopping list.`, async () => { await saveShopItems(before); }, renderShopListArea);
    }
  });
}

// Clears the current list and repopulates it with any items flagged
// "Default" in the Item Manager, for starting a fresh trip.
async function startNewShoppingList() {
  const before = await getShopItems();
  const catalog = await getItemCatalog();
  const defaults = catalog.filter(c => c.defaultItem);
  const items = [];
  for (const entry of defaults) {
    const item = {
      id: genId(), catalogId: entry.id, mergeKey: "cat:" + entry.id, name: entry.name,
      quantity: entry.defaultQty || 1, unit: entry.unit || "", step: entry.step || stepForUnit(entry.unit || ""),
      checked: false, staple: !!entry.staple, meals: []
    };
    await insertItemByReferenceOrder(items, item);
  }
  await saveShopItems(items);
  showToast(`Started a new list${defaults.length ? ` with ${defaults.length} default item(s)` : ""}.`, async () => { await saveShopItems(before); }, renderShopListArea);
  renderShopListArea();
}

function buildShoppingListText(items) {
  const unchecked = items.filter(i => !i.checked);
  const nonStaple = unchecked.filter(i => !i.staple);
  const staples = unchecked.filter(i => i.staple);
  const lines = ["Shopping List", ""];
  const lineFor = i => `- ${formatQuantity(shopItemQty(i), i.unit)} ${i.name}`.replace(/\s+/g, " ").trim();

  nonStaple.forEach(i => lines.push(lineFor(i)));
  if (staples.length > 0) {
    lines.push("", "Staples (probably already have):");
    staples.forEach(i => lines.push(lineFor(i)));
  }

  return lines.join("\n").trim();
}

async function copyShoppingListText() {
  const items = await getShopItems();
  const text = buildShoppingListText(items);
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied! Paste it into your notes app.", null, null);
  } catch (e) {
    showToast("Couldn't copy automatically -- try again.", null, null);
  }
}

async function exportShopList() {
  const shopItems = await getShopItems();
  const blob = new Blob([JSON.stringify({ shopItems }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rustle-up-shopping-list-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function handleShopListFileImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      const incoming = Array.isArray(parsed) ? parsed : (parsed.shopItems || []);
      const before = await getShopItems();
      const withFreshIds = incoming.map(i => ({ ...i, id: genId() }));
      await saveShopItems(before.concat(withFreshIds));
      showToast(`Imported ${withFreshIds.length} item(s).`, async () => { await saveShopItems(before); }, renderShopListArea);
      renderShopListArea();
    } catch (err) {
      showToast("Import failed -- invalid JSON.", null, null);
    }
    e.target.value = "";
  };
  reader.readAsText(file);
}

// Static chrome (add box, search box, manage-items link) is rendered
// once; renderShopListArea() re-renders just the item list below it, so
// typing in the search box never rebuilds the input and loses focus.
async function renderShopNotesCard() {
  const container = document.getElementById("shopNotesCard");
  if (!container) return;
  const notes = await getShopNotes();
  container.innerHTML = renderNotesCard("shopNotes", notes, shopNotesOpen, "Notes for this shopping trip...");
  document.getElementById("shopNotesToggle").addEventListener("click", () => {
    shopNotesOpen = !shopNotesOpen;
    renderShopNotesCard();
  });
  const textarea = document.getElementById("shopNotesText");
  if (textarea) textarea.addEventListener("blur", async () => { await saveShopNotesText(textarea.value); });
}

async function renderShoppingList() {
  const main = document.getElementById("main");
  const catalog = await getItemCatalog();
  main.innerHTML = `
    <div id="shopNotesCard"></div>
    <div class="add-item-row">
      <input type="text" id="newItemInput" list="itemSuggestions" placeholder="Add an item...">
      <button class="primary-btn" id="addItemBtn" style="margin-top:0;">Add</button>
    </div>
    <datalist id="itemSuggestions">
      ${catalog.map(e => `<option value="${escapeAttr(e.name)}">`).join("")}
    </datalist>
    <div class="toolbar">
      <input type="text" id="shopSearchInput" placeholder="Search your list..." value="${escapeAttr(currentShopSearch)}">
    </div>
    <div class="btn-row" style="margin-bottom:14px;">
      <button class="secondary-btn" id="pasteListBtn">Paste a list</button>
      <button class="secondary-btn" id="newListBtn">New list</button>
      <button class="secondary-btn" id="manageIngredientsBtn">Manage items</button>
      <button class="secondary-btn" id="exportShopBtn">Export list</button>
      <button class="secondary-btn" id="importShopBtn">Import list</button>
      <input type="file" id="shopFileInput" accept="application/json">
    </div>
    <div id="shopListArea"></div>
  `;

  await renderShopNotesCard();
  document.getElementById("addItemBtn").addEventListener("click", addManualItem);
  document.getElementById("newItemInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addManualItem();
  });
  document.getElementById("pasteListBtn").addEventListener("click", renderPasteList);
  document.getElementById("newListBtn").addEventListener("click", startNewShoppingList);
  document.getElementById("manageIngredientsBtn").addEventListener("click", renderItemCatalog);
  document.getElementById("exportShopBtn").addEventListener("click", exportShopList);
  document.getElementById("importShopBtn").addEventListener("click", () => document.getElementById("shopFileInput").click());
  document.getElementById("shopFileInput").addEventListener("change", handleShopListFileImport);
  document.getElementById("shopSearchInput").addEventListener("input", (e) => {
    currentShopSearch = e.target.value;
    renderShopListArea();
  });

  renderShopListArea();
}

async function renderShopListArea() {
  const listArea = document.getElementById("shopListArea");
  if (!listArea) return;
  const items = await getShopItems();
  const term = currentShopSearch.trim().toLowerCase();
  const matches = (i) => !term || i.name.toLowerCase().includes(term) || (i.meals || []).some(m => m.toLowerCase().includes(term));

  const unchecked = items.filter(i => !i.checked && matches(i));
  const checked = items.filter(i => i.checked && matches(i));
  const nonStaple = unchecked.filter(i => !i.staple);
  const staples = unchecked.filter(i => i.staple);

  let html = "";
  if (items.length === 0) {
    html += `<div class="empty-msg">Empty. Add items above, or compare against your Meal Plan.</div>`;
  } else if (term && nonStaple.length === 0 && staples.length === 0 && checked.length === 0) {
    html += `<div class="empty-msg">No items match "${escapeHtml(currentShopSearch)}".</div>`;
  } else {
    if (nonStaple.length === 0 && staples.length === 0) {
      html += `<div class="empty-msg">Everything's checked off!${checked.length ? " Tap “Show checked” below." : ""}</div>`;
    }
    if (nonStaple.length > 0) {
      html += `<div>${nonStaple.map(item => renderShopItem(item, { scope: "main" })).join("")}</div>`;
    }
    if (staples.length > 0) {
      html += `<div class="staple-section">
        <div class="section-label">Staples</div>
        <div>${staples.map(item => renderShopItem(item, { hideBadge: true, scope: "staple" })).join("")}</div>
      </div>`;
    }

    html += `<div class="btn-row" style="margin-top:16px;">`;
    if (shopSelectMode) {
      const n = selectedShopIds.size;
      html += `<button class="secondary-btn" id="moveUpBtn" ${n === 0 ? "disabled" : ""}>Move up${n ? ` (${n})` : ""}</button>`;
      html += `<button class="secondary-btn" id="moveDownBtn" ${n === 0 ? "disabled" : ""}>Move down${n ? ` (${n})` : ""}</button>`;
      html += `<button class="secondary-btn" id="doneSelectBtn">Done</button>`;
    } else {
      html += `<button class="secondary-btn" id="selectModeBtn">Select</button>`;
      html += `<button class="secondary-btn" id="updateOrderBtn">Update order</button>`;
      html += `<button class="secondary-btn" id="copyTextBtn">Copy as text</button>`;
      if (checked.length > 0) {
        html += `<button class="secondary-btn" id="toggleCheckedBtn">${showCheckedItems ? "Hide" : "Show"} checked (${checked.length})</button>`;
      }
      html += `<button class="secondary-btn" id="clearCheckedBtn">Clear checked</button><button class="secondary-btn" id="clearAllBtn">Clear all</button>`;
    }
    html += `</div>`;

    if (!shopSelectMode && showCheckedItems && checked.length > 0) {
      html += `<div class="section-label">Checked off</div><div>${checked.sort((a, b) => a.name.localeCompare(b.name)).map(i => renderShopItem(i)).join("")}</div>`;
    }
  }

  listArea.innerHTML = html;

  listArea.querySelectorAll(".shop-item").forEach(el => {
    const id = el.dataset.id;
    const scope = el.dataset.scope;

    if (shopSelectMode) {
      if (scope) {
        el.addEventListener("click", () => {
          if (selectedShopIds.has(id)) selectedShopIds.delete(id); else selectedShopIds.add(id);
          renderShopListArea();
        });
      }
      return;
    }

    el.querySelector(".box").addEventListener("click", async (e) => {
      e.stopPropagation();
      const all = await getShopItems();
      const item = all.find(i => i.id === id);
      if (!item) return;
      item.checked = !item.checked;
      await saveShopItems(all);
      if (item.checked) {
        showToast(`Checked off "${item.name}".`, async () => {
          const all2 = await getShopItems();
          const it2 = all2.find(i => i.id === id);
          if (it2) it2.checked = false;
          await saveShopItems(all2);
        }, renderShopListArea);
      }
      renderShopListArea();
    });
    const textEl = el.querySelector(".item-text");
    if (textEl) {
      textEl.addEventListener("click", (e) => {
        e.stopPropagation();
        startEditItem(el, id);
      });
    }
    const handle = el.querySelector('[data-action="drag-handle"]');
    if (handle) wireDragHandle(handle, el, scope);

    const qtyDec = el.querySelector('[data-action="qty-dec"]');
    if (qtyDec) qtyDec.addEventListener("click", async (e) => {
      e.stopPropagation();
      const all = await getShopItems();
      const item = all.find(i => i.id === id);
      if (!item) return;
      item.quantity = Math.max(0, roundQty(shopItemQty(item) - shopItemStep(item)));
      item.step = shopItemStep(item);
      await saveShopItems(all);
      renderShopListArea();
    });
    const qtyInc = el.querySelector('[data-action="qty-inc"]');
    if (qtyInc) qtyInc.addEventListener("click", async (e) => {
      e.stopPropagation();
      const all = await getShopItems();
      const item = all.find(i => i.id === id);
      if (!item) return;
      item.quantity = roundQty(shopItemQty(item) + shopItemStep(item));
      item.step = shopItemStep(item);
      await saveShopItems(all);
      renderShopListArea();
    });
    const qtyInput = el.querySelector(".qty-input");
    if (qtyInput) {
      qtyInput.addEventListener("click", (e) => e.stopPropagation());
      qtyInput.addEventListener("blur", async () => {
        const all = await getShopItems();
        const item = all.find(i => i.id === id);
        if (!item) return;
        const val = Number(qtyInput.value);
        item.quantity = isNaN(val) ? shopItemQty(item) : Math.max(0, val);
        await saveShopItems(all);
        renderShopListArea();
      });
      qtyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") qtyInput.blur(); });
    }

    const delBtn = el.querySelector('[data-action="delete-item"]');
    if (delBtn) {
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const all = await getShopItems();
        const item = all.find(i => i.id === id);
        await saveShopItems(all.filter(i => i.id !== id));
        showToast(`Removed "${item.name}".`, async () => {
          const cur = await getShopItems();
          cur.push(item);
          await saveShopItems(cur);
        }, renderShopListArea);
        renderShopListArea();
      });
    }
  });

  const selectModeBtn = document.getElementById("selectModeBtn");
  if (selectModeBtn) selectModeBtn.addEventListener("click", () => {
    shopSelectMode = true;
    selectedShopIds = new Set();
    renderShopListArea();
  });
  const doneSelectBtn = document.getElementById("doneSelectBtn");
  if (doneSelectBtn) doneSelectBtn.addEventListener("click", () => {
    shopSelectMode = false;
    selectedShopIds = new Set();
    renderShopListArea();
  });
  const moveUpBtn = document.getElementById("moveUpBtn");
  if (moveUpBtn) moveUpBtn.addEventListener("click", () => moveSelectedItems(-1));
  const moveDownBtn = document.getElementById("moveDownBtn");
  if (moveDownBtn) moveDownBtn.addEventListener("click", () => moveSelectedItems(1));

  const updateOrderBtn = document.getElementById("updateOrderBtn");
  if (updateOrderBtn) updateOrderBtn.addEventListener("click", async () => {
    await updateShopOrder();
    showToast("Order saved -- new items will slot in around this.", null, null);
  });
  const copyTextBtn = document.getElementById("copyTextBtn");
  if (copyTextBtn) copyTextBtn.addEventListener("click", copyShoppingListText);
  const toggleCheckedBtn = document.getElementById("toggleCheckedBtn");
  if (toggleCheckedBtn) toggleCheckedBtn.addEventListener("click", () => {
    showCheckedItems = !showCheckedItems;
    renderShopListArea();
  });
  const clearCheckedBtn = document.getElementById("clearCheckedBtn");
  if (clearCheckedBtn) clearCheckedBtn.addEventListener("click", async () => {
    const all = await getShopItems();
    const removed = all.filter(i => i.checked);
    if (removed.length === 0) return;
    await saveShopItems(all.filter(i => !i.checked));
    showToast(`Cleared ${removed.length} checked item(s).`, async () => {
      const cur = await getShopItems();
      await saveShopItems(cur.concat(removed));
    }, renderShopListArea);
    renderShopListArea();
  });
  const clearAllBtn = document.getElementById("clearAllBtn");
  if (clearAllBtn) clearAllBtn.addEventListener("click", async () => {
    const all = await getShopItems();
    if (all.length === 0) return;
    await saveShopItems([]);
    showToast(`Cleared the whole list (${all.length} item(s)).`, async () => { await saveShopItems(all); }, renderShopListArea);
    renderShopListArea();
  });
}

function renderShopItem(item, opts) {
  opts = opts || {};
  const mealsLabel = (item.meals && item.meals.length) ? item.meals.join(", ") : "";
  const selected = shopSelectMode && selectedShopIds.has(item.id);
  const leadBox = shopSelectMode
    ? `<div class="box select-box ${selected ? "checked" : ""}"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>`
    : `<div class="box"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>`;
  const qtyRow = !shopSelectMode ? `<div class="qty-row">
      <button class="qty-btn" data-action="qty-dec" title="Decrease">−</button>
      <input type="number" class="qty-input" value="${formatNum(shopItemQty(item))}" step="any">
      <span class="qty-unit">${escapeHtml(item.unit || "")}</span>
      <button class="qty-btn" data-action="qty-inc" title="Increase">+</button>
    </div>` : "";
  return `<div class="shop-item ${item.checked ? "checked" : ""} ${selected ? "selected" : ""}" data-id="${escapeAttr(item.id)}" data-scope="${escapeAttr(opts.scope || "")}">
    ${leadBox}
    ${opts.scope && !shopSelectMode ? `<div class="drag-handle" data-action="drag-handle" title="Drag to reorder">⠿</div>` : ""}
    <div class="item-body">
      <div class="item-text">${escapeHtml(item.name)}</div>
      ${qtyRow}
      ${mealsLabel ? `<div class="item-src">${escapeHtml(mealsLabel)}</div>` : ""}
    </div>
    <div class="item-controls">
      ${item.staple && !opts.hideBadge ? `<span class="icon-btn on" style="pointer-events:none;">Staple</span>` : ""}
      ${!shopSelectMode ? `<button class="icon-btn" data-action="delete-item" title="Remove item">✕</button>` : ""}
    </div>
  </div>`;
}

function startEditItem(el, id) {
  const textEl = el.querySelector(".item-text");
  const current = textEl.textContent;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "item-text-input";
  input.value = current;
  textEl.replaceWith(input);
  input.focus();
  input.setSelectionRange(current.length, current.length);
  const save = async () => {
    const val = input.value.trim();
    if (!val) { renderShopListArea(); return; }
    const all = await getShopItems();
    const item = all.find(i => i.id === id);
    if (item) {
      // Reparse the typed text so a quantity anywhere in it (either order,
      // "500g flour" or "flour 500g") updates the stepper too, not just
      // the name -- consistent with adding/pasting items.
      const parsed = parseIngredient(val);
      item.name = parsed.name || val;
      if (parsed.amount != null) {
        item.quantity = parsed.amount;
        item.unit = parsed.unit || "";
        item.step = stepForUnit(item.unit);
      }
    }
    await saveShopItems(all);
    renderShopListArea();
  };
  input.addEventListener("blur", save);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
  input.addEventListener("click", (e) => e.stopPropagation());
}

/* ---------- Item catalog (its own screen, reached from Shopping List) ---------- */

const CATALOG_UNIT_OPTIONS = ["", "g", "kg", "ml", "l"];
function unitOptionLabel(u) { return u === "" ? "Count" : u; }

function renderItemCatalogSection(catalog) {
  const rows = catalog.slice().sort((a, b) => a.name.localeCompare(b.name)).map(entry => `
    <div class="ingredient-row" data-id="${escapeAttr(entry.id)}">
      <input type="text" class="ing-name" value="${escapeAttr(entry.name)}">
      <select class="ing-unit">
        ${CATALOG_UNIT_OPTIONS.map(u => `<option value="${escapeAttr(u)}" ${u === entry.unit ? "selected" : ""}>${escapeHtml(unitOptionLabel(u))}</option>`).join("")}
      </select>
      <input type="number" class="ing-step" value="${entry.step}" title="Step" style="width:60px;">
      <input type="number" class="ing-defaultqty" value="${entry.defaultQty}" title="Default quantity" style="width:60px;">
      <label class="staple-check"><input type="checkbox" class="ing-staple" ${entry.staple ? "checked" : ""}> Staple</label>
      <label class="staple-check" title="Automatically add this to every new shopping list"><input type="checkbox" class="ing-default" ${entry.defaultItem ? "checked" : ""}> Auto-add</label>
      <input type="text" class="ing-aliases" value="${escapeAttr((entry.aliases || []).join(", "))}" placeholder="aliases">
      <button class="icon-btn" data-action="delete-ing">✕</button>
    </div>`).join("");

  return `
    <div id="ingRows">${rows || `<div class="empty-msg">Nothing yet -- add one below.</div>`}</div>
    <div class="ingredient-row" style="border-top:2px solid var(--line); margin-top:10px; padding-top:12px;">
      <input type="text" id="newIngName" placeholder="Name">
      <select id="newIngUnit">
        ${CATALOG_UNIT_OPTIONS.map(u => `<option value="${escapeAttr(u)}">${escapeHtml(unitOptionLabel(u))}</option>`).join("")}
      </select>
      <input type="number" id="newIngStep" value="1" title="Step" style="width:60px;">
      <input type="number" id="newIngDefaultQty" value="1" title="Default quantity" style="width:60px;">
      <label class="staple-check"><input type="checkbox" id="newIngStaple"> Staple</label>
      <label class="staple-check" title="Automatically add this to every new shopping list"><input type="checkbox" id="newIngDefault"> Auto-add</label>
      <input type="text" id="newIngAliases" placeholder="aliases">
      <button class="secondary-btn" id="addIngBtn">Add</button>
    </div>
  `;
}

function wireItemCatalogEvents() {
  const main = document.getElementById("main");
  main.querySelectorAll(".ingredient-row[data-id]").forEach(row => {
    const id = row.dataset.id;
    const save = async () => {
      const catalog = await getItemCatalog();
      const entry = catalog.find(e => e.id === id);
      if (!entry) return;
      entry.name = row.querySelector(".ing-name").value.trim() || entry.name;
      entry.unit = row.querySelector(".ing-unit").value;
      entry.step = Number(row.querySelector(".ing-step").value) || 1;
      entry.defaultQty = Number(row.querySelector(".ing-defaultqty").value) || 1;
      entry.staple = row.querySelector(".ing-staple").checked;
      entry.defaultItem = row.querySelector(".ing-default").checked;
      entry.aliases = row.querySelector(".ing-aliases").value.split(",").map(s => s.trim()).filter(Boolean);
      await saveItemCatalog(catalog);
    };
    row.querySelector(".ing-name").addEventListener("blur", save);
    row.querySelector(".ing-step").addEventListener("blur", save);
    row.querySelector(".ing-defaultqty").addEventListener("blur", save);
    row.querySelector(".ing-aliases").addEventListener("blur", save);
    row.querySelector(".ing-unit").addEventListener("change", save);
    row.querySelector(".ing-staple").addEventListener("change", save);
    row.querySelector(".ing-default").addEventListener("change", save);
    row.querySelector('[data-action="delete-ing"]').addEventListener("click", async () => {
      const catalog = await getItemCatalog();
      const entry = catalog.find(e => e.id === id);
      await saveItemCatalog(catalog.filter(e => e.id !== id));
      showToast(`Deleted "${entry.name}".`, async () => {
        const cur = await getItemCatalog();
        cur.push(entry);
        await saveItemCatalog(cur);
      }, renderItemCatalog);
      renderItemCatalog();
    });
  });
  const addIngBtn = document.getElementById("addIngBtn");
  if (addIngBtn) addIngBtn.addEventListener("click", async () => {
    const name = document.getElementById("newIngName").value.trim();
    if (!name) return;
    const unit = document.getElementById("newIngUnit").value;
    const step = Number(document.getElementById("newIngStep").value) || stepForUnit(unit);
    const defaultQty = Number(document.getElementById("newIngDefaultQty").value) || 1;
    const staple = document.getElementById("newIngStaple").checked;
    const defaultItem = document.getElementById("newIngDefault").checked;
    const aliases = document.getElementById("newIngAliases").value.split(",").map(s => s.trim()).filter(Boolean);
    if (aliases.length === 0) aliases.push(name.toLowerCase());
    const catalog = await getItemCatalog();
    const suggestion = findFuzzyCatalogSuggestion(name, catalog);
    const newEntry = { id: slugify(name) + "-" + Date.now().toString(36).slice(-4), name, unit, step, defaultQty, staple, defaultItem, aliases };
    catalog.push(newEntry);
    await saveItemCatalog(catalog);
    renderItemCatalog();
    if (suggestion) offerAliasMerge(newEntry, suggestion, renderItemCatalog);
  });
  const newIngUnit = document.getElementById("newIngUnit");
  if (newIngUnit) newIngUnit.addEventListener("change", (e) => {
    document.getElementById("newIngStep").value = stepForUnit(e.target.value);
  });
}

async function renderItemCatalog() {
  const main = document.getElementById("main");
  const catalog = await getItemCatalog();
  main.innerHTML = `
    <button class="back-btn" id="ingBackBtn">&larr; Back to shopping list</button>
    <div class="detail-card">
      <h2>Items</h2>
      ${renderItemCatalogSection(catalog)}
    </div>
  `;
  document.getElementById("ingBackBtn").addEventListener("click", () => setTab("shop"));
  wireItemCatalogEvents();
}

/* ---------- Add / edit a recipe ---------- */

const SCHEMA_EXAMPLE = {
  id: "short-unique-slug",
  title: "Recipe Title",
  source: "e.g. cookbook name & page, or website name",
  sourceUrl: "https://example.com/recipe (optional, if it's online)",
  tags: ["chicken", "quick", "weeknight"],
  serves: 2,
  time: "20 min",
  ingredients: ["200g chicken breast", "1 lemon"],
  method: ["Step one.", "Step two."],
  notes: "Optional tips or variations.",
  dateAdded: "2026-07-11"
};

function detectDefaultServes(item) {
  if (item.serves && !isNaN(item.serves)) return Number(item.serves);
  const label = item.servesLabel || "";
  const m = label.match(/(\d+)/);
  if (m) return Number(m[1]);
  return null;
}

function buildClaudePrompt() {
  return `Please read the recipe in the link or photo I'm about to share, and return it as a single JSON object (or a JSON array if there's more than one recipe) using exactly this schema -- no extra commentary, just the JSON:

${JSON.stringify(SCHEMA_EXAMPLE, null, 2)}

Notes:
- ingredients and method should each be an array of strings, one item/step per entry.
- serves should be a plain number if you can tell how many it serves.
- sourceUrl is optional -- include it only if the recipe came from a link.
- Only title and ingredients are strictly required; leave other fields blank/empty if unknown.`;
}

async function copyClaudePrompt() {
  try {
    await navigator.clipboard.writeText(buildClaudePrompt());
    showToast("Copied! Paste into Claude with a link or photo.", null, null);
  } catch (e) {
    showToast("Couldn't copy automatically -- try again.", null, null);
  }
}

function renderAdd(statusMsg) {
  const main = document.getElementById("main");
  main.innerHTML = `
    <button class="back-btn" id="addBackBtn">&larr; Back to recipes</button>
    <div class="settings-card">
      <h3>Add manually</h3>
      <div class="btn-row"><button class="primary-btn" id="manualAddBtn" style="margin-top:0;">Add manually</button></div>
    </div>
    <div class="settings-card">
      <h3>Add via Claude</h3>
      <div class="btn-row"><button class="secondary-btn" id="copyPromptBtn">Copy prompt for Claude</button></div>
      <textarea id="jsonInput" placeholder="Paste recipe JSON here..." style="margin-top:12px;"></textarea>
      <button class="primary-btn" id="reviewJsonBtn">Review before adding</button>
      ${statusMsg ? statusMsg : ""}
    </div>
    <div class="schema-box">
      <pre>${escapeHtml(JSON.stringify(SCHEMA_EXAMPLE, null, 2))}</pre>
      <div>Only <code>title</code> and <code>ingredients</code> are required.</div>
    </div>
  `;
  document.getElementById("addBackBtn").addEventListener("click", renderRecipes);
  document.getElementById("manualAddBtn").addEventListener("click", () => renderRecipeForm(null));
  document.getElementById("copyPromptBtn").addEventListener("click", copyClaudePrompt);
  document.getElementById("reviewJsonBtn").addEventListener("click", handleJsonReview);
}

function renderRecipeForm(recipe) {
  const main = document.getElementById("main");
  const isEdit = !!recipe;
  const r = recipe || { title: "", source: "", sourceUrl: "", tags: [], serves: null, servesLabel: "", time: "", ingredients: [], method: [], notes: "" };
  const defaultServes = r.serves || detectDefaultServes(r) || 4;

  main.innerHTML = `
    <button class="back-btn" id="formBackBtn">&larr; ${isEdit ? "Back to recipe" : "Back"}</button>
    <div class="detail-card">
      <h2>${isEdit ? "Edit recipe" : "Add a recipe"}</h2>
      <div class="form-field"><label>Title</label><input type="text" id="fTitle" value="${escapeAttr(r.title)}"></div>
      <div class="form-row-2">
        <div class="form-field"><label>Source</label><input type="text" id="fSource" value="${escapeAttr(r.source || "")}" placeholder="book & page, or website"></div>
        <div class="form-field"><label>Source link</label><input type="url" id="fSourceUrl" value="${escapeAttr(r.sourceUrl || "")}" placeholder="optional"></div>
      </div>
      <div class="form-row-2">
        <div class="form-field"><label>Serves</label><input type="number" min="1" id="fServes" value="${defaultServes}"></div>
        <div class="form-field"><label>Time</label><input type="text" id="fTime" value="${escapeAttr(r.time || "")}" placeholder="e.g. 20 min"></div>
      </div>
      <div class="form-field"><label>Tags (comma separated)</label><input type="text" id="fTags" value="${escapeAttr((r.tags || []).join(", "))}"></div>
      <div class="form-field"><label>Ingredients (one per line)</label><textarea id="fIngredients">${escapeHtml((r.ingredients || []).join("\n"))}</textarea></div>
      <div class="form-field"><label>Method (one step per line)</label><textarea id="fMethod">${escapeHtml((r.method || []).join("\n"))}</textarea></div>
      <div class="form-field"><label>Notes</label><textarea id="fNotes" style="min-height:70px;">${escapeHtml(r.notes || "")}</textarea></div>
      <button class="primary-btn" id="saveRecipeBtn">${isEdit ? "Save changes" : "Save recipe"}</button>
      <div id="formStatus"></div>
    </div>
  `;
  document.getElementById("formBackBtn").addEventListener("click", () => {
    if (isEdit) renderDetail(r.id); else renderAdd();
  });
  document.getElementById("saveRecipeBtn").addEventListener("click", async () => {
    const title = document.getElementById("fTitle").value.trim();
    const ingredients = document.getElementById("fIngredients").value.split("\n").map(s => s.trim()).filter(Boolean);
    if (!title || ingredients.length === 0) {
      document.getElementById("formStatus").innerHTML = `<div class="status-msg status-err">Title and at least one ingredient are required.</div>`;
      return;
    }
    const serves = Number(document.getElementById("fServes").value) || null;
    const method = document.getElementById("fMethod").value.split("\n").map(s => s.trim()).filter(Boolean);
    const tags = document.getElementById("fTags").value.split(",").map(s => s.trim()).filter(Boolean);
    const source = document.getElementById("fSource").value.trim();
    const sourceUrl = document.getElementById("fSourceUrl").value.trim();
    const time = document.getElementById("fTime").value.trim();
    const notes = document.getElementById("fNotes").value.trim();
    let servesLabel = r.servesLabel || "";
    if (serves) servesLabel = /makes/i.test(servesLabel) ? `Makes ${serves} portions` : `Serves ${serves}`;

    const previous = isEdit ? { ...r } : null;
    const savedRecipe = {
      id: isEdit ? r.id : slugify(title) + "-" + Date.now().toString(36).slice(-4),
      title, source, sourceUrl, tags, serves, servesLabel, time, ingredients, method, notes,
      dateAdded: r.dateAdded || new Date().toISOString().slice(0, 10)
    };
    await putRecipe(savedRecipe);
    if (isEdit) {
      showToast("Recipe updated.", async () => { await putRecipe(previous); }, () => renderDetail(previous.id));
    } else {
      showToast("Recipe added.", async () => { await deleteRecipe(savedRecipe.id); }, renderRecipes);
    }
    renderDetail(savedRecipe.id);
  });
}

function handleJsonReview() {
  const raw = document.getElementById("jsonInput").value.trim();
  if (!raw) return;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    renderAdd(`<div class="status-msg status-err">Couldn't parse that as JSON: ${escapeHtml(e.message)}</div>`);
    return;
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const valid = items.filter(item => item.title && item.ingredients);
  const skipped = items.length - valid.length;
  if (valid.length === 0) {
    renderAdd(`<div class="status-msg status-err">Nothing to add — every item needs at least a title and ingredients.</div>`);
    return;
  }
  pendingImport = valid.map(item => ({ item, serves: detectDefaultServes(item) }));
  renderReview(skipped);
}

function renderReview(skippedCount) {
  const main = document.getElementById("main");
  let html = `<div class="settings-card">
    <h3>Confirm servings</h3>`;
  pendingImport.forEach((entry, idx) => {
    html += `<div class="serves-review">
      <h4>${escapeHtml(entry.item.title)}</h4>
      <div class="serves-row">
        <label for="serves-${idx}">Serves</label>
        <input type="number" min="1" id="serves-${idx}" value="${entry.serves != null ? entry.serves : ""}" placeholder="?">
      </div>
    </div>`;
  });
  html += `<div class="btn-row" style="margin-top:6px;">
      <button class="primary-btn" id="confirmImportBtn" style="margin-top:0;">Add ${pendingImport.length} recipe(s)</button>
      <button class="secondary-btn" id="cancelImportBtn">Cancel</button>
    </div>
    ${skippedCount ? `<div class="status-msg status-err" style="margin-top:10px;">Skipped ${skippedCount} item(s) missing a title or ingredients.</div>` : ""}
  </div>`;
  main.innerHTML = html;

  document.getElementById("confirmImportBtn").addEventListener("click", handleConfirmImport);
  document.getElementById("cancelImportBtn").addEventListener("click", () => {
    pendingImport = null;
    renderAdd();
  });
}

async function handleConfirmImport() {
  let added = 0;
  for (let idx = 0; idx < pendingImport.length; idx++) {
    const { item } = pendingImport[idx];
    const servesInput = document.getElementById(`serves-${idx}`).value;
    const serves = servesInput ? Number(servesInput) : null;
    let servesLabel = item.servesLabel || "";
    if (serves) {
      servesLabel = /makes/i.test(servesLabel) ? `Makes ${serves} portions` : `Serves ${serves}`;
    }
    const recipe = {
      id: item.id ? slugify(item.id) : slugify(item.title) + "-" + Date.now().toString(36).slice(-4),
      title: item.title,
      source: item.source || "",
      sourceUrl: item.sourceUrl || "",
      tags: item.tags || [],
      serves: serves || null,
      servesLabel,
      time: item.time || "",
      ingredients: item.ingredients || [],
      method: item.method || [],
      notes: item.notes || "",
      dateAdded: item.dateAdded || new Date().toISOString().slice(0, 10)
    };
    await putRecipe(recipe);
    added++;
  }
  pendingImport = null;
  renderAdd(`<div class="status-msg status-ok">Added ${added} recipe(s).</div>`);
}

/* ---------- Settings: export / import ---------- */

function renderSettings() {
  const main = document.getElementById("main");
  main.innerHTML = `
    <div class="settings-card">
      <h3>Export library</h3>
      <div class="btn-row"><button class="secondary-btn" id="exportBtn">Export as JSON</button></div>
    </div>
    <div class="settings-card">
      <h3>Import library</h3>
      <div class="btn-row">
        <button class="secondary-btn" id="importBtn">Choose file to import</button>
        <input type="file" id="fileInput" accept="application/json">
      </div>
      <div id="importStatus"></div>
    </div>
    <div class="settings-card">
      <h3>About</h3>
      <p>Stored locally in this browser only. Export regularly as a backup.</p>
    </div>
  `;
  document.getElementById("exportBtn").addEventListener("click", exportLibrary);
  document.getElementById("importBtn").addEventListener("click", () => document.getElementById("fileInput").click());
  document.getElementById("fileInput").addEventListener("change", handleFileImport);
}

async function exportLibrary() {
  const recipes = await getAllRecipes();
  const mealPlan = await getMealPlan();
  const shopItems = await getShopItems();
  const itemCatalog = await getItemCatalog();
  const payload = { recipes, mealPlan, shopItems, itemCatalog };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rustle-up-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function handleFileImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      const isBundle = !Array.isArray(parsed);
      const recipeItems = isBundle ? (parsed.recipes || []) : parsed;
      let count = 0;
      for (const item of recipeItems) {
        if (!item.title || !item.ingredients) continue;
        const recipe = {
          id: item.id || slugify(item.title) + "-" + Date.now().toString(36).slice(-4),
          title: item.title,
          source: item.source || "",
          sourceUrl: item.sourceUrl || "",
          tags: item.tags || [],
          serves: item.serves || null,
          servesLabel: item.servesLabel || "",
          time: item.time || "",
          ingredients: item.ingredients || [],
          method: item.method || [],
          notes: item.notes || "",
          dateAdded: item.dateAdded || new Date().toISOString().slice(0, 10)
        };
        await putRecipe(recipe);
        count++;
      }
      if (isBundle) {
        if (parsed.mealPlan) await saveMealPlan(parsed.mealPlan);
        if (parsed.shopItems) await saveShopItems(parsed.shopItems);
        if (parsed.itemCatalog) await saveItemCatalog(parsed.itemCatalog);
        else if (parsed.ingredientCatalog) {
          await saveItemCatalog(parsed.ingredientCatalog.map(e => ({
            id: e.id, name: e.name, aliases: e.aliases || [], staple: !!e.staple, unit: "", step: 1, defaultQty: 1
          })));
        }
      }
      document.getElementById("importStatus").innerHTML =
        `<div class="status-msg status-ok">Imported ${count} recipe(s)${isBundle ? ", plus meal plan / shopping list / items" : ""}.</div>`;
    } catch (err) {
      document.getElementById("importStatus").innerHTML = `<div class="status-msg status-err">Import failed: ${escapeHtml(err.message)}</div>`;
    }
  };
  reader.readAsText(file);
}

/* ---------- Utilities ---------- */

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

/* ---------- Tabs ---------- */

function setTab(tab) {
  currentTab = tab;
  document.getElementById("tabRecipesBtn").classList.toggle("active", tab === "recipes");
  document.getElementById("tabPlanBtn").classList.toggle("active", tab === "mealplan");
  document.getElementById("tabShopBtn").classList.toggle("active", tab === "shop");
  document.getElementById("tabSettingsBtn").classList.toggle("active", tab === "settings");
  if (tab === "recipes") renderRecipes();
  else if (tab === "mealplan") renderMealPlan();
  else if (tab === "shop") { showCheckedItems = false; renderShoppingList(); }
  else if (tab === "settings") renderSettings();
}

document.getElementById("tabRecipesBtn").addEventListener("click", () => setTab("recipes"));
document.getElementById("tabPlanBtn").addEventListener("click", () => setTab("mealplan"));
document.getElementById("tabShopBtn").addEventListener("click", () => setTab("shop"));
document.getElementById("tabSettingsBtn").addEventListener("click", () => setTab("settings"));
document.getElementById("undoToastBtn").addEventListener("click", async () => {
  const undoFn = toastUndoFn;
  const refreshFn = toastRefreshFn;
  hideToast();
  if (undoFn) await undoFn();
  if (refreshFn) refreshFn();
});

(async () => {
  db = await openDB();
  await seedIfEmpty();
  await seedItemCatalogIfEmpty();
  setTab("recipes");
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  });
}
