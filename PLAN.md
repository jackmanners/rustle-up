# Rustle Up — Ideas / Plan

Not yet implemented. Captured here so they don't get lost, in no particular order.

## Backup reminder / data safety net
Everything lives in this browser's IndexedDB only -- one storage clear away
from losing the whole library, meal plan, and shopping list. Export already
exists (Settings > Export library), but nothing prompts you to actually use
it. A lightweight nudge -- e.g. "last backed up X days ago" in Settings, or
a reminder after N changes -- would lower the stakes of that single point
of failure without requiring a real backend.

## Onboarding / first-run explanation
There's no first-run state explaining that everything is local-only and
lives in this browser's storage. Fine when it's just you, but a short
explanation on first load (or an empty-state note) would make the app
usable by someone else, or by you on a new device, without a verbal
explanation of the model.

## Versioned data schema
Fields have been added organically over time (recipe rating/timesCooked/
lastCooked, meal-plan day/servesOverride, item tags) with no explicit
schema version or migration step. Fine solo so far since old records just
read as "unset," but if the shape changes again, or data ever needs to
move between devices/exports from different app versions, an explicit
`schemaVersion` plus a small migration step on load would avoid silent
data drift or subtly-broken old records.
