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

/* ---------- Icons ----------
   Inline stroke-style SVGs (currentColor) instead of emoji, so they render
   consistently across platforms/fonts and inherit button/heading color. */
const ICON_POT = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h18v2a7 7 0 0 1-7 7h-4a7 7 0 0 1-7-7v-2z"/><path d="M1 10h22"/><path d="M8 10V7.5A1.5 1.5 0 0 1 9.5 6H10"/><path d="M15 6h.5A1.5 1.5 0 0 1 17 7.5V10"/></svg>`;
const ICON_SHUFFLE = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`;
const ICON_FLAME = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 17a2.5 2.5 0 0 0 2.5-2.5c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7.5 7.5 0 1 1-15 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`;
// Distinguishes a meal-plan entry that links to a real recipe (book icon,
// tappable) from a manual placeholder entry (note icon, not tappable) --
// same idea used on Home's "at a glance" list and anywhere else the two
// need to read differently at a glance.
const ICON_BOOK = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
const ICON_NOTE = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
// A small shared icon set so secondary/utility actions (delete, print,
// export, import) can read as icon-only buttons instead of yet more text
// buttons competing for attention next to the primary, state-labeled ones
// (like "+ Add to meal plan" / "Mark as cooked") that actually need words.
const ICON_TRASH = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
const ICON_EDIT = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>`;
const ICON_PRINT = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`;
const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
const ICON_UPLOAD = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
const ICON_LIST = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
const ICON_CLIPBOARD = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>`;
const ICON_CHEVRON_DOWN = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
const ICON_EYE = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_MORE = `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>`;

// Applied immediately (before IndexedDB/DOM setup) to avoid a flash of
// the wrong theme on load if it's been explicitly overridden.
applyThemePreference();

const DB_NAME = "recipe-box";
const DB_VERSION = 1;
const STORE = "recipes";
let db;
let currentTab = null; // null while on Home; set by renderStackTop() otherwise
let currentSearch = "";
let currentTagFilter = "";
let currentSort = "title"; // title | rating | timesCooked | lastCooked
let currentShopSearch = "";
let pendingImport = null; // recipes parsed but awaiting serves confirmation
let showCheckedItems = false;
let shopSelectMode = false;
let selectedShopIds = new Set();
let shopMenuOpen = false;
let preSettingsStack = null; // navStack snapshot from just before entering Settings, so a second cog tap returns to it
let mealPlanNotesOpen = false;
let shopNotesOpen = false;

const DEFAULT_ITEM_CATALOG = [
  { id: "salt", name: "Salt", staple: true, tags: ["staple"], aliases: ["salt"], unit: "", step: 1, defaultQty: 1 },
  { id: "black-pepper", name: "Black pepper", staple: true, tags: ["staple"], aliases: ["black pepper", "pepper"], unit: "", step: 1, defaultQty: 1 },
  { id: "olive-oil", name: "Olive oil", staple: true, tags: ["staple"], aliases: ["olive oil", "extra virgin olive oil"], unit: "", step: 1, defaultQty: 1 },
  { id: "cooking-oil", name: "Cooking oil", staple: true, tags: ["staple"], aliases: ["vegetable oil", "sesame oil", "sunflower oil"], unit: "", step: 1, defaultQty: 1 },
  { id: "sugar", name: "Sugar", staple: true, tags: ["staple"], aliases: ["sugar"], unit: "", step: 1, defaultQty: 1 },
  { id: "flour", name: "Plain flour", staple: true, tags: ["staple"], aliases: ["plain flour", "flour"], unit: "", step: 1, defaultQty: 1 },
  { id: "vinegar", name: "Vinegar", staple: true, tags: ["staple"], aliases: ["vinegar"], unit: "", step: 1, defaultQty: 1 },
  { id: "soy-sauce", name: "Soy sauce", staple: true, tags: ["staple"], aliases: ["soy sauce"], unit: "", step: 1, defaultQty: 1 },
  { id: "stock-cube", name: "Stock cubes", staple: true, tags: ["staple"], aliases: ["stock cube", "stock cubes"], unit: "", step: 1, defaultQty: 1 },
  { id: "rice-pouch", name: "Basmati rice (pouch)", staple: false, tags: [],
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

// Recipe photos are stored inline as base64 in IndexedDB (no image
// hosting/server -- consistent with everything else in this app being
// fully local). Downscaling + re-encoding as JPEG here keeps that from
// bloating storage or export size the way a raw phone-camera photo would.
function resizeImageFile(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Not a readable image"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else { width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
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
      tags: e.staple ? ["staple"] : [],
      unit: "", step: 1, defaultQty: 1
    })));
  } else {
    await saveItemCatalog(DEFAULT_ITEM_CATALOG.map(e => ({ ...e })));
  }
}

// One-time reconciliation for catalogs saved before "staple" became a tag
// (entry.tags including "staple") rather than a lone boolean -- without
// this, existing staple items would silently show as un-tagged since the
// UI now reads entry.tags, not entry.staple, to decide what to display.
async function migrateStapleTags() {
  const catalog = await getItemCatalog();
  let changed = false;
  catalog.forEach(e => {
    e.tags = e.tags || [];
    if (e.staple && !e.tags.includes("staple")) { e.tags.push("staple"); changed = true; }
  });
  if (changed) await saveItemCatalog(catalog);
}

async function getMealPlanNotes() { return (await getMeta("mealPlanNotes")) || ""; }
async function saveMealPlanNotesText(text) { await setMeta("mealPlanNotes", text); }
async function getShopNotes() { return (await getMeta("shopNotes")) || ""; }
async function saveShopNotesText(text) { await setMeta("shopNotes", text); }

// A rolling archive of past shopping lists, so clearing/starting a new one
// doesn't lose the list for good once the undo toast expires.
async function getShopHistory() { return (await getMeta("shopHistory")) || []; }
async function saveShopHistory(list) { await setMeta("shopHistory", list); }
async function archiveShoppingList(items) {
  if (!items || items.length === 0) return;
  const history = await getShopHistory();
  history.unshift({ id: genId(), clearedAt: Date.now(), items });
  await saveShopHistory(history.slice(0, 20));
}

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

// True if the typed text contains one of this entry's anti-aliases -- terms
// that should always be excluded from matching it, even though an alias or
// the name would otherwise line up (e.g. "Bread" excluding "sourdough" so a
// recipe calling for sourdough doesn't silently get lumped in with it).
function isAntiAliased(norm, entry) {
  return (entry.antiAliases || []).some(a => {
    const x = a.toLowerCase().trim();
    return x && norm.indexOf(x) !== -1;
  });
}

function matchCatalog(name, catalog) {
  const norm = name.toLowerCase();
  let best = null, bestLen = 0;
  catalog.forEach(entry => {
    if (isAntiAliased(norm, entry)) return;
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
  const norm = name.toLowerCase();
  let best = null, bestRatio = 0;
  catalog.forEach(entry => {
    if (isAntiAliased(norm, entry)) return;
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
    name, aliases: [name.toLowerCase()], antiAliases: [], staple: false,
    unit: unit || "", step: stepForUnit(unit || ""), defaultQty: defaultQty || 1
  };
  catalog.push(entry);
  await saveItemCatalog(catalog);
  return { entry, suggestion };
}

// Folds one catalog entry into another (used both when confirming a
// just-created entry is really a duplicate, and by the duplicate scanner
// for older entries): all of the source's name+aliases become aliases on
// the target, the source is removed, and any shopping items pointing at
// it get repointed to the canonical item.
async function mergeCatalogEntries(fromEntry, targetId) {
  const catalog = await getItemCatalog();
  const target = catalog.find(e => e.id === targetId);
  if (!target) return;
  const incoming = [fromEntry.name.toLowerCase(), ...(fromEntry.aliases || [])];
  incoming.forEach(a => { if (a && !target.aliases.includes(a)) target.aliases.push(a); });
  await saveItemCatalog(catalog.filter(e => e.id !== fromEntry.id));

  const items = await getShopItems();
  items.filter(i => i.catalogId === fromEntry.id).forEach(i => {
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
      await mergeCatalogEntries(newEntry, suggestion.id);
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

// Recomputes the dragged item's preview transform and the shift-preview on
// its siblings from shopDrag.lastClientY + the current scroll position.
// Pulled out of pointermove so the auto-scroll loop can re-run it every
// frame while the pointer sits near a viewport edge, without needing its
// own pointermove events (which don't fire while the page is scrolling
// under a stationary finger/cursor).
function updateDragVisual(itemEl) {
  if (!shopDrag) return;
  const pageY = shopDrag.lastClientY + window.scrollY;
  const delta = pageY - shopDrag.startY;
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
}

const DRAG_SCROLL_ZONE = 70; // px from top/bottom edge of viewport that triggers auto-scroll
const DRAG_SCROLL_MAX = 16; // px scrolled per animation frame at the very edge

function dragAutoScrollTick() {
  if (!shopDrag) return;
  const y = shopDrag.lastClientY;
  const vh = window.innerHeight;
  let speed = 0;
  if (y < DRAG_SCROLL_ZONE) speed = -DRAG_SCROLL_MAX * (1 - y / DRAG_SCROLL_ZONE);
  else if (y > vh - DRAG_SCROLL_ZONE) speed = DRAG_SCROLL_MAX * (1 - (vh - y) / DRAG_SCROLL_ZONE);
  if (speed) {
    window.scrollBy(0, speed);
    updateDragVisual(shopDrag.elsById.get(shopDrag.draggedId));
  }
  requestAnimationFrame(dragAutoScrollTick);
}

function wireDragHandle(handle, itemEl, scope) {
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* best-effort */ }
    const siblingEls = [...itemEl.parentElement.querySelectorAll(`.shop-item[data-scope="${scope}"]`)];
    const order = siblingEls.map(el => el.dataset.id);
    const draggedId = itemEl.dataset.id;
    const scrollY = window.scrollY;
    // Store rects as page-relative (viewport top + current scroll), so the
    // cached positions stay valid even after auto-scroll moves the page.
    const rects = new Map(siblingEls.map(el => {
      const r = el.getBoundingClientRect();
      return [el.dataset.id, { top: r.top + scrollY, height: r.height }];
    }));
    const elsById = new Map(siblingEls.map(el => [el.dataset.id, el]));
    const others = order.filter(id => id !== draggedId);
    shopDrag = {
      draggedId, scope, others, elsById, rects,
      originalBoundary: order.indexOf(draggedId),
      draggedHeight: rects.get(draggedId).height,
      startY: e.clientY + scrollY,
      lastClientY: e.clientY,
      targetOthersIdx: order.indexOf(draggedId)
    };
    itemEl.classList.add("dragging");
    requestAnimationFrame(dragAutoScrollTick);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!shopDrag || shopDrag.draggedId !== itemEl.dataset.id) return;
    shopDrag.lastClientY = e.clientY;
    updateDragVisual(itemEl);
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
// Lets a planned recipe carry its own "cooking for N" override, separate
// from the recipe's own serves, so scaling actually affects what the Meal
// Plan comparison view aggregates -- not just the read-only recipe view.
async function setMealPlanServesOverride(entryId, value) {
  const plan = await getMealPlan();
  const idx = plan.findIndex(e => (typeof e === "string" ? e === entryId : e.id === entryId));
  if (idx === -1) return;
  const existing = plan[idx];
  const upgraded = typeof existing === "string" ? { id: existing, recipeId: existing } : { ...existing };
  upgraded.servesOverride = value;
  plan[idx] = upgraded;
  await saveMealPlan(plan);
}
const MEAL_PLAN_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MEAL_PLAN_DAY_NAMES = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
// An optional day tag per entry, so a meal plan can double as a rough
// weekly schedule without forcing one -- entries with no day keep working
// exactly as before, just grouped under "Unscheduled".
async function setMealPlanEntryDay(entryId, day) {
  const plan = await getMealPlan();
  const idx = plan.findIndex(e => (typeof e === "string" ? e === entryId : e.id === entryId));
  if (idx === -1) return;
  const existing = plan[idx];
  const upgraded = typeof existing === "string" ? { id: existing, recipeId: existing } : { ...existing };
  upgraded.day = day || null;
  plan[idx] = upgraded;
  await saveMealPlan(plan);
}
async function getMealPlanEntries() {
  const plan = await getMealPlan();
  const recipes = await getAllRecipes();
  return plan.map(raw => {
    const entry = typeof raw === "string" ? { id: raw, recipeId: raw } : raw;
    if (entry.recipeId) {
      const r = recipes.find(x => x.id === entry.recipeId);
      if (!r) return null;
      const baseServes = r.serves || detectDefaultServes(r) || null;
      return {
        id: entry.id, recipeId: r.id, title: r.title, ingredients: r.ingredients || [], recipe: r,
        baseServes, servesOverride: entry.servesOverride || null, day: entry.day || null
      };
    }
    return { id: entry.id, recipeId: null, title: entry.title || "", ingredients: entry.ingredients || [], recipe: null, baseServes: null, servesOverride: null, day: entry.day || null };
  }).filter(Boolean);
}

// The root screen: a condensed look at what's planned (grouped by day once
// any entry has one, same as the full Meal Plan view) plus a quick-add box
// straight into the shopping list, for things you think of outside of
// meal planning that shouldn't require a trip through the Shopping tab.
async function renderHome() {
  const main = document.getElementById("main");
  const entries = await getMealPlanEntries();
  const anyDayAssigned = entries.some(en => en.day);
  const sorted = entries.slice().sort((a, b) => {
    if (anyDayAssigned) {
      const da = a.day ? MEAL_PLAN_DAYS.indexOf(a.day) : 99;
      const db = b.day ? MEAL_PLAN_DAYS.indexOf(b.day) : 99;
      if (da !== db) return da - db;
    }
    return a.title.localeCompare(b.title);
  });

  let planHtml;
  if (sorted.length === 0) {
    planHtml = `<div class="empty-msg">Nothing planned yet.</div>`;
  } else {
    const rows = sorted.map(en => {
      // A book icon + chevron for real recipes (tappable, opens the
      // recipe); a note icon for manual placeholder entries (not
      // tappable) -- so the two read differently at a glance instead of
      // looking like the same kind of row.
      const dayBadge = anyDayAssigned ? `<span class="home-plan-day">${en.day ? MEAL_PLAN_DAY_NAMES[en.day].slice(0, 3) : ""}</span>` : "";
      return `<div class="home-plan-row ${en.recipeId ? "" : "home-plan-row-manual"}" ${en.recipeId ? `data-recipe-id="${escapeAttr(en.recipeId)}"` : ""}>
        ${dayBadge}
        <span class="home-plan-icon">${en.recipeId ? ICON_BOOK : ICON_NOTE}</span>
        <span class="home-plan-title">${escapeHtml(en.title)}</span>
        ${en.recipeId ? `<span class="home-plan-chevron">›</span>` : ""}
      </div>`;
    }).join("");
    // Scrolls internally past a handful of entries instead of truncating --
    // the point of "at a glance" is to see everything planned so far, not
    // just a sample, so nothing gets hidden behind a "+N more".
    planHtml = `<div class="home-plan-list">${rows}</div>`;
  }

  const catalog = sortCatalogByUsage(await getItemCatalog());

  main.innerHTML = `
    <div class="settings-card">
      <h3>Meal Plan at a glance</h3>
      ${planHtml}
    </div>
    <div class="settings-card">
      <h3>Not sure what to cook?</h3>
      <p>Pick a few tags or ingredients and see what fits.</p>
      <div class="btn-row">
        <button class="primary-btn icon-label-btn" id="homeRustleUpBtn" style="margin-top:0;">${ICON_SHUFFLE} Rustle Up</button>
      </div>
    </div>
    <div class="settings-card">
      <h3>Quick add to Shopping List</h3>
      <p>For anything you think of outside of meal planning.</p>
      <div class="add-item-row">
        <input type="text" id="homeQuickAddInput" list="itemSuggestions" placeholder="Add an item...">
        <button class="primary-btn" id="homeQuickAddBtn" style="margin-top:0;">Add</button>
      </div>
      <datalist id="itemSuggestions">
        ${catalog.map(e => `<option value="${escapeAttr(e.name)}">`).join("")}
      </datalist>
    </div>
  `;

  document.getElementById("homeRustleUpBtn").addEventListener("click", () => renderRustleUp());
  main.querySelectorAll(".home-plan-row[data-recipe-id]").forEach(row => {
    row.addEventListener("click", () => renderDetail(row.dataset.recipeId));
  });

  const quickInput = document.getElementById("homeQuickAddInput");
  const quickAdd = async () => {
    const raw = quickInput.value.trim();
    if (!raw) return;
    const before = await getShopItems();
    const result = await addTextToShoppingList(raw);
    quickInput.value = "";
    quickInput.focus();
    refreshItemSuggestions();
    if (result.suggestion) {
      offerAliasMerge(result.catalogEntry, result.suggestion, null);
    } else {
      showToast(`Added "${result.catalogEntry.name}" to your shopping list.`, async () => { await saveShopItems(before); }, null);
    }
  };
  document.getElementById("homeQuickAddBtn").addEventListener("click", quickAdd);
  quickInput.addEventListener("keydown", (e) => { if (e.key === "Enter") quickAdd(); });
}

/* ---------- Rustle Up: pick tags/ingredients, get ranked suggestions ---------- */

let rustleSelectedTags = new Set();
let rustleIngredientTerms = [];

// Scores how well a single ingredient line matches a typed search term:
// exact word match beats substring match beats the shorthand-style fuzzy
// match already used for the item catalog (e.g. "chix" -> "chicken") --
// same idea as findFuzzyCatalogSuggestion, reused here so "rice" reliably
// surfaces "basmati rice" too, not just literal "rice".
function ingredientTermScore(term, ingredientName) {
  const s = term.toLowerCase().trim();
  const name = ingredientName.toLowerCase();
  if (!s || !name) return 0;
  const words = name.split(/\s+/);
  if (name === s || words.includes(s)) return 3;
  if (name.includes(s) || s.includes(name)) return 2;
  // Checked per-word (not against the whole joined name) -- otherwise an
  // ordinary word like "rice" can spuriously subsequence-match across
  // several unrelated words strung together (e.g. "ripe...colour...cherry").
  const ns = normalizeForFuzzy(s);
  if (ns.length >= 3) {
    for (const w of words) {
      const nw = normalizeForFuzzy(w);
      if (nw.length > ns.length && isSubsequence(ns, nw)) return 1;
    }
  }
  return 0;
}

// Every distinct ingredient name that actually appears in some recipe
// (post-parsing, so "2 onions" and "onions" collapse together) -- the
// candidate pool for ingredient suggestions, so nothing suggested is a
// guaranteed dead end.
function allIngredientNames(recipes) {
  const set = new Set();
  recipes.forEach(r => (r.ingredients || []).forEach(line => {
    const name = parseIngredient(line).name;
    if (name) set.add(name.toLowerCase());
  }));
  return [...set].sort();
}

// Suggestions for the single Rustle Up input: every tag and every known
// ingredient name, scored the same way results are ranked (exact >
// substring > fuzzy) so a suggestion is never a worse match than what's
// typed. Ties favor tags -- a whole tag is a more reliable filter than a
// fragment of ingredient text landing on the same score.
function computeRustleSuggestions(query, tags, ingredientNames, selectedTags, selectedIngredients) {
  const q = query.trim();
  if (!q) return [];
  const candidates = [];
  tags.forEach(t => { if (!selectedTags.has(t)) candidates.push({ type: "tag", value: t }); });
  ingredientNames.forEach(n => { if (!selectedIngredients.includes(n)) candidates.push({ type: "ingredient", value: n }); });
  return candidates
    .map(c => ({ ...c, score: ingredientTermScore(q, c.value) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score || (a.type !== b.type ? (a.type === "tag" ? -1 : 1) : a.value.localeCompare(b.value)))
    .slice(0, 8);
}

// Ranks every recipe against the selected tags/ingredients. Recipes that
// match nothing are dropped entirely; the rest are sorted by total score
// so a recipe hitting more/stronger filters surfaces first, without
// requiring an exact match on every single filter (picking 3 things
// shouldn't return zero results just because no recipe has all 3).
function rankRecipesForRustleUp(recipes, tags, ingredientTerms) {
  const results = [];
  recipes.forEach(r => {
    let score = 0;
    const matchedTags = [];
    const matchedIngredients = [];
    tags.forEach(t => {
      if ((r.tags || []).includes(t)) { score += 2; matchedTags.push(t); }
    });
    const parsedNames = (r.ingredients || []).map(line => parseIngredient(line).name || line);
    ingredientTerms.forEach(term => {
      let best = 0;
      parsedNames.forEach(name => { best = Math.max(best, ingredientTermScore(term, name)); });
      if (best > 0) { score += best; matchedIngredients.push(term); }
    });
    if (score > 0) results.push({ recipe: r, score, matchedTags, matchedIngredients });
  });
  results.sort((a, b) => b.score - a.score || a.recipe.title.localeCompare(b.recipe.title));
  return results;
}

async function renderRustleUp(opts) {
  opts = opts || {};
  if (!opts.skipHistory) pushNav("rustleUp", null);
  rustleSelectedTags = new Set();
  rustleIngredientTerms = [];
  const main = document.getElementById("main");
  const recipes = await getAllRecipes();
  const tags = allTags(recipes);
  const ingredientNames = allIngredientNames(recipes);

  main.innerHTML = `
    <button class="back-btn" id="rustleBackBtn">&larr; Back to Home</button>
    <div class="detail-card">
      <h2 class="icon-label-heading">${ICON_SHUFFLE} Rustle Up</h2>
      <p style="font-size:0.85rem;color:var(--muted);margin:0 0 12px;">Type a tag or ingredient you're in the mood for.</p>

      <div class="rustle-input-wrap">
        <input type="text" id="rustleSearchInput" placeholder="e.g. chicken, quick, rice..." autocomplete="off">
        <div class="rustle-suggestions hidden" id="rustleSuggestions"></div>
      </div>
      <div class="tag-row" id="rustleSelectedRow" style="margin-top:10px;"></div>

      <div class="section-label" style="margin-top:16px;">Suggestions</div>
      <div id="rustleResultsArea"></div>
    </div>
  `;

  document.getElementById("rustleBackBtn").addEventListener("click", () => history.back());

  let rustleRenderToken = 0;

  function renderSelectedRow() {
    const row = document.getElementById("rustleSelectedRow");
    const tagChips = [...rustleSelectedTags].map(t =>
      `<span class="tag rustle-selected-chip" data-type="tag" data-value="${escapeAttr(t)}">${escapeHtml(t)} &times;</span>`);
    const ingChips = rustleIngredientTerms.map(t =>
      `<span class="tag rustle-selected-chip rustle-ing-chip" data-type="ingredient" data-value="${escapeAttr(t)}">${escapeHtml(t)} &times;</span>`);
    row.innerHTML = [...tagChips, ...ingChips].join("");
    row.querySelectorAll(".rustle-selected-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        if (chip.dataset.type === "tag") rustleSelectedTags.delete(chip.dataset.value);
        else rustleIngredientTerms = rustleIngredientTerms.filter(t => t !== chip.dataset.value);
        renderSelectedRow();
        renderResults();
      });
    });
  }

  function addFilter(type, value) {
    if (type === "tag") rustleSelectedTags.add(value);
    else if (!rustleIngredientTerms.includes(value)) rustleIngredientTerms.push(value);
    renderSelectedRow();
    renderResults();
  }

  const searchInput = document.getElementById("rustleSearchInput");
  const suggestionsEl = document.getElementById("rustleSuggestions");
  let currentSuggestions = [];

  function hideSuggestions() {
    suggestionsEl.classList.add("hidden");
    suggestionsEl.innerHTML = "";
  }

  function renderSuggestionList() {
    currentSuggestions = computeRustleSuggestions(searchInput.value, tags, ingredientNames, rustleSelectedTags, rustleIngredientTerms);
    if (currentSuggestions.length === 0) { hideSuggestions(); return; }
    suggestionsEl.classList.remove("hidden");
    suggestionsEl.innerHTML = currentSuggestions.map((s, i) => `
      <button type="button" class="rustle-suggestion-item" data-index="${i}">
        <span class="rustle-suggestion-value">${escapeHtml(s.value)}</span>
        <span class="rustle-suggestion-type">${s.type}</span>
      </button>`).join("");
    suggestionsEl.querySelectorAll(".rustle-suggestion-item").forEach(btn => {
      btn.addEventListener("mousedown", (e) => e.preventDefault()); // survive the input's blur
      btn.addEventListener("click", () => {
        const s = currentSuggestions[Number(btn.dataset.index)];
        addFilter(s.type, s.value);
        searchInput.value = "";
        hideSuggestions();
        searchInput.focus();
      });
    });
  }

  searchInput.addEventListener("input", renderSuggestionList);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = searchInput.value.trim();
      if (!val) return;
      if (currentSuggestions.length > 0) {
        addFilter(currentSuggestions[0].type, currentSuggestions[0].value);
      } else {
        // No known match -- still usable as a free-text ingredient search
        // term, unless it happens to exactly name an existing tag (same
        // "ties favor tags" rule as the suggestion ordering).
        const lower = val.toLowerCase();
        const matchedTag = tags.find(t => t.toLowerCase() === lower);
        addFilter(matchedTag ? "tag" : "ingredient", matchedTag || lower);
      }
      searchInput.value = "";
      hideSuggestions();
    } else if (e.key === "Escape") {
      hideSuggestions();
    }
  });
  searchInput.addEventListener("blur", () => setTimeout(hideSuggestions, 150));

  async function renderResults() {
    // Guards against a slower, stale call (paused below on the getMealPlan
    // await) finishing after a newer one and clobbering it -- e.g. two
    // filter changes in quick succession -- by checking this render is
    // still the latest before writing to the DOM.
    const token = ++rustleRenderToken;
    const area = document.getElementById("rustleResultsArea");
    if (rustleSelectedTags.size === 0 && rustleIngredientTerms.length === 0) {
      area.innerHTML = `<div class="empty-msg">Pick a tag or add an ingredient above to get suggestions.</div>`;
      return;
    }
    const ranked = rankRecipesForRustleUp(recipes, [...rustleSelectedTags], rustleIngredientTerms);
    if (ranked.length === 0) {
      area.innerHTML = `<div class="empty-msg">No recipes match that yet -- try removing a filter.</div>`;
      return;
    }
    const planIds = new Set((await getMealPlan()).map(e => typeof e === "string" ? e : e.recipeId).filter(Boolean));
    if (token !== rustleRenderToken) return;
    area.innerHTML = ranked.map(({ recipe: r, matchedTags, matchedIngredients }) => {
      const inPlan = planIds.has(r.id);
      const why = [...matchedTags, ...matchedIngredients.map(t => `"${t}"`)];
      return `<div class="recipe-card" data-id="${escapeAttr(r.id)}">
        ${recipeCardMediaHtml(r)}
        <div class="recipe-card-body">
          <h3>${escapeHtml(r.title)}</h3>
          ${starsHtml(r.rating)}
          <div class="recipe-meta">${[r.servesLabel, r.time].filter(Boolean).join(" &middot; ")}</div>
          ${why.length ? `<div class="item-src">Matches: ${why.map(escapeHtml).join(", ")}</div>` : ""}
          <div class="tag-row">${(r.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
          <div class="card-actions">
            <button class="mini-btn ${inPlan ? "selected" : ""}" data-action="rustle-plan-toggle" data-id="${escapeAttr(r.id)}">${inPlan ? "✓ In meal plan" : "+ Add to meal plan"}</button>
          </div>
        </div>
      </div>`;
    }).join("");
    wireCardMediaToggles(area);

    area.querySelectorAll(".recipe-card").forEach(card => {
      card.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        renderDetail(card.dataset.id);
      });
    });
    area.querySelectorAll('[data-action="rustle-plan-toggle"]').forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const r = recipes.find(x => x.id === btn.dataset.id);
        if (!r) return;
        if (await isRecipeInPlan(r.id)) {
          const planBefore = await getMealPlan();
          await removeRecipeFromPlanByRecipeId(r.id);
          showToast(`Removed "${r.title}" from meal plan.`, async () => { await saveMealPlan(planBefore); }, renderResults);
        } else {
          await addRecipeToPlan(r.id);
          showToast(`Added "${r.title}" to meal plan.`, async () => { await removeRecipeFromPlanByRecipeId(r.id); }, renderResults);
        }
        renderResults();
      });
    });
  }

  renderSelectedRow();
  await renderResults();
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
      ${searchBoxHtml("searchInput", "Search recipes, tags, ingredients...", currentSearch)}
      <select id="tagSelect">
        <option value="">All tags</option>
        ${tags.map(t => `<option value="${escapeAttr(t)}" ${t === currentTagFilter ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
      </select>
      <select id="sortSelect">
        <option value="title" ${currentSort === "title" ? "selected" : ""}>Title (A-Z)</option>
        <option value="rating" ${currentSort === "rating" ? "selected" : ""}>Highest rated</option>
        <option value="timesCooked" ${currentSort === "timesCooked" ? "selected" : ""}>Most cooked</option>
        <option value="lastCooked" ${currentSort === "lastCooked" ? "selected" : ""}>Recently cooked</option>
      </select>
      ${recipes.some(r => r.photo) ? `<button class="icon-btn" id="toggleImagesBtn" title="${cardImagesExpanded ? "Collapse images" : "Expand images"}">${ICON_EYE}</button>` : ""}
      <button class="secondary-btn" id="openAddBtn" title="Add a recipe">+ Add recipe</button>
    </div>
    <div id="recipeListArea"></div>
  `;

  const rerenderList = () => renderRecipeList(recipes, planIds);
  const toggleImagesBtn = document.getElementById("toggleImagesBtn");
  if (toggleImagesBtn) toggleImagesBtn.addEventListener("click", () => {
    cardImagesExpanded = !cardImagesExpanded;
    toggleImagesBtn.title = cardImagesExpanded ? "Collapse images" : "Expand images";
    rerenderList();
  });

  document.getElementById("searchInput").addEventListener("input", (e) => {
    currentSearch = e.target.value;
    rerenderList();
  });
  wireSearchClear("searchInput", () => { currentSearch = ""; rerenderList(); });
  document.getElementById("tagSelect").addEventListener("change", (e) => {
    currentTagFilter = e.target.value;
    rerenderList();
  });
  document.getElementById("sortSelect").addEventListener("change", (e) => {
    currentSort = e.target.value;
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
  } else if (currentSort === "rating") {
    filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.title.localeCompare(b.title));
  } else if (currentSort === "timesCooked") {
    filtered.sort((a, b) => (b.timesCooked || 0) - (a.timesCooked || 0) || a.title.localeCompare(b.title));
  } else if (currentSort === "lastCooked") {
    filtered.sort((a, b) => (b.lastCooked || "").localeCompare(a.lastCooked || "") || a.title.localeCompare(b.title));
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
        ${recipeCardMediaHtml(r)}
        <div class="recipe-card-body">
          <h3>${escapeHtml(r.title)}</h3>
          ${starsHtml(r.rating)}
          <div class="recipe-meta">${metaParts}</div>
          ${sourceLineHtml(r)}
          ${cookedInfoHtml(r)}
          <div class="tag-row">${(r.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
          <div class="card-actions">
            <button class="mini-btn ${inPlan ? "selected" : ""}" data-action="plan-toggle" data-id="${escapeAttr(r.id)}">${inPlan ? "✓ In meal plan" : "+ Add to meal plan"}</button>
            <button class="icon-btn danger" data-action="delete" data-id="${escapeAttr(r.id)}" title="Delete recipe">${ICON_TRASH}</button>
          </div>
        </div>
      </div>`;
    });
  }

  listArea.innerHTML = html;
  wireCardMediaToggles(listArea);

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

// Renders a 1-5 star rating. Interactive mode (recipe detail page) wires
// clicks to setRecipeRating; clicking the currently-set star clears it.
// Non-interactive mode (list cards) is just a quiet visual summary.
function starsHtml(rating, opts) {
  opts = opts || {};
  const r = rating || 0;
  const cls = opts.interactive ? "stars interactive" : "stars";
  let html = `<span class="${cls}" ${opts.recipeId ? `data-recipe-id="${escapeAttr(opts.recipeId)}"` : ""}>`;
  for (let i = 1; i <= 5; i++) {
    html += `<span class="star ${i <= r ? "filled" : ""}" data-value="${i}">${i <= r ? "★" : "☆"}</span>`;
  }
  html += `</span>`;
  return html;
}
function wireStars(container) {
  container.querySelectorAll(".stars.interactive").forEach(starsEl => {
    starsEl.querySelectorAll(".star").forEach(starEl => {
      starEl.addEventListener("click", async (e) => {
        e.stopPropagation();
        const newRating = await setRecipeRating(starsEl.dataset.recipeId, Number(starEl.dataset.value));
        starsEl.outerHTML = starsHtml(newRating, { interactive: true, recipeId: starsEl.dataset.recipeId });
        wireStars(container);
      });
    });
  });
}
async function setRecipeRating(id, rating) {
  const recipes = await getAllRecipes();
  const r = recipes.find(x => x.id === id);
  if (!r) return 0;
  r.rating = r.rating === rating ? 0 : rating;
  await putRecipe(r);
  return r.rating;
}
async function markRecipeCooked(id) {
  const recipes = await getAllRecipes();
  const r = recipes.find(x => x.id === id);
  if (!r) return null;
  r.timesCooked = (r.timesCooked || 0) + 1;
  r.lastCooked = new Date().toISOString().slice(0, 10);
  await putRecipe(r);
  return r;
}
function cookedInfoHtml(r) {
  if (!r.timesCooked) return "";
  const times = `Cooked ${r.timesCooked}x`;
  return `<div class="recipe-meta">${times}${r.lastCooked ? ` &middot; last ${escapeHtml(r.lastCooked)}` : ""}</div>`;
}

// A quick rating nudge right after marking something cooked, since that's
// the moment you actually have an opinion -- rather than relying on
// remembering to go rate it later from the recipe detail page. Appended
// to <body> (not #main) so it survives whatever re-render triggered it.
function showRatingPrompt(recipeId, title) {
  const overlay = document.createElement("div");
  overlay.className = "rating-popup-overlay";
  overlay.innerHTML = `
    <div class="rating-popup">
      <h4>How was it?</h4>
      <p>${escapeHtml(title)}</p>
      <div class="stars" id="ratingPopupStars">${starsHtml(0)}</div>
      <button class="secondary-btn" id="ratingPopupSkipBtn">Skip</button>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll("#ratingPopupStars .star").forEach(el => {
    el.addEventListener("click", async () => {
      await setRecipeRating(recipeId, Number(el.dataset.value));
      close();
    });
  });
  document.getElementById("ratingPopupSkipBtn").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
}

function sourceLineHtml(r) {
  if (!r.source && !r.sourceUrl) return "";
  if (r.sourceUrl) {
    return `<div class="recipe-meta"><a href="${escapeAttr(r.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(r.source || r.sourceUrl)} ↗</a></div>`;
  }
  return `<div class="recipe-meta">${escapeHtml(r.source)}</div>`;
}

// A small fixed palette so a recipe without a photo still gets a distinct,
// recognizable color band on its card (same title always maps to the same
// color) instead of every card looking identical -- unless the recipe has
// an explicit cardColor set (from the edit form), which always wins.
const CARD_SWATCH_COLORS = ["#4a7c59", "#c1652f", "#b8863b", "#5b84a6", "#96608f", "#b5533f", "#3d8a86", "#6b6b63"];
function swatchColorForTitle(title) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  return CARD_SWATCH_COLORS[hash % CARD_SWATCH_COLORS.length];
}
function swatchColorForRecipe(recipe) {
  return recipe.cardColor || swatchColorForTitle(recipe.title || "");
}
// Preset dots + "Auto" + a native color picker for picking a recipe's
// card color by hand. Only affects the swatch band shown when there's no
// photo -- a photo always takes visual precedence over a color.
function cardColorSwatchesHtml(selected) {
  const isPreset = selected && CARD_SWATCH_COLORS.includes(selected);
  const isCustom = selected && !isPreset;
  let html = `<button type="button" class="card-color-swatch auto-swatch ${!selected ? "selected" : ""}" data-color="" title="Auto (from title)">Auto</button>`;
  html += CARD_SWATCH_COLORS.map(c =>
    `<button type="button" class="card-color-swatch ${selected === c ? "selected" : ""}" data-color="${c}" style="background:${c};" title="${c}"></button>`
  ).join("");
  html += `<input type="color" id="cardColorPicker" class="card-color-picker ${isCustom ? "selected" : ""}" value="${selected || swatchColorForTitle("")}" title="Custom color">`;
  return html;
}
// Photo cards render collapsed to a compact strip by default (see
// cardImagesExpanded), with a small per-card button to expand just that
// one -- toggled directly via DOM/class, no re-render needed. Wire up
// wireCardMediaToggles(container) after rendering any list of these.
let cardImagesExpanded = false;
function recipeCardMediaHtml(recipe) {
  if (recipe.photo) {
    const expanded = cardImagesExpanded;
    return `<div class="recipe-card-media has-photo ${expanded ? "expanded" : ""}">
      <img src="${escapeAttr(recipe.photo)}" alt="">
      <button type="button" class="media-expand-btn" data-action="toggle-card-image" title="${expanded ? "Collapse image" : "Expand image"}">${ICON_CHEVRON_DOWN}</button>
    </div>`;
  }
  return `<div class="recipe-card-media recipe-card-swatch" style="background:${swatchColorForRecipe(recipe)};"></div>`;
}
function wireCardMediaToggles(container) {
  container.querySelectorAll('[data-action="toggle-card-image"]').forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const media = btn.closest(".recipe-card-media");
      const nowExpanded = media.classList.toggle("expanded");
      btn.title = nowExpanded ? "Collapse image" : "Expand image";
    });
  });
}

async function renderDetail(id, opts) {
  opts = opts || {};
  const main = document.getElementById("main");
  const recipes = await getAllRecipes();
  const r = recipes.find(x => x.id === id);
  if (!r) { renderRecipes(); return; }
  if (!opts.skipHistory) pushNav("detail", "recipes", { id });
  const inPlan = await isRecipeInPlan(r.id);
  const baseServes = r.serves || detectDefaultServes(r);

  main.innerHTML = `
    <button class="back-btn" id="backBtn">&larr; Back to recipes</button>
    ${r.photo ? `<div class="detail-photo"><img src="${escapeAttr(r.photo)}" alt=""></div>` : ""}
    <div class="detail-card">
      <h2>${escapeHtml(r.title)}</h2>
      ${starsHtml(r.rating, { interactive: true, recipeId: r.id })}
      <div class="recipe-meta">${[r.servesLabel, r.time].filter(Boolean).map(escapeHtml).join(" &middot; ")}</div>
      ${r.source || r.sourceUrl ? `<div>${r.sourceUrl
        ? `<a class="source-link" href="${escapeAttr(r.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(r.source || "View source")} ↗</a>`
        : `<div class="recipe-meta">${escapeHtml(r.source)}</div>`}</div>` : ""}
      <div id="cookedInfoArea">${cookedInfoHtml(r)}</div>
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
        <button class="mini-btn icon-label-btn" id="markCookedBtn">${ICON_FLAME} Mark as cooked</button>
        <button class="icon-btn" id="printBtn" title="Print">${ICON_PRINT}</button>
        <button class="icon-btn" id="editBtn" title="Edit recipe">${ICON_EDIT}</button>
      </div>
    </div>
  `;
  wireStars(main);
  document.getElementById("backBtn").addEventListener("click", () => history.back());
  document.getElementById("markCookedBtn").addEventListener("click", async () => {
    const before = { timesCooked: r.timesCooked || 0, lastCooked: r.lastCooked || null };
    const updated = await markRecipeCooked(r.id);
    document.getElementById("cookedInfoArea").innerHTML = cookedInfoHtml(updated);
    showToast(`Marked "${r.title}" as cooked.`, async () => {
      const recipes = await getAllRecipes();
      const rec = recipes.find(x => x.id === r.id);
      if (rec) { rec.timesCooked = before.timesCooked; rec.lastCooked = before.lastCooked; await putRecipe(rec); }
    }, () => renderDetail(r.id, { skipHistory: true }));
  });
  document.getElementById("printBtn").addEventListener("click", () => window.print());
  document.getElementById("planToggleBtn").addEventListener("click", async () => {
    if (inPlan) {
      const planBefore = await getMealPlan();
      await removeRecipeFromPlanByRecipeId(r.id);
      showToast("Removed from meal plan.", async () => { await saveMealPlan(planBefore); }, () => renderDetail(r.id, { skipHistory: true }));
    } else {
      await addRecipeToPlan(r.id);
      showToast("Added to meal plan.", async () => { await removeRecipeFromPlanByRecipeId(r.id); }, () => renderDetail(r.id, { skipHistory: true }));
    }
    renderDetail(r.id, { skipHistory: true });
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

function renderManualMealForm(opts) {
  opts = opts || {};
  if (!opts.skipHistory) pushNav("manualMeal", "mealplan");
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
  document.getElementById("mealFormBackBtn").addEventListener("click", () => history.back());
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
    history.back();
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
    // A "cooking for N" override scales this recipe's ingredients before
    // they're merged in, so scaling actually reaches the shopping list.
    const factor = (en.baseServes && en.servesOverride) ? en.servesOverride / en.baseServes : 1;
    (en.ingredients || []).forEach(raw => {
      const parsed = parseIngredient(raw);
      if (factor !== 1 && parsed.amount != null) {
        parsed.amount *= factor;
        if (parsed.parenAmount != null) parsed.parenAmount *= factor;
      }
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
  await bumpItemUsage(catalogEntry.id);
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
  const anyDayAssigned = entries.some(en => en.day);
  entries.sort((a, b) => {
    if (anyDayAssigned) {
      const da = a.day ? MEAL_PLAN_DAYS.indexOf(a.day) : 99;
      const db = b.day ? MEAL_PLAN_DAYS.indexOf(b.day) : 99;
      if (da !== db) return da - db;
    }
    return a.title.localeCompare(b.title);
  });

  let html = `<div id="mealNotesCard"></div>
    <div class="btn-row" style="margin-bottom:14px;">
      <button class="secondary-btn" id="addManualMealBtn">+ Add manually</button>
    </div>`;

  if (entries.length === 0) {
    html += `<div class="empty-msg">Nothing planned yet -- add a recipe from Recipes, or add manually above.</div>`;
  } else {
    let lastDay;
    entries.forEach(en => {
      if (anyDayAssigned && en.day !== lastDay) {
        lastDay = en.day;
        html += `<div class="section-label">${en.day ? MEAL_PLAN_DAY_NAMES[en.day] : "Unscheduled"}</div>`;
      }
      const metaParts = en.recipe ? [en.recipe.servesLabel, en.recipe.time].filter(Boolean).join(" &middot; ") : "Manual entry";
      const dayOptions = `<option value="">No day</option>` + MEAL_PLAN_DAYS.map(d => `<option value="${d}" ${en.day === d ? "selected" : ""}>${MEAL_PLAN_DAY_NAMES[d]}</option>`).join("");
      html += `<div class="recipe-card" data-id="${escapeAttr(en.id)}" data-recipe-id="${escapeAttr(en.recipeId || "")}" style="${en.recipe ? "" : "cursor:default;"}">
        ${en.recipe ? recipeCardMediaHtml(en.recipe) : ""}
        <div class="recipe-card-body">
          <h3>${escapeHtml(en.title)}</h3>
          <div class="recipe-meta">${metaParts}</div>
          ${en.recipe ? `<div class="tag-row">${(en.recipe.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
          <div class="scale-row">
            <label for="day-${escapeAttr(en.id)}">Day</label>
            <select id="day-${escapeAttr(en.id)}" class="meal-day-select" data-entry-id="${escapeAttr(en.id)}">${dayOptions}</select>
          </div>
          ${en.baseServes ? `<div class="scale-row">
            <label for="serves-${escapeAttr(en.id)}">Cooking for</label>
            <input type="number" min="1" class="meal-serves-input" id="serves-${escapeAttr(en.id)}" data-entry-id="${escapeAttr(en.id)}" data-base-serves="${en.baseServes}" value="${en.servesOverride || en.baseServes}">
          </div>` : ""}
          <div class="card-actions">
            ${en.recipeId ? `<button class="mini-btn icon-label-btn" data-action="mark-cooked" data-id="${escapeAttr(en.id)}">${ICON_FLAME} Mark as cooked</button>` : ""}
            <button class="icon-btn danger" data-action="remove-entry" data-id="${escapeAttr(en.id)}" title="Remove from plan">${ICON_TRASH}</button>
          </div>
        </div>
      </div>`;
    });
    html += `<div class="btn-row" style="margin:6px 0 20px;"><button class="secondary-btn" id="goShopBtn">Go to Shopping List</button></div>`;
  }

  html += `<div id="mealIngredientsArea"></div>`;

  main.innerHTML = html;
  wireCardMediaToggles(main);
  await renderMealPlanNotesCard();
  await renderMealPlanIngredients(entries);
  main.querySelectorAll(".meal-day-select").forEach(select => {
    select.addEventListener("click", (e) => e.stopPropagation());
    select.addEventListener("change", async () => {
      await setMealPlanEntryDay(select.dataset.entryId, select.value);
      renderMealPlan();
    });
  });
  main.querySelectorAll(".meal-serves-input").forEach(input => {
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    input.addEventListener("blur", async () => {
      const entryId = input.dataset.entryId;
      const baseServes = Number(input.dataset.baseServes);
      const val = Number(input.value) || baseServes;
      await setMealPlanServesOverride(entryId, val === baseServes ? null : val);
      renderMealPlanIngredients(await getMealPlanEntries());
    });
  });

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
  main.querySelectorAll('[data-action="mark-cooked"]').forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const en = entries.find(x => x.id === btn.dataset.id);
      if (!en || !en.recipeId) return;
      const before = { timesCooked: en.recipe.timesCooked || 0, lastCooked: en.recipe.lastCooked || null };
      await markRecipeCooked(en.recipeId);
      showToast(`Marked "${en.title}" as cooked.`, async () => {
        const recipes = await getAllRecipes();
        const rec = recipes.find(x => x.id === en.recipeId);
        if (rec) { rec.timesCooked = before.timesCooked; rec.lastCooked = before.lastCooked; await putRecipe(rec); }
      }, renderMealPlan);
      if (!en.recipe.rating) showRatingPrompt(en.recipeId, en.title);
      renderMealPlan();
    });
  });
  document.getElementById("addManualMealBtn").addEventListener("click", () => renderManualMealForm());
  const goShopBtn = document.getElementById("goShopBtn");
  if (goShopBtn) goShopBtn.addEventListener("click", () => goToTab("shop"));
}

/* ---------- Shopping list ---------- */

async function refreshItemSuggestions() {
  const datalist = document.getElementById("itemSuggestions");
  if (!datalist) return;
  const catalog = await sortCatalogByUsage(await getItemCatalog());
  datalist.innerHTML = catalog.map(e => `<option value="${escapeAttr(e.name)}">`).join("");
}

// Sorts by how often (then how recently) an item has been added, so your
// regulars surface first in autocomplete instead of alphabetically.
function sortCatalogByUsage(catalog) {
  return catalog.slice().sort((a, b) => {
    const countDiff = (b.useCount || 0) - (a.useCount || 0);
    if (countDiff !== 0) return countDiff;
    const recentDiff = (b.lastUsed || 0) - (a.lastUsed || 0);
    if (recentDiff !== 0) return recentDiff;
    return a.name.localeCompare(b.name);
  });
}

async function bumpItemUsage(catalogId) {
  const catalog = await getItemCatalog();
  const entry = catalog.find(e => e.id === catalogId);
  if (!entry) return;
  entry.useCount = (entry.useCount || 0) + 1;
  entry.lastUsed = Date.now();
  await saveItemCatalog(catalog);
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
  await bumpItemUsage(catalogEntry.id);
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

function renderPasteList(opts) {
  opts = opts || {};
  if (!opts.skipHistory) pushNav("pasteList", "shop");
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
  document.getElementById("pasteBackBtn").addEventListener("click", () => history.back());
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
    history.back();
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
  await archiveShoppingList(before);
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
    await bumpItemUsage(entry.id);
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
  reader.onerror = () => {
    showToast("Couldn't read that file -- try again.", null, null);
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
  const catalog = sortCatalogByUsage(await getItemCatalog());
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
      ${searchBoxHtml("shopSearchInput", "Search your list...", currentShopSearch)}
    </div>
    <input type="file" id="shopFileInput" accept="application/json" style="display:none;">
    <div id="shopListArea"></div>
  `;

  await renderShopNotesCard();
  document.getElementById("addItemBtn").addEventListener("click", addManualItem);
  document.getElementById("newItemInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addManualItem();
  });
  document.getElementById("shopFileInput").addEventListener("change", handleShopListFileImport);
  document.getElementById("shopSearchInput").addEventListener("input", (e) => {
    currentShopSearch = e.target.value;
    renderShopListArea();
  });
  wireSearchClear("shopSearchInput", () => { currentShopSearch = ""; renderShopListArea(); });

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

  // Toolbar sits at the top, above the list, always -- select mode swaps in
  // its own controls; everything used less than "every visit" (paste, new
  // list, item manager, order/export/import, clear) is tucked behind the
  // "More" menu instead of lining up a wall of buttons under the list.
  let html = `<div class="shop-toolbar">`;
  if (shopSelectMode) {
    const n = selectedShopIds.size;
    html += `<button class="secondary-btn" id="moveUpBtn" ${n === 0 ? "disabled" : ""}>Move up${n ? ` (${n})` : ""}</button>`;
    html += `<button class="secondary-btn" id="moveDownBtn" ${n === 0 ? "disabled" : ""}>Move down${n ? ` (${n})` : ""}</button>`;
    html += `<button class="secondary-btn" id="doneSelectBtn">Done</button>`;
  } else {
    html += `<button class="secondary-btn" id="selectModeBtn">Select</button>`;
    if (checked.length > 0) {
      html += `<button class="secondary-btn" id="toggleCheckedBtn">${showCheckedItems ? "Hide" : "Show"} checked (${checked.length})</button>`;
    }
    html += `<div class="menu-wrap">
      <button class="icon-btn" id="shopMenuBtn" title="More actions">${ICON_MORE}</button>
      <div class="menu-popup" id="shopMenuPopup" style="display:${shopMenuOpen ? "flex" : "none"};">
        <button class="menu-item" id="pasteListBtn">${ICON_CLIPBOARD} Paste a list</button>
        <button class="menu-item" id="newListBtn">New list</button>
        <div class="menu-divider"></div>
        <button class="menu-item" id="updateOrderBtn">Update order</button>
        <button class="menu-item" id="copyTextBtn">Copy as text</button>
        <button class="menu-item" id="exportShopBtn">${ICON_DOWNLOAD} Export list</button>
        <button class="menu-item" id="importShopBtn">${ICON_UPLOAD} Import list</button>
        <div class="menu-divider"></div>
        <button class="menu-item danger" id="clearCheckedBtn">Clear checked</button>
        <button class="menu-item danger" id="clearAllBtn">Clear all</button>
      </div>
    </div>`;
  }
  html += `</div>`;

  if (items.length === 0) {
    html += `<div class="empty-msg">Empty. Add items above, or compare against your Meal Plan.</div>`;
  } else if (term && nonStaple.length === 0 && staples.length === 0 && checked.length === 0) {
    html += `<div class="empty-msg">No items match "${escapeHtml(currentShopSearch)}".</div>`;
  } else {
    if (nonStaple.length === 0 && staples.length === 0) {
      html += `<div class="empty-msg">Everything's checked off!${checked.length ? " Tap “Show checked” above." : ""}</div>`;
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

    wireSwipeToDelete(el, id);
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

  const shopMenuBtn = document.getElementById("shopMenuBtn");
  const shopMenuPopup = document.getElementById("shopMenuPopup");
  if (shopMenuBtn) {
    // Toggles the popup directly (no re-render) so opening the menu doesn't
    // destroy/recreate the button itself -- a full re-render here would
    // detach the just-clicked button and fire a spurious blur, closing the
    // menu the instant it opened.
    shopMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      shopMenuOpen = !shopMenuOpen;
      if (shopMenuPopup) shopMenuPopup.style.display = shopMenuOpen ? "flex" : "none";
    });
  }
  const pasteListBtn = document.getElementById("pasteListBtn");
  if (pasteListBtn) pasteListBtn.addEventListener("click", () => { shopMenuOpen = false; renderPasteList(); });
  const newListBtn = document.getElementById("newListBtn");
  if (newListBtn) newListBtn.addEventListener("click", () => { shopMenuOpen = false; startNewShoppingList(); });
  const exportShopBtn = document.getElementById("exportShopBtn");
  if (exportShopBtn) exportShopBtn.addEventListener("click", () => { shopMenuOpen = false; exportShopList(); });
  const importShopBtn = document.getElementById("importShopBtn");
  if (importShopBtn) importShopBtn.addEventListener("click", () => { shopMenuOpen = false; document.getElementById("shopFileInput").click(); });

  const updateOrderBtn = document.getElementById("updateOrderBtn");
  if (updateOrderBtn) updateOrderBtn.addEventListener("click", async () => {
    shopMenuOpen = false;
    await updateShopOrder();
    showToast("Order saved -- new items will slot in around this.", null, null);
  });
  const copyTextBtn = document.getElementById("copyTextBtn");
  if (copyTextBtn) copyTextBtn.addEventListener("click", () => { shopMenuOpen = false; copyShoppingListText(); });
  const toggleCheckedBtn = document.getElementById("toggleCheckedBtn");
  if (toggleCheckedBtn) toggleCheckedBtn.addEventListener("click", () => {
    showCheckedItems = !showCheckedItems;
    renderShopListArea();
  });
  const clearCheckedBtn = document.getElementById("clearCheckedBtn");
  if (clearCheckedBtn) clearCheckedBtn.addEventListener("click", async () => {
    shopMenuOpen = false;
    const all = await getShopItems();
    const removed = all.filter(i => i.checked);
    if (removed.length === 0) { renderShopListArea(); return; }
    await saveShopItems(all.filter(i => !i.checked));
    showToast(`Cleared ${removed.length} checked item(s).`, async () => {
      const cur = await getShopItems();
      await saveShopItems(cur.concat(removed));
    }, renderShopListArea);
    renderShopListArea();
  });
  const clearAllBtn = document.getElementById("clearAllBtn");
  if (clearAllBtn) clearAllBtn.addEventListener("click", async () => {
    shopMenuOpen = false;
    const all = await getShopItems();
    if (all.length === 0) { renderShopListArea(); return; }
    await archiveShoppingList(all);
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
  const qtyRow = !shopSelectMode ? `<span class="qty-row">
      <button class="qty-btn" data-action="qty-dec" title="Decrease">−</button>
      <input type="number" class="qty-input" value="${formatNum(shopItemQty(item))}" step="any">
      <span class="qty-unit">${escapeHtml(item.unit || "")}</span>
      <button class="qty-btn" data-action="qty-inc" title="Increase">+</button>
    </span>` : "";
  return `<div class="shop-item ${item.checked ? "checked" : ""} ${selected ? "selected" : ""}" data-id="${escapeAttr(item.id)}" data-scope="${escapeAttr(opts.scope || "")}" data-catalog-id="${escapeAttr(item.catalogId || "")}">
    ${!shopSelectMode ? `<div class="swipe-bg-inner">Delete</div>` : ""}
    <div class="swipe-content">
      ${leadBox}
      ${opts.scope && !shopSelectMode ? `<div class="drag-handle" data-action="drag-handle" title="Drag to reorder">⠿</div>` : ""}
      <div class="item-body">
        <div class="item-line">
          <span class="item-text">${escapeHtml(item.name)}</span>
          ${qtyRow}
        </div>
        ${mealsLabel ? `<div class="item-src">${escapeHtml(mealsLabel)}</div>` : ""}
      </div>
      <div class="item-controls">
        ${item.staple && !opts.hideBadge ? `<span class="icon-btn on" style="pointer-events:none;">Staple</span>` : ""}
      </div>
    </div>
  </div>`;
}

async function deleteShopItem(id) {
  const all = await getShopItems();
  const item = all.find(i => i.id === id);
  if (!item) return;
  await saveShopItems(all.filter(i => i.id !== id));
  showToast(`Removed "${item.name}".`, async () => {
    const cur = await getShopItems();
    cur.push(item);
    await saveShopItems(cur);
  }, renderShopListArea);
  renderShopListArea();
}

function startEditItem(el, id) {
  const textEl = el.querySelector(".item-text");
  const current = textEl.textContent;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "item-text-input";
  input.value = current;
  textEl.replaceWith(input);
  // The delete "x" only shows up while editing (otherwise it's swipe-to-
  // delete or nothing) -- rather than a permanently visible button
  // competing with the item name for attention.
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn";
  deleteBtn.title = "Remove item";
  deleteBtn.textContent = "✕";
  input.insertAdjacentElement("afterend", deleteBtn);
  input.focus();
  input.setSelectionRange(current.length, current.length);
  let deleting = false;
  const save = async () => {
    if (deleting) return;
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
  deleteBtn.addEventListener("mousedown", (e) => e.preventDefault()); // don't fire input's blur-save first
  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    deleting = true;
    await deleteShopItem(id);
  });
}

// Swipe-left-to-delete: a transform-only preview on the inner
// .swipe-content (never the outer .shop-item, which the vertical
// drag-to-reorder also transforms) so the two gestures never fight over
// the same style.transform. touch-action:pan-y on .swipe-content lets
// vertical list scrolling stay native; only once a gesture is decided to
// be horizontal do we take over and prevent the click that would
// otherwise follow.
const LONG_PRESS_MS = 500;

function wireSwipeToDelete(itemEl, id) {
  const content = itemEl.querySelector(".swipe-content");
  if (!content) return;
  let startX = 0, startY = 0, dx = 0, tracking = false, decided = false, horizontal = false;
  let longPressTimer = null, longPressFired = false;
  const SWIPE_THRESHOLD = -60;
  const MAX_SWIPE = -96;

  const cancelLongPress = () => { clearTimeout(longPressTimer); longPressTimer = null; };

  content.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".box, .drag-handle, .qty-row, input, button")) return;
    startX = e.clientX; startY = e.clientY; dx = 0; tracking = true; decided = false; horizontal = false;
    longPressFired = false;
    const catalogId = itemEl.dataset.catalogId;
    if (catalogId) {
      longPressTimer = setTimeout(() => {
        longPressFired = true;
        tracking = false;
        showItemDetailsPopover(catalogId);
      }, LONG_PRESS_MS);
    }
  });
  content.addEventListener("pointermove", (e) => {
    if (!tracking) return;
    const mdx = e.clientX - startX, mdy = e.clientY - startY;
    if (!decided) {
      if (Math.abs(mdx) < 8 && Math.abs(mdy) < 8) return;
      decided = true;
      cancelLongPress(); // real movement means this is a swipe/scroll, not a long-press
      horizontal = Math.abs(mdx) > Math.abs(mdy);
      if (horizontal) { try { content.setPointerCapture(e.pointerId); } catch (err) { /* best-effort */ } }
    }
    if (!horizontal) return;
    dx = Math.max(mdx, MAX_SWIPE);
    if (dx > 0) dx = 0;
    content.style.transform = `translateX(${dx}px)`;
    itemEl.classList.toggle("swipe-armed", dx <= SWIPE_THRESHOLD);
  });
  const end = (e) => {
    cancelLongPress();
    if (!tracking) return;
    tracking = false;
    if (horizontal || longPressFired) {
      const cancelClick = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      content.addEventListener("click", cancelClick, { capture: true, once: true });
      setTimeout(() => content.removeEventListener("click", cancelClick, { capture: true }), 0);
    }
    if (horizontal && dx <= SWIPE_THRESHOLD) {
      content.style.transition = "transform 0.15s ease";
      content.style.transform = "translateX(-100%)";
      setTimeout(() => deleteShopItem(id), 140);
    } else if (horizontal) {
      content.style.transition = "transform 0.15s ease";
      content.style.transform = "";
      itemEl.classList.remove("swipe-armed");
      setTimeout(() => { content.style.transition = ""; }, 200);
    }
  };
  content.addEventListener("pointerup", end);
  content.addEventListener("pointercancel", end);
}

/* ---------- Item catalog (its own screen, reached from Shopping List) ---------- */

const UNIT_PRESETS = ["g", "kg", "ml", "l", "bunch", "punnet", "block", "dozen", "pack", "slice"];
let currentItemSearch = "";
let currentItemTagFilter = "";

// Free-text tags (dairy, frozen, vegan, pantry, gluten-free...) let an item
// belong to more than one category at once, which a single dropdown
// category never could. "Staple" stays its own dedicated flag -- it drives
// the shopping list's separate Staples section and its own saved order --
// but is folded into this same filter dropdown as a convenience so it
// reads as one more tag rather than a second, inconsistent system.
function allItemTags(catalog) {
  const set = new Set();
  catalog.forEach(e => (e.tags || []).forEach(t => { if (t !== "staple") set.add(t); }));
  return [...set].sort();
}
function matchesItemTagFilter(entry) {
  if (!currentItemTagFilter) return true;
  if (currentItemTagFilter === "__staple") return !!entry.staple;
  return (entry.tags || []).includes(currentItemTagFilter);
}

// "Staple" is a real tag (entry.tags includes "staple"), not a separate
// checkbox -- entry.staple is kept in sync as a derived boolean purely
// because the shopping list's Staples section / saved ordering already
// depend on that field, and it wasn't worth rearchitecting that working,
// well-tested split just to change how staple-ness is *edited*.
const STAPLE_TAG = "staple";
function syncStapleFromTags(entry) {
  entry.staple = (entry.tags || []).includes(STAPLE_TAG);
}

function itemTagChipsHtml(entry) {
  const custom = (entry.tags || []).filter(t => t !== STAPLE_TAG);
  const isStaple = (entry.tags || []).includes(STAPLE_TAG);
  let html = `<div class="tag-row item-tag-row">`;
  html += `<span class="tag chip-toggle staple-chip ${isStaple ? "chip-on" : ""}" data-action="toggle-staple" title="Staples get their own section on the shopping list">Staple</span>`;
  html += `<span class="tag chip-toggle default-chip ${entry.defaultItem ? "chip-on" : ""}" data-action="toggle-default" title="Automatically add this to every new shopping list">Auto-add</span>`;
  custom.forEach(t => {
    html += `<span class="tag item-tag-chip" data-tag="${escapeAttr(t)}" title="Tap to remove">${escapeHtml(t)} &times;</span>`;
  });
  html += `<button type="button" class="tag item-tag-add" data-action="add-tag">+ tag</button>`;
  html += `</div>`;
  return html;
}

// Shared between the inline shelf row's disclosure panel and the shopping
// list's long-press popover, so both edit the exact same fields the exact
// same way instead of maintaining two forms.
function itemDetailsFieldsHtml(entry) {
  return `
    <div class="form-row-3">
      <div class="form-field"><label>Unit</label><input type="text" class="ing-unit" list="unitPresets" value="${escapeAttr(entry.unit)}" placeholder="count"></div>
      <div class="form-field"><label>Step</label><input type="number" class="ing-step" value="${entry.step}"></div>
      <div class="form-field"><label>Default qty</label><input type="number" class="ing-defaultqty" value="${entry.defaultQty}"></div>
    </div>
    <div class="form-field"><label>Aliases (comma separated)</label><input type="text" class="ing-aliases" value="${escapeAttr((entry.aliases || []).join(", "))}"></div>
    <div class="form-field">
      <label>Never match (comma separated)</label>
      <input type="text" class="ing-anti-aliases" placeholder="e.g. sourdough, sour" value="${escapeAttr((entry.antiAliases || []).join(", "))}">
      <p class="field-hint">Text containing any of these skips this item -- e.g. "sourdough" on "Bread" so it doesn't get lumped in with plain bread.</p>
    </div>
    <div class="form-field"><label>Notes</label><textarea class="ing-notes" placeholder="Alternatives, brand preferences, anything worth remembering...">${escapeHtml(entry.notes || "")}</textarea></div>
  `;
}

function renderItemCatalogRow(entry) {
  return `
    <div class="shelf-item" data-id="${escapeAttr(entry.id)}" style="border-left-color:${swatchColorForTitle(entry.name)};">
      <div class="shelf-item-main">
        <div class="drag-handle" data-action="drag-handle" title="Drag to reorder">⠿</div>
        <div class="shelf-item-body">
          <input type="text" class="ing-name shelf-name-input" value="${escapeAttr(entry.name)}">
          ${itemTagChipsHtml(entry)}
          <div class="shelf-item-details hidden" data-details>
            ${itemDetailsFieldsHtml(entry)}
          </div>
        </div>
        <button type="button" class="icon-btn shelf-details-btn" data-action="toggle-details" title="More options">⋯</button>
        <button class="icon-btn" data-action="delete-ing" title="Delete">✕</button>
      </div>
    </div>`;
}

function renderNewItemRow() {
  return `
    <div class="shelf-item shelf-new-item">
      <div class="shelf-item-main">
        <input type="text" id="newIngName" class="shelf-name-input" placeholder="Add an item to the shelf...">
        <button class="secondary-btn" id="addIngBtn">Add</button>
      </div>
    </div>
  `;
}

function startAddItemTag(row, id, onDone) {
  const addBtn = row.querySelector('[data-action="add-tag"]');
  if (!addBtn) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "item-tag-input";
  input.placeholder = "tag";
  addBtn.replaceWith(input);
  input.focus();
  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const val = input.value.trim().toLowerCase();
    if (val) {
      const catalog = await getItemCatalog();
      const entry = catalog.find(e => e.id === id);
      if (entry) {
        entry.tags = entry.tags || [];
        if (!entry.tags.includes(val)) entry.tags.push(val);
        syncStapleFromTags(entry);
        await saveItemCatalog(catalog);
      }
    }
    (onDone || renderItemCatalogRows)();
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") { input.value = ""; input.blur(); }
  });
}

// Quick-edit popover for a shelf entry, opened by long-pressing a shopping
// list item -- lets you fix up unit/aliases/notes/etc. right from the
// shopping list instead of having to leave for the Shelf tab. Re-renders
// its own body in place after any change rather than closing, so several
// small edits (add a tag, tweak a note) can happen in one long-press.
async function showItemDetailsPopover(catalogId) {
  const overlay = document.createElement("div");
  overlay.className = "rating-popup-overlay";
  document.body.appendChild(overlay);
  const close = async () => {
    overlay.remove();
    // Shopping list rows carry their own name/staple snapshot from when
    // they were added, so a rename/staple-toggle made here wouldn't
    // otherwise show up on the list until the item was re-added.
    const [items, catalog] = await Promise.all([getShopItems(), getItemCatalog()]);
    const entry = catalog.find(e => e.id === catalogId);
    if (entry) {
      let changed = false;
      items.forEach(i => {
        if (i.catalogId !== catalogId) return;
        if (i.name !== entry.name) { i.name = entry.name; changed = true; }
        if (i.staple !== !!entry.staple) { i.staple = !!entry.staple; changed = true; }
      });
      if (changed) await saveShopItems(items);
    }
    if (document.getElementById("shopListArea")) renderShopListArea();
  };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const refresh = async () => {
    const catalog = await getItemCatalog();
    const entry = catalog.find(e => e.id === catalogId);
    if (!entry) { close(); return; }
    overlay.innerHTML = `
      <div class="rating-popup item-popover">
        <div class="item-popover-header">
          <input type="text" class="ing-name" value="${escapeAttr(entry.name)}">
          <button class="icon-btn" id="itemPopoverCloseBtn" title="Close">✕</button>
        </div>
        ${itemTagChipsHtml(entry)}
        <div class="shelf-item-details">${itemDetailsFieldsHtml(entry)}</div>
      </div>`;
    const root = overlay.querySelector(".item-popover");
    document.getElementById("itemPopoverCloseBtn").addEventListener("click", close);
    const save = () => saveItemFieldsFromRoot(root, catalogId);
    root.querySelectorAll(".ing-name, .ing-unit, .ing-step, .ing-defaultqty, .ing-aliases, .ing-anti-aliases, .ing-notes").forEach(el => {
      el.addEventListener("blur", save);
    });
    root.querySelector('[data-action="toggle-staple"]').addEventListener("click", async () => {
      const cat = await getItemCatalog();
      const e2 = cat.find(x => x.id === catalogId);
      if (!e2) return;
      e2.tags = e2.tags || [];
      if (e2.tags.includes(STAPLE_TAG)) e2.tags = e2.tags.filter(t => t !== STAPLE_TAG);
      else e2.tags.push(STAPLE_TAG);
      syncStapleFromTags(e2);
      await saveItemCatalog(cat);
      refresh();
    });
    root.querySelector('[data-action="toggle-default"]').addEventListener("click", async () => {
      const cat = await getItemCatalog();
      const e2 = cat.find(x => x.id === catalogId);
      if (!e2) return;
      e2.defaultItem = !e2.defaultItem;
      await saveItemCatalog(cat);
      refresh();
    });
    root.querySelectorAll(".item-tag-chip").forEach(chip => {
      chip.addEventListener("click", async () => {
        const cat = await getItemCatalog();
        const e2 = cat.find(x => x.id === catalogId);
        if (!e2) return;
        e2.tags = (e2.tags || []).filter(t => t !== chip.dataset.tag);
        syncStapleFromTags(e2);
        await saveItemCatalog(cat);
        refresh();
      });
    });
    const addTagBtn = root.querySelector('[data-action="add-tag"]');
    if (addTagBtn) addTagBtn.addEventListener("click", () => startAddItemTag(root, catalogId, refresh));
  };
  await refresh();
}

// Reads every field an item details form exposes (whichever root it's
// mounted in -- the inline shelf row disclosure, or the shopping list's
// long-press popover) and saves them back to the catalog entry, so both
// surfaces edit the same shape the same way without duplicating this logic.
async function saveItemFieldsFromRoot(root, id) {
  const catalog = await getItemCatalog();
  const entry = catalog.find(e => e.id === id);
  if (!entry) return null;
  const nameInput = root.querySelector(".ing-name");
  if (nameInput) entry.name = nameInput.value.trim() || entry.name;
  entry.unit = root.querySelector(".ing-unit").value.trim();
  entry.step = Number(root.querySelector(".ing-step").value) || 1;
  entry.defaultQty = Number(root.querySelector(".ing-defaultqty").value) || 1;
  entry.aliases = root.querySelector(".ing-aliases").value.split(",").map(s => s.trim()).filter(Boolean);
  entry.antiAliases = root.querySelector(".ing-anti-aliases").value.split(",").map(s => s.trim()).filter(Boolean);
  entry.notes = root.querySelector(".ing-notes").value.trim();
  await saveItemCatalog(catalog);
  return entry;
}

function wireItemCatalogEvents() {
  const main = document.getElementById("main");
  main.querySelectorAll(".shelf-item[data-id]").forEach(row => {
    const id = row.dataset.id;
    const save = () => saveItemFieldsFromRoot(row, id);
    row.querySelector(".ing-name").addEventListener("blur", save);
    row.querySelector(".ing-step").addEventListener("blur", save);
    row.querySelector(".ing-defaultqty").addEventListener("blur", save);
    row.querySelector(".ing-aliases").addEventListener("blur", save);
    row.querySelector(".ing-anti-aliases").addEventListener("blur", save);
    row.querySelector(".ing-notes").addEventListener("blur", save);
    row.querySelector(".ing-unit").addEventListener("blur", save);

    row.querySelector('[data-action="toggle-staple"]').addEventListener("click", async () => {
      const catalog = await getItemCatalog();
      const entry = catalog.find(e => e.id === id);
      if (!entry) return;
      entry.tags = entry.tags || [];
      if (entry.tags.includes(STAPLE_TAG)) entry.tags = entry.tags.filter(t => t !== STAPLE_TAG);
      else entry.tags.push(STAPLE_TAG);
      syncStapleFromTags(entry);
      await saveItemCatalog(catalog);
      renderItemCatalogRows();
    });
    row.querySelector('[data-action="toggle-default"]').addEventListener("click", async () => {
      const catalog = await getItemCatalog();
      const entry = catalog.find(e => e.id === id);
      if (!entry) return;
      entry.defaultItem = !entry.defaultItem;
      await saveItemCatalog(catalog);
      renderItemCatalogRows();
    });
    row.querySelectorAll(".item-tag-chip").forEach(chip => {
      chip.addEventListener("click", async () => {
        const catalog = await getItemCatalog();
        const entry = catalog.find(e => e.id === id);
        if (!entry) return;
        entry.tags = (entry.tags || []).filter(t => t !== chip.dataset.tag);
        syncStapleFromTags(entry);
        await saveItemCatalog(catalog);
        renderItemCatalogRows();
      });
    });
    const addTagBtn = row.querySelector('[data-action="add-tag"]');
    if (addTagBtn) addTagBtn.addEventListener("click", () => startAddItemTag(row, id));

    row.querySelector('[data-action="toggle-details"]').addEventListener("click", () => {
      row.querySelector("[data-details]").classList.toggle("hidden");
    });

    row.querySelector('[data-action="delete-ing"]').addEventListener("click", async () => {
      const catalog = await getItemCatalog();
      const entry = catalog.find(e => e.id === id);
      await saveItemCatalog(catalog.filter(e => e.id !== id));
      showToast(`Deleted "${entry.name}".`, async () => {
        const cur = await getItemCatalog();
        cur.push(entry);
        await saveItemCatalog(cur);
      }, renderItemCatalogRows);
      renderItemCatalogRows();
    });

    const handle = row.querySelector('[data-action="drag-handle"]');
    if (handle) wireItemDragHandle(handle, row);
  });
  const addIngBtn = document.getElementById("addIngBtn");
  if (addIngBtn) addIngBtn.addEventListener("click", async () => {
    const nameInput = document.getElementById("newIngName");
    const name = nameInput.value.trim();
    if (!name) return;
    const catalog = await getItemCatalog();
    const suggestion = findFuzzyCatalogSuggestion(name, catalog);
    const newEntry = {
      id: slugify(name) + "-" + Date.now().toString(36).slice(-4), name,
      unit: "", step: 1, defaultQty: 1, staple: false, defaultItem: false,
      aliases: [name.toLowerCase()], antiAliases: [], notes: "", tags: []
    };
    catalog.push(newEntry);
    await saveItemCatalog(catalog);
    renderItemCatalogRows();
    if (suggestion) offerAliasMerge(newEntry, suggestion, renderItemCatalogRows);
  });
  const newIngNameInput = document.getElementById("newIngName");
  if (newIngNameInput) newIngNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addIngBtn.click(); }
  });
}

// Transform-only drag preview, same approach as the shopping list's
// drag-to-reorder (see wireDragHandle): the dragged row's DOM position
// never changes mid-gesture, only its CSS transform, and the real order
// is written once on release -- this is what makes it not get "stuck"
// under an active pointer capture.
let itemDrag = null;

function updateItemDragVisual(itemEl) {
  if (!itemDrag) return;
  const pageY = itemDrag.lastClientY + window.scrollY;
  const delta = pageY - itemDrag.startY;
  itemEl.style.transform = `translateY(${delta}px)`;

  const draggedRect = itemDrag.rects.get(itemDrag.draggedId);
  const draggedCenter = draggedRect.top + draggedRect.height / 2 + delta;

  let othersIdx = 0;
  itemDrag.others.forEach(id => {
    const r = itemDrag.rects.get(id);
    if (r.top + r.height / 2 < draggedCenter) othersIdx++;
  });

  itemDrag.others.forEach((id, i) => {
    const el = itemDrag.elsById.get(id);
    let shift = 0;
    if (othersIdx > itemDrag.originalBoundary && i >= itemDrag.originalBoundary && i < othersIdx) shift = -itemDrag.draggedHeight;
    else if (othersIdx < itemDrag.originalBoundary && i >= othersIdx && i < itemDrag.originalBoundary) shift = itemDrag.draggedHeight;
    el.style.transform = shift ? `translateY(${shift}px)` : "";
  });

  itemDrag.targetOthersIdx = othersIdx;
}

function wireItemDragHandle(handle, itemEl) {
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* best-effort */ }
    const siblingEls = [...itemEl.parentElement.querySelectorAll(".shelf-item[data-id]")];
    const order = siblingEls.map(el => el.dataset.id);
    const draggedId = itemEl.dataset.id;
    const scrollY = window.scrollY;
    const rects = new Map(siblingEls.map(el => {
      const r = el.getBoundingClientRect();
      return [el.dataset.id, { top: r.top + scrollY, height: r.height }];
    }));
    const elsById = new Map(siblingEls.map(el => [el.dataset.id, el]));
    const others = order.filter(id => id !== draggedId);
    itemDrag = {
      draggedId, others, elsById, rects,
      originalBoundary: order.indexOf(draggedId),
      draggedHeight: rects.get(draggedId).height,
      startY: e.clientY + scrollY,
      lastClientY: e.clientY,
      targetOthersIdx: order.indexOf(draggedId)
    };
    itemEl.classList.add("dragging");
  });
  handle.addEventListener("pointermove", (e) => {
    if (!itemDrag || itemDrag.draggedId !== itemEl.dataset.id) return;
    itemDrag.lastClientY = e.clientY;
    updateItemDragVisual(itemEl);
  });
  const endDrag = async () => {
    if (!itemDrag || itemDrag.draggedId !== itemEl.dataset.id) return;
    const { others, targetOthersIdx, elsById, draggedId } = itemDrag;
    const finalOrder = others.slice();
    finalOrder.splice(targetOthersIdx, 0, draggedId);
    elsById.forEach(el => { el.style.transform = ""; });
    itemEl.classList.remove("dragging");
    itemDrag = null;

    // finalOrder only covers the currently-visible (search/tag-filtered)
    // rows -- splice those back into their slots within the full catalog,
    // leaving anything filtered out of view untouched (same pattern as
    // applyScopeOrder for the shopping list's main/staple split).
    const catalog = await getItemCatalog();
    const byId = new Map(catalog.map(e => [e.id, e]));
    const visibleSet = new Set(finalOrder);
    let idx = 0;
    const reordered = catalog.map(e => visibleSet.has(e.id) ? byId.get(finalOrder[idx++]) : e);
    await saveItemCatalog(reordered);
    renderItemCatalogRows();
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
}

async function renderItemCatalogRows() {
  const container = document.getElementById("ingCatalogArea");
  if (!container) return;
  const catalog = await getItemCatalog();
  const term = currentItemSearch.trim().toLowerCase();
  const filtered = catalog.filter(e => {
    if (!matchesItemTagFilter(e)) return false;
    return !term || e.name.toLowerCase().includes(term) || (e.aliases || []).some(a => a.toLowerCase().includes(term));
  });
  // Preserves the shelf's own order (drag-to-reorder writes straight back
  // into the catalog array) rather than forcing alphabetical -- searching
  // or filtering narrows what's shown without reshuffling the shelf.
  const rows = filtered.map(renderItemCatalogRow).join("");
  container.innerHTML = `
    <div id="ingRows">${rows || `<div class="empty-msg">${term ? "No matches." : "Nothing yet -- add one below."}</div>`}</div>
    ${renderNewItemRow()}
  `;
  wireItemCatalogEvents();
}

// Scans every pair of catalog entries with the same subsequence-based
// fuzzy match used at add-time, so drift that slipped in before that
// existed (or was declined) can be cleaned up in one place.
function findDuplicatePairs(catalog) {
  const pairs = [];
  for (let i = 0; i < catalog.length; i++) {
    for (let j = i + 1; j < catalog.length; j++) {
      const a = catalog[i], b = catalog[j];
      const na = normalizeForFuzzy(a.name), nb = normalizeForFuzzy(b.name);
      if (na.length < 3 || nb.length < 3 || na.length === nb.length) continue;
      const shorter = na.length < nb.length ? a : b;
      const longer = na.length < nb.length ? b : a;
      const shortNorm = normalizeForFuzzy(shorter.name), longNorm = normalizeForFuzzy(longer.name);
      if (!isSubsequence(shortNorm, longNorm)) continue;
      const ratio = shortNorm.length / longNorm.length;
      if (ratio >= 0.35) pairs.push({ shorter, longer, ratio });
    }
  }
  pairs.sort((x, y) => y.ratio - x.ratio);
  return pairs;
}

async function renderDuplicateScan() {
  const container = document.getElementById("dupResultsArea");
  if (!container) return;
  const catalog = await getItemCatalog();
  const pairs = findDuplicatePairs(catalog);
  if (pairs.length === 0) {
    container.innerHTML = `<div class="status-msg status-ok">No likely duplicates found.</div>`;
    return;
  }
  container.innerHTML = `<div class="section-label">Possible duplicates</div>` + pairs.map((p, i) => `
    <div class="compare-item" data-idx="${i}">
      <div class="item-body">
        <div class="item-text">"${escapeHtml(p.shorter.name)}" &rarr; "${escapeHtml(p.longer.name)}"?</div>
      </div>
      <button class="secondary-btn" data-action="merge-dup" data-idx="${i}">Merge</button>
      <button class="icon-btn" data-action="dismiss-dup">✕</button>
    </div>`).join("");

  container.querySelectorAll('[data-action="merge-dup"]').forEach(btn => {
    btn.addEventListener("click", async () => {
      const pair = pairs[Number(btn.dataset.idx)];
      const catalogBefore = await getItemCatalog();
      const itemsBefore = await getShopItems();
      await mergeCatalogEntries(pair.shorter, pair.longer.id);
      showToast(`Merged "${pair.shorter.name}" into "${pair.longer.name}".`, async () => {
        await saveItemCatalog(catalogBefore);
        await saveShopItems(itemsBefore);
        refreshItemSuggestions();
        renderItemCatalogRows();
      }, () => { renderItemCatalogRows(); renderDuplicateScan(); });
      renderItemCatalogRows();
      renderDuplicateScan();
    });
  });
  container.querySelectorAll('[data-action="dismiss-dup"]').forEach(btn => {
    btn.addEventListener("click", () => btn.closest(".compare-item").remove());
  });
}

// Scans every recipe's ingredients for anything that doesn't match the
// shelf yet (same matchCatalog/findFuzzyCatalogSuggestion check used at
// recipe-add time), so the shelf can be bulk-populated from an existing
// recipe library in one pass instead of only growing one recipe at a time.
async function renderPopulateFromRecipes() {
  const container = document.getElementById("dupResultsArea");
  if (!container) return;
  const [recipes, catalog] = await Promise.all([getAllRecipes(), getItemCatalog()]);
  const seen = new Map(); // lowercase name -> original-case name
  recipes.forEach(r => {
    (r.ingredients || []).forEach(line => {
      const name = parseIngredient(line).name || line;
      if (!name) return;
      const key = name.toLowerCase().trim();
      if (!key || seen.has(key)) return;
      if (matchCatalog(name, catalog) || findFuzzyCatalogSuggestion(name, catalog)) return;
      seen.set(key, name);
    });
  });
  const unmatched = [...seen.values()].sort((a, b) => a.localeCompare(b));
  if (unmatched.length === 0) {
    container.innerHTML = `<div class="status-msg status-ok">Every recipe ingredient is already on your shelf.</div>`;
    return;
  }
  container.innerHTML = `<div class="section-label">Not yet on your shelf</div>
    <div class="btn-row" style="margin-bottom:10px;"><button class="secondary-btn" id="addAllFromRecipesBtn">Add all ${unmatched.length}</button></div>` +
    unmatched.map((name, i) => `
    <div class="compare-item" data-idx="${i}">
      <div class="item-body"><div class="item-text">${escapeHtml(name)}</div></div>
      <button class="secondary-btn" data-action="add-from-recipe" data-idx="${i}">Add</button>
      <button class="icon-btn" data-action="dismiss-dup">✕</button>
    </div>`).join("");

  const addOne = async (name) => {
    const cat = await getItemCatalog();
    if (matchCatalog(name, cat)) return;
    cat.push({
      id: slugify(name) + "-" + Date.now().toString(36).slice(-4) + "-" + Math.random().toString(36).slice(-3),
      name, aliases: [name.toLowerCase()], antiAliases: [], staple: false, unit: "", step: stepForUnit(""), defaultQty: 1
    });
    await saveItemCatalog(cat);
  };
  container.querySelectorAll('[data-action="add-from-recipe"]').forEach(btn => {
    btn.addEventListener("click", async () => {
      await addOne(unmatched[Number(btn.dataset.idx)]);
      renderItemCatalogRows();
      btn.closest(".compare-item").remove();
    });
  });
  container.querySelectorAll('[data-action="dismiss-dup"]').forEach(btn => {
    btn.addEventListener("click", () => btn.closest(".compare-item").remove());
  });
  const addAllBtn = document.getElementById("addAllFromRecipesBtn");
  if (addAllBtn) addAllBtn.addEventListener("click", async () => {
    for (const name of unmatched) await addOne(name);
    renderItemCatalogRows();
    renderPopulateFromRecipes();
  });
}

async function renderItemCatalog() {
  const main = document.getElementById("main");
  const catalog = await getItemCatalog();
  const tags = allItemTags(catalog);
  main.innerHTML = `
    <div class="detail-card">
      <h2>Shelf</h2>
      <div class="toolbar">
        ${searchBoxHtml("itemCatalogSearch", "Search your shelf...", currentItemSearch)}
        <select id="itemTagFilter">
          <option value="">All tags</option>
          <option value="__staple" ${currentItemTagFilter === "__staple" ? "selected" : ""}>Staple</option>
          ${tags.map(t => `<option value="${escapeAttr(t)}" ${t === currentItemTagFilter ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
        </select>
        <button class="secondary-btn" id="findDupesBtn">Find duplicates</button>
        <button class="secondary-btn" id="populateFromRecipesBtn">Populate from recipes</button>
      </div>
      <div id="dupResultsArea"></div>
      <div id="ingCatalogArea"></div>
      <datalist id="unitPresets">
        ${UNIT_PRESETS.map(u => `<option value="${escapeAttr(u)}">`).join("")}
      </datalist>
    </div>
  `;
  document.getElementById("itemCatalogSearch").addEventListener("input", (e) => {
    currentItemSearch = e.target.value;
    renderItemCatalogRows();
  });
  wireSearchClear("itemCatalogSearch", () => { currentItemSearch = ""; renderItemCatalogRows(); });
  document.getElementById("itemTagFilter").addEventListener("change", (e) => {
    currentItemTagFilter = e.target.value;
    renderItemCatalogRows();
  });
  document.getElementById("findDupesBtn").addEventListener("click", renderDuplicateScan);
  document.getElementById("populateFromRecipesBtn").addEventListener("click", renderPopulateFromRecipes);
  await renderItemCatalogRows();
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

// Manual entry is the primary, front-and-center path -- this is a
// self-contained recipe app first. JSON import is offered as a secondary
// option for bulk/bring-your-own-data cases, and AI assistance (asking an
// LLM to convert a recipe photo/link into that JSON) is tucked a level
// further in as a helper for that import path, not the headline feature.
let addImportOpen = false;
let addAiHelpOpen = false;

function renderAdd(statusMsg, opts) {
  opts = opts || {};
  if (!opts.skipHistory) pushNav("add", "recipes");
  addImportOpen = !!statusMsg; // land with the import section open if we're showing an import result/error
  addAiHelpOpen = false;
  const main = document.getElementById("main");

  function render() {
    main.innerHTML = `
      <button class="back-btn" id="addBackBtn">&larr; Back to recipes</button>
      <div class="detail-card add-hero">
        <h2>Add a recipe</h2>
        <p>Write it out yourself -- titles, ingredients, method, all of it.</p>
        <button class="primary-btn" id="manualAddBtn">+ Write a new recipe</button>
      </div>

      <div class="notes-card">
        <button class="notes-toggle ${addImportOpen ? "open" : ""}" id="importToggle">
          <span class="chevron">▸</span><span>Import from JSON</span>
        </button>
        ${addImportOpen ? `<div class="notes-body">
          <p style="font-size:0.85rem;color:var(--muted);margin:0 0 10px;">Paste a recipe already in this app's JSON shape -- from an export, a script, or converted by hand.</p>
          <textarea id="jsonInput" placeholder="Paste recipe JSON here..."></textarea>
          <button class="primary-btn" id="reviewJsonBtn">Review before adding</button>
          ${statusMsg ? statusMsg : ""}

          <div class="notes-card" style="margin-top:14px;">
            <button class="notes-toggle ${addAiHelpOpen ? "open" : ""}" id="aiHelpToggle">
              <span class="chevron">▸</span><span>Converting a recipe from a photo or link? Get help from an AI assistant</span>
            </button>
            ${addAiHelpOpen ? `<div class="notes-body">
              <p style="font-size:0.85rem;color:var(--muted);margin:0 0 10px;">Copy this prompt into an AI assistant (like Claude) along with a photo or link of the recipe, then paste what it gives you back above.</p>
              <div class="btn-row"><button class="secondary-btn" id="copyPromptBtn">Copy prompt for AI</button></div>
              <div class="schema-box" style="margin-top:12px;">
                <pre>${escapeHtml(JSON.stringify(SCHEMA_EXAMPLE, null, 2))}</pre>
                <div>Only <code>title</code> and <code>ingredients</code> are required.</div>
              </div>
            </div>` : ""}
          </div>
        </div>` : ""}
      </div>
    `;
    document.getElementById("addBackBtn").addEventListener("click", () => history.back());
    document.getElementById("manualAddBtn").addEventListener("click", () => renderRecipeForm(null));
    document.getElementById("importToggle").addEventListener("click", () => { addImportOpen = !addImportOpen; render(); });
    if (addImportOpen) {
      document.getElementById("reviewJsonBtn").addEventListener("click", handleJsonReview);
      document.getElementById("aiHelpToggle").addEventListener("click", () => { addAiHelpOpen = !addAiHelpOpen; render(); });
      if (addAiHelpOpen) {
        document.getElementById("copyPromptBtn").addEventListener("click", copyClaudePrompt);
      }
    }
  }
  render();
}

// Checks the ingredient textarea against the item catalog and shows which
// lines don't match anything yet, with a bulk "Add as items" action, plus a
// per-line "Link to..." picker for when the ingredient is really just a
// different name for something already on the shelf (e.g. "capsicum"
// should become an alias of an existing "Bell pepper" entry, not a
// duplicate item) -- so the shelf can be built out at recipe-add time
// either way, not just by auto-creating everything unrecognized.
async function renderUnmatchedHint() {
  const hintEl = document.getElementById("unmatchedHint");
  if (!hintEl) return;
  const lines = document.getElementById("fIngredients").value.split("\n").map(s => s.trim()).filter(Boolean);
  if (lines.length === 0) { hintEl.innerHTML = ""; return; }
  const catalog = await getItemCatalog();
  const unmatched = [];
  lines.forEach(line => {
    const parsed = parseIngredient(line);
    const name = parsed.name || line;
    if (!matchCatalog(name, catalog) && !findFuzzyCatalogSuggestion(name, catalog)) {
      unmatched.push(name);
    }
  });
  if (unmatched.length === 0) { hintEl.innerHTML = ""; return; }
  const catalogOptions = catalog.slice().sort((a, b) => a.name.localeCompare(b.name))
    .map(e => `<option value="${escapeAttr(e.id)}">${escapeHtml(e.name)}</option>`).join("");
  hintEl.innerHTML = `<div class="status-msg" style="margin:-6px 0 14px;">
    <div style="margin-bottom:8px;">${unmatched.length} ingredient(s) not yet on your shelf:</div>
    ${unmatched.map((n, i) => `
      <div class="unmatched-row" data-idx="${i}">
        <span class="unmatched-name">${escapeHtml(n)}</span>
        <select class="unmatched-link" data-idx="${i}">
          <option value="">Link to existing...</option>
          ${catalogOptions}
        </select>
      </div>`).join("")}
    <button class="mini-btn" id="addUnmatchedBtn" type="button" style="margin-top:8px;">Add remaining as new items</button>
  </div>`;
  hintEl.querySelectorAll(".unmatched-link").forEach(sel => {
    sel.addEventListener("change", async () => {
      const entryId = sel.value;
      if (!entryId) return;
      const name = unmatched[Number(sel.dataset.idx)];
      const cat = await getItemCatalog();
      const entry = cat.find(e => e.id === entryId);
      if (entry) {
        entry.aliases = entry.aliases || [];
        const norm = name.toLowerCase();
        if (!entry.aliases.includes(norm)) entry.aliases.push(norm);
        await saveItemCatalog(cat);
        showToast(`Linked "${name}" to "${entry.name}".`, null, null);
      }
      renderUnmatchedHint();
    });
  });
  document.getElementById("addUnmatchedBtn").addEventListener("click", async () => {
    const cat = await getItemCatalog();
    unmatched.forEach(name => {
      if (matchCatalog(name, cat)) return;
      cat.push({
        id: slugify(name) + "-" + Date.now().toString(36).slice(-4) + "-" + Math.random().toString(36).slice(-3),
        name, aliases: [name.toLowerCase()], antiAliases: [], staple: false, unit: "", step: stepForUnit(""), defaultQty: 1
      });
    });
    await saveItemCatalog(cat);
    renderUnmatchedHint();
  });
}

function renderRecipeForm(recipe, opts) {
  opts = opts || {};
  const main = document.getElementById("main");
  const isEdit = !!recipe;
  if (!opts.skipHistory) pushNav("form", "recipes", { id: isEdit ? recipe.id : null });
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
      <div class="form-field"><label>Rating</label><div id="fRatingStars">${starsHtml(r.rating)}</div></div>
      <div class="form-field">
        <label>Photo (optional)</label>
        <div id="fPhotoPreviewArea">${r.photo ? `<img src="${escapeAttr(r.photo)}" class="form-photo-preview" alt="">` : ""}</div>
        <div class="btn-row">
          <button type="button" class="secondary-btn" id="fPhotoPickBtn">${r.photo ? "Change photo" : "Add a photo"}</button>
          <button type="button" class="secondary-btn" id="fPhotoRemoveBtn" style="${r.photo ? "" : "display:none;"}">Remove photo</button>
        </div>
        <input type="file" id="fPhotoInput" accept="image/*">
      </div>
      <div class="form-field">
        <label>Card color</label>
        <div class="card-color-row" id="cardColorRow">${cardColorSwatchesHtml(r.cardColor || null)}</div>
      </div>
      <div class="form-field"><label>Tags (comma separated)</label><input type="text" id="fTags" value="${escapeAttr((r.tags || []).join(", "))}"></div>
      <div class="form-field"><label>Ingredients (one per line)</label><textarea id="fIngredients">${escapeHtml((r.ingredients || []).join("\n"))}</textarea></div>
      <div id="unmatchedHint"></div>
      <div class="form-field"><label>Method (one step per line)</label><textarea id="fMethod">${escapeHtml((r.method || []).join("\n"))}</textarea></div>
      <div class="form-field"><label>Notes</label><textarea id="fNotes" style="min-height:70px;">${escapeHtml(r.notes || "")}</textarea></div>
      <button class="primary-btn" id="saveRecipeBtn">${isEdit ? "Save changes" : "Save recipe"}</button>
      <div id="formStatus"></div>
    </div>
  `;
  document.getElementById("formBackBtn").addEventListener("click", () => history.back());
  let formRating = r.rating || 0;
  function wireFormStars() {
    document.querySelectorAll("#fRatingStars .star").forEach(el => {
      el.addEventListener("click", () => {
        const v = Number(el.dataset.value);
        formRating = formRating === v ? 0 : v;
        document.getElementById("fRatingStars").innerHTML = starsHtml(formRating);
        wireFormStars();
      });
    });
  }
  wireFormStars();
  let formPhoto = r.photo || null;
  document.getElementById("fPhotoPickBtn").addEventListener("click", () => document.getElementById("fPhotoInput").click());
  document.getElementById("fPhotoRemoveBtn").addEventListener("click", () => {
    formPhoto = null;
    document.getElementById("fPhotoPreviewArea").innerHTML = "";
    document.getElementById("fPhotoPickBtn").textContent = "Add a photo";
    document.getElementById("fPhotoRemoveBtn").style.display = "none";
  });
  document.getElementById("fPhotoInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      formPhoto = await resizeImageFile(file, 900, 0.75);
      document.getElementById("fPhotoPreviewArea").innerHTML = `<img src="${escapeAttr(formPhoto)}" class="form-photo-preview" alt="">`;
      document.getElementById("fPhotoPickBtn").textContent = "Change photo";
      document.getElementById("fPhotoRemoveBtn").style.display = "";
    } catch (err) {
      document.getElementById("formStatus").innerHTML = `<div class="status-msg status-err">Couldn't read that image -- try a different file.</div>`;
    }
    e.target.value = "";
  });
  let formCardColor = r.cardColor || null;
  function wireCardColorRow() {
    const row = document.getElementById("cardColorRow");
    row.querySelectorAll(".card-color-swatch").forEach(btn => {
      btn.addEventListener("click", () => {
        formCardColor = btn.dataset.color || null;
        row.innerHTML = cardColorSwatchesHtml(formCardColor);
        wireCardColorRow();
      });
    });
    row.querySelector(".card-color-picker").addEventListener("input", (e) => {
      formCardColor = e.target.value;
      row.querySelectorAll(".card-color-swatch").forEach(b => b.classList.remove("selected"));
      e.target.classList.add("selected");
    });
  }
  wireCardColorRow();
  const ingredientsField = document.getElementById("fIngredients");
  let unmatchedDebounce = null;
  ingredientsField.addEventListener("input", () => {
    clearTimeout(unmatchedDebounce);
    unmatchedDebounce = setTimeout(renderUnmatchedHint, 400);
  });
  renderUnmatchedHint();
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
      rating: formRating, timesCooked: r.timesCooked || 0, lastCooked: r.lastCooked || null, photo: formPhoto, cardColor: formCardColor,
      dateAdded: r.dateAdded || new Date().toISOString().slice(0, 10)
    };
    await putRecipe(savedRecipe);
    if (isEdit) {
      showToast("Recipe updated.", async () => { await putRecipe(previous); }, () => renderDetail(previous.id, { skipHistory: true }));
      collapseTo(1, "detail", "recipes", { id: savedRecipe.id }); // Form -> Detail
    } else {
      showToast("Recipe added.", async () => { await deleteRecipe(savedRecipe.id); }, renderRecipes);
      collapseTo(2, "detail", "recipes", { id: savedRecipe.id }); // Form+Add -> Detail
    }
    renderDetail(savedRecipe.id, { skipHistory: true });
  });
}

function handleJsonReview() {
  const raw = document.getElementById("jsonInput").value.trim();
  if (!raw) return;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    renderAdd(`<div class="status-msg status-err">Couldn't parse that as JSON: ${escapeHtml(e.message)}</div>`, { skipHistory: true });
    return;
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const valid = items.filter(item => item.title && item.ingredients);
  const skipped = items.length - valid.length;
  if (valid.length === 0) {
    renderAdd(`<div class="status-msg status-err">Nothing to add — every item needs at least a title and ingredients.</div>`, { skipHistory: true });
    return;
  }
  pendingImport = valid.map(item => ({ item, serves: detectDefaultServes(item) }));
  renderReview(skipped);
}

function renderReview(skippedCount, opts) {
  opts = opts || {};
  if (!opts.skipHistory) pushNav("review", "recipes", { skippedCount });
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
    history.back();
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
      rating: item.rating || 0, timesCooked: item.timesCooked || 0, lastCooked: item.lastCooked || null,
      photo: item.photo || null, cardColor: item.cardColor || null,
      dateAdded: item.dateAdded || new Date().toISOString().slice(0, 10)
    };
    await putRecipe(recipe);
    added++;
  }
  pendingImport = null;
  collapseTo(1, "add", "recipes"); // Review -> Add
  renderAdd(`<div class="status-msg status-ok">Added ${added} recipe(s).</div>`, { skipHistory: true });
}

/* ---------- Settings: export / import ---------- */

function formatHistoryDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function renderShopHistorySection() {
  const container = document.getElementById("shopHistoryArea");
  if (!container) return;
  const history = await getShopHistory();
  if (history.length === 0) {
    container.innerHTML = `<p style="font-size:0.85rem;color:var(--muted);">Nothing archived yet -- past lists show up here after you clear or start a new one.</p>`;
    return;
  }
  container.innerHTML = history.map(h => `
    <div class="ingredient-row" data-id="${escapeAttr(h.id)}">
      <div class="item-body" style="flex:1;">
        <div class="item-text">${formatHistoryDate(h.clearedAt)} &middot; ${h.items.length} item(s)</div>
      </div>
      <button class="secondary-btn" data-action="restore-history">Restore</button>
      <button class="icon-btn" data-action="delete-history">✕</button>
    </div>`).join("");

  container.querySelectorAll('[data-action="restore-history"]').forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.closest(".ingredient-row").dataset.id;
      const entry = history.find(h => h.id === id);
      if (!entry) return;
      const current = await getShopItems();
      await archiveShoppingList(current);
      const restored = entry.items.map(i => ({ ...i, id: genId(), checked: false }));
      await saveShopItems(restored);
      showToast(`Restored list from ${formatHistoryDate(entry.clearedAt)}.`, async () => { await saveShopItems(current); }, renderShopListArea);
      renderShopHistorySection();
    });
  });
  container.querySelectorAll('[data-action="delete-history"]').forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.closest(".ingredient-row").dataset.id;
      const cur = await getShopHistory();
      await saveShopHistory(cur.filter(h => h.id !== id));
      renderShopHistorySection();
    });
  });
}

async function renderSettings() {
  const main = document.getElementById("main");
  const theme = getThemePreference();
  main.innerHTML = `
    <div class="settings-card">
      <h3>Appearance</h3>
      <div class="btn-row theme-toggle-row" id="themeToggleRow">
        <button class="secondary-btn ${theme === "system" ? "selected" : ""}" data-theme-choice="system">System</button>
        <button class="secondary-btn ${theme === "light" ? "selected" : ""}" data-theme-choice="light">Light</button>
        <button class="secondary-btn ${theme === "dark" ? "selected" : ""}" data-theme-choice="dark">Dark</button>
      </div>
    </div>
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
      <h3>Shopping history</h3>
      <div id="shopHistoryArea"></div>
    </div>
    <div class="settings-card">
      <h3>About</h3>
      <p>Stored locally in this browser only. Export regularly as a backup.</p>
    </div>
    <div class="settings-card">
      <h3>Debug</h3>
      <p id="debugCacheInfo">Checking cache status...</p>
      <div class="btn-row">
        <button class="secondary-btn" id="debugReloadBtn">Reload app</button>
        <button class="secondary-btn" id="debugHardReloadBtn">Clear cache &amp; reload</button>
      </div>
    </div>
  `;
  document.getElementById("themeToggleRow").querySelectorAll("[data-theme-choice]").forEach(btn => {
    btn.addEventListener("click", () => {
      setThemePreference(btn.dataset.themeChoice);
      renderSettings();
    });
  });
  document.getElementById("exportBtn").addEventListener("click", exportLibrary);
  document.getElementById("importBtn").addEventListener("click", () => document.getElementById("fileInput").click());
  document.getElementById("fileInput").addEventListener("change", handleFileImport);
  document.getElementById("debugReloadBtn").addEventListener("click", () => location.reload());
  document.getElementById("debugHardReloadBtn").addEventListener("click", async () => {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(c => caches.delete(c)));
    location.reload();
  });
  (async () => {
    const info = document.getElementById("debugCacheInfo");
    const cacheNames = await caches.keys();
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    info.textContent = `Cache: ${cacheNames.join(", ") || "none"} -- SW: ${reg && reg.active ? "active" : "none"}`;
  })();
  await renderShopHistorySection();
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
          rating: item.rating || 0, timesCooked: item.timesCooked || 0, lastCooked: item.lastCooked || null,
          photo: item.photo || null, cardColor: item.cardColor || null,
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
            id: e.id, name: e.name, aliases: e.aliases || [], staple: !!e.staple,
            tags: e.staple ? ["staple"] : [], unit: "", step: 1, defaultQty: 1
          })));
        }
      }
      document.getElementById("importStatus").innerHTML =
        `<div class="status-msg status-ok">Imported ${count} recipe(s)${isBundle ? ", plus meal plan / shopping list / items" : ""}.</div>`;
    } catch (err) {
      document.getElementById("importStatus").innerHTML = `<div class="status-msg status-err">Import failed: ${escapeHtml(err.message)}</div>`;
    }
  };
  reader.onerror = () => {
    document.getElementById("importStatus").innerHTML = `<div class="status-msg status-err">Couldn't read that file -- try again.</div>`;
  };
  reader.readAsText(file);
}

/* ---------- Utilities ---------- */

// Shared markup + wiring for the search boxes in Recipes, Shopping list,
// and Item Manager -- adds a small "x" to clear the field instead of
// requiring backspace, which matters more as those lists grow.
function searchBoxHtml(id, placeholder, value) {
  return `<div class="search-wrap">
    <input type="text" id="${escapeAttr(id)}" placeholder="${escapeAttr(placeholder)}" value="${escapeAttr(value)}">
    <button type="button" class="search-clear-btn" data-clear="${escapeAttr(id)}" style="${value ? "" : "display:none;"}" title="Clear search">✕</button>
  </div>`;
}
function wireSearchClear(inputId, onChange) {
  const input = document.getElementById(inputId);
  const btn = document.querySelector(`[data-clear="${inputId}"]`);
  if (!input || !btn) return;
  input.addEventListener("input", () => { btn.style.display = input.value ? "" : "none"; });
  btn.addEventListener("click", () => {
    input.value = "";
    btn.style.display = "none";
    input.focus();
    onChange();
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

/* ---------- Theme (light/dark/system) ----------
   Dark mode follows the OS by default (prefers-color-scheme), but that's
   not always what someone wants -- this lets it be pinned either way,
   stamped as :root[data-theme] which the stylesheet's explicit override
   rules take precedence over the system-preference media query. */
function getThemePreference() {
  try { return localStorage.getItem("themePreference") || "system"; } catch (err) { return "system"; }
}
function applyThemePreference() {
  const pref = getThemePreference();
  if (pref === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = pref;
  const isDark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const meta = document.querySelector('meta[name="theme-color"]:not([media])') || document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", isDark ? "#201c17" : "#faf5ec");
}
function setThemePreference(pref) {
  try { localStorage.setItem("themePreference", pref); } catch (err) { /* private-mode storage limits -- non-fatal */ }
  applyThemePreference();
}

/* ---------- Navigation: a hierarchy, not a browsing history ----------
   navStack is our own in-memory stack of {screen, tab, params}, root-first:
   navStack[0] is always Home. Every screen has exactly one parent (its
   tab's home, or Home itself), so "back" always means "pop one level,"
   never "whatever I happened to visit before" -- no zig-zagging between
   tabs based on click order.

   The browser/hardware back button is *trapped*: on load, and after every
   forward navigation, we push one throwaway history entry ("the trap").
   A back press consumes one trap and fires `popstate`; our handler pops
   navStack by one level and re-renders, or -- if we're already at Home
   (navStack.length === 1) -- immediately pushes a fresh trap to swallow
   the press instead of letting the browser/PWA close. In-app "<- Back"
   buttons call `history.back()` too, so there is exactly one code path
   for every kind of "back."

   Internal collapses (e.g. saving a recipe folds the Form screen back
   into Detail) just edit navStack directly and re-render -- no trap
   needed, since a net *decrease* in stack depth can never leave us short
   of traps for future legitimate back-presses. */

let navStack = [{ screen: "home" }];

function pushTrap() {
  history.pushState({ trap: true }, "", "#" + navStack[navStack.length - 1].screen);
}

// Forward navigation: descend one level from wherever we are. Pass
// tab === undefined to inherit the current tab (most screens); pass an
// explicit tab (including null, for a Home-level screen) to set it.
function pushNav(screen, tab, params) {
  const resolvedTab = tab === undefined ? currentTab : tab;
  navStack.push({ screen, tab: resolvedTab, params: params || null });
  currentTab = resolvedTab;
  persistNavStack();
  pushTrap();
  // pushNav always means "descending to a non-Home screen" -- screens
  // reached this way (e.g. clicking "Rustle Up" from Home) render
  // themselves directly rather than going through renderStackTop, whose
  // own home-screen toggle would otherwise never run, leaving Home's
  // overflow:hidden/flex-clamped layout stuck on the new screen.
  const mainEl = document.getElementById("main");
  if (mainEl) mainEl.classList.remove("home-screen");
}

// Lateral jump from the tab bar: reset to Home > that tab, discarding
// whatever nested screen we were on -- an explicit "take me to this
// section" action, not a hierarchical descent.
function goToTab(tab) {
  currentTab = tab;
  navStack = [{ screen: "home" }, { screen: "tab", tab }];
  persistNavStack();
  pushTrap();
  renderStackTop();
}
function goHome() {
  currentTab = null;
  navStack = [{ screen: "home" }];
  persistNavStack();
  pushTrap();
  renderStackTop();
}

// Replaces the top `levels` stack entries with a single new one (used when
// finishing a multi-step flow, e.g. Form -> Detail on save, or
// Review+Add -> Detail on creating a new recipe). Net depth change is
// always <= 0, so this never needs a new trap.
function collapseTo(levels, screen, tab, params) {
  navStack.splice(navStack.length - levels, levels, { screen, tab: tab || currentTab, params: params || null });
  currentTab = tab || currentTab;
  persistNavStack();
  const mainEl = document.getElementById("main");
  if (mainEl) mainEl.classList.remove("home-screen");
}

function persistNavStack() {
  try {
    // The Review screen depends on in-memory `pendingImport`, which never
    // survives a reload -- never persist landing there.
    const safe = navStack[navStack.length - 1].screen === "review" ? navStack.slice(0, -1) : navStack;
    localStorage.setItem("navStack", JSON.stringify(safe));
  } catch (err) { /* private-mode storage limits -- non-fatal */ }
}

function setActiveTabButtons(tab) {
  document.getElementById("tabHomeBtn").classList.toggle("active", !tab);
  document.getElementById("tabRecipesBtn").classList.toggle("active", tab === "recipes");
  document.getElementById("tabPlanBtn").classList.toggle("active", tab === "mealplan");
  document.getElementById("tabShopBtn").classList.toggle("active", tab === "shop");
  document.getElementById("tabItemsBtn").classList.toggle("active", tab === "items");
  document.getElementById("tabSettingsBtn").classList.toggle("active", tab === "settings");
}
function renderTabHome(tab) {
  if (tab === "recipes") renderRecipes();
  else if (tab === "mealplan") renderMealPlan();
  else if (tab === "shop") { showCheckedItems = false; shopMenuOpen = false; renderShoppingList(); }
  else if (tab === "items") renderItemCatalog();
  else if (tab === "settings") renderSettings();
}

// Renders whatever's on top of navStack. This is the one place that turns
// a stack entry into an actual screen -- called after every push, pop,
// and collapse.
async function renderStackTop() {
  const top = navStack[navStack.length - 1];
  currentTab = top.tab || null;
  setActiveTabButtons(currentTab);
  // Home is the one screen that shouldn't scroll as a whole page -- it
  // should always fit the viewport, with only its own meal-plan list
  // scrolling internally if it's long. Every other screen keeps normal
  // page scrolling.
  document.getElementById("main").classList.toggle("home-screen", top.screen === "home");
  const opts = { skipHistory: true };
  if (top.screen === "home") renderHome();
  else if (top.screen === "tab") renderTabHome(top.tab);
  else if (top.screen === "detail") await renderDetail(top.params.id, opts);
  else if (top.screen === "add") renderAdd(undefined, opts);
  else if (top.screen === "form") {
    const recipe = top.params && top.params.id ? (await getAllRecipes()).find(x => x.id === top.params.id) : null;
    renderRecipeForm(recipe || null, opts);
  }
  else if (top.screen === "review" && pendingImport) renderReview(top.params ? top.params.skippedCount : 0, opts);
  else if (top.screen === "manualMeal") renderManualMealForm(opts);
  else if (top.screen === "pasteList") renderPasteList(opts);
  else if (top.screen === "itemCatalog") await renderItemCatalog(opts);
  else if (top.screen === "rustleUp") await renderRustleUp(opts);
  else { navStack = [{ screen: "home" }]; renderHome(); } // fallback, e.g. review with no pendingImport after reload
}

// Closes the shopping list's overflow menu on any click outside it. Kept as
// a single persistent listener (rather than one added/removed per render)
// because the menu button's own click handler doesn't re-render the list --
// see renderShopListArea -- so there's no natural moment to attach/detach it.
document.addEventListener("click", (e) => {
  if (shopMenuOpen && !e.target.closest(".menu-wrap")) {
    shopMenuOpen = false;
    const popup = document.getElementById("shopMenuPopup");
    if (popup) popup.style.display = "none";
  }
});

document.getElementById("tabHomeBtn").addEventListener("click", goHome);
document.getElementById("tabRecipesBtn").addEventListener("click", () => goToTab("recipes"));
document.getElementById("tabPlanBtn").addEventListener("click", () => goToTab("mealplan"));
document.getElementById("tabShopBtn").addEventListener("click", () => goToTab("shop"));
document.getElementById("tabItemsBtn").addEventListener("click", () => goToTab("items"));
document.getElementById("tabSettingsBtn").addEventListener("click", () => {
  // A second tap on the cog while already on Settings returns to wherever
  // you were (not just Home) -- goToTab's usual lateral reset would
  // otherwise throw away the nested screen/tab you came from.
  const top = navStack[navStack.length - 1];
  if (top.screen === "tab" && top.tab === "settings" && preSettingsStack) {
    navStack = preSettingsStack;
    preSettingsStack = null;
    persistNavStack();
    pushTrap();
    renderStackTop();
  } else {
    preSettingsStack = navStack.slice();
    goToTab("settings");
  }
});
window.addEventListener("popstate", () => {
  if (navStack.length > 1) {
    navStack.pop();
    persistNavStack();
    renderStackTop();
  } else {
    pushTrap(); // already at Home -- swallow the back press instead of exiting
  }
});
document.getElementById("undoToastBtn").addEventListener("click", async () => {
  const undoFn = toastUndoFn;
  const refreshFn = toastRefreshFn;
  hideToast();
  if (undoFn) await undoFn();
  if (refreshFn) refreshFn();
});

// Anything that reaches here slipped past a more specific try/catch --
// most button handlers don't wrap their own IndexedDB calls, so without
// this a failed save (quota exceeded, storage blocked, etc.) would fail
// completely silently instead of at least telling the user something
// didn't stick.
window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled error:", e.reason);
  showToast("Something went wrong and that last action may not have saved. Try again, or reload the app.", null, null, "Dismiss", 9000);
});

(async () => {
  try {
    db = await openDB();
    await seedIfEmpty();
    await seedItemCatalogIfEmpty();
    await migrateStapleTags();
    try {
      const saved = JSON.parse(localStorage.getItem("navStack"));
      if (Array.isArray(saved) && saved.length && saved[0].screen === "home") navStack = saved;
    } catch (err) { /* corrupt/missing -- fall back to the default [Home] stack */ }
    currentTab = navStack[navStack.length - 1].tab || null;
    // pushState (not replaceState): the natural page-load entry must stay
    // underneath our traps, or an early back-press would fall through to
    // it and cause a real cross-document navigation (visible as a reload,
    // or the app exiting) instead of being caught by our popstate handler.
    // A restored navStack can be several levels deep even though this
    // fresh document instance hasn't pushed any trap yet, so we seed one
    // trap per level (not just one) -- otherwise only the *first*
    // legitimate back-press per session would be safe.
    for (let i = 0; i < navStack.length; i++) pushTrap();
    await renderStackTop();
  } catch (err) {
    console.error("Failed to start Rustle Up:", err);
    document.getElementById("main").innerHTML = `
      <div class="empty-msg" style="padding-top:60px;">
        <strong>Couldn't load your data.</strong><br><br>
        This usually means private/incognito browsing, or storage being blocked or full,
        is preventing this device from using its local database.<br><br>
        Try a normal browser window, free up some storage, or check your browser's
        site-data settings for this page, then reload.
      </div>`;
  }
})();

// Installed PWAs are usually resumed, not reloaded -- a background tab
// update to the service worker doesn't reach the JS/HTML already sitting
// in memory. Rather than leaving that silently stale until the app is
// force-closed, surface a banner the moment a new version actually takes
// over, so a tap reloads to it immediately.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController) return; // the very first install, not an update
      const banner = document.getElementById("updateBanner");
      if (!banner) return;
      banner.classList.remove("hidden");
      document.getElementById("updateReloadBtn").addEventListener("click", () => location.reload(), { once: true });
    });
  });
}
