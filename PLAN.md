# Rustle Up — Ideas / Plan

Not yet implemented. Captured here so they don't get lost, in no particular order.

## Possible-duplicates scanner (Item Manager)
The smart alias-match (added for shorthand like "bronion"/"ronion"/"spronion")
only runs when a *new* item gets added. The catalog already has some
near-duplicates from before that existed. Add a button in the Item Manager
that re-runs the same fuzzy match pairwise across the whole catalog and
surfaces likely-duplicate pairs for manual review/merge, so drift can be
cleaned up retroactively, not just prevented going forward.

## Custom units beyond g/kg/ml/l
The quantity stepper currently only understands weight/volume/count. Real
shopping vocabulary includes bunches, punnets, blocks, dozens, etc. Let the
Item Manager accept an arbitrary unit word with its own step size, instead
of being limited to the fixed g/kg/ml/l list.

## Catch unmatched ingredients at recipe-add time
Right now the item catalog only grows when something gets added to the
shopping list. If adding or importing a recipe flagged which ingredient
lines don't match anything in the catalog yet, aliases could get built out
earlier -- so the Meal Plan comparison view is already clean the first time
you actually plan a meal with that recipe, instead of surfacing raw/unmatched
text.

## Usage-based autocomplete ordering
The add-item autocomplete list (the `<datalist>` suggestions) is currently
alphabetical. Sorting by how often or how recently an item has been added
would surface regulars first, which fits the "gets more bespoke over time"
direction better than alphabetical order.

## Recipe scaling doesn't carry into the Meal Plan
Scaling a recipe on its detail page is view-only -- it recalculates what's
shown, but when that recipe is planned, the Meal Plan comparison view always
aggregates the recipe's *base* ingredient quantities, not whatever serving
count you actually intend to cook. Worth letting a meal-plan entry carry an
optional serving override (defaulting to the recipe's own `serves`) so the
comparison list reflects real intended quantities, not just the recipe as
written.

## Shopping list history
"Clear all" / "New list" wipes the list after a short undo window (a few
seconds), then it's gone for good. A lightweight archive -- e.g. save the
outgoing list to a rolling history when starting a new one, viewable from
Settings -- would let you glance back at what you bought last time, and
lower the stakes of clearing.

## Item Manager search/filter
The catalog now grows on its own (auto-created on first use, seeded from
recipes, from pasted lists). As it grows past a couple dozen entries, a
search/filter box at the top of the Item Manager will matter for keeping it
navigable -- the ingredient rows currently just render as one long
alphabetical list with no way to narrow it down.

## Service worker cache strategy
Minor/technical: app.js and styles.css are cached cache-first, which means
every code change needs a manual cache-version bump (done ~13 times this
session) or updates silently don't show up. Switching those two files to a
network-first strategy (fall back to cache only when offline) would remove
that friction going forward while keeping the app fully usable offline.
