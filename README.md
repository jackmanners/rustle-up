# Rustle Up

A private, offline-first recipe box and shopping list. Everything lives in
your browser's IndexedDB — there's no backend, no account, and no data ever
leaves your device except when you choose to export it.

## What's in this folder

- `index.html` — the whole app (recipes, shopping list, add, settings)
- `manifest.json` — makes it installable as an app on your phone/desktop
- `sw.js` — service worker, caches the app shell so it works fully offline
- `icons/` — app icons (192px and 512px, regular + maskable)

## Getting it live on GitHub Pages

1. Create a new **private** GitHub repo (e.g. `rustle-up`).
2. Copy everything in this folder into the repo root (keep the folder
   structure — `icons/` stays a subfolder).
3. Commit and push.
4. In the repo: **Settings → Pages → Build and deployment → Source: Deploy
   from a branch**, branch `main`, folder `/ (root)`. Save.
5. GitHub will give you a URL like `https://yourusername.github.io/rustle-up/`.
   Note: **GitHub Pages sites are public URLs even on a private repo**, unless
   you're on a paid GitHub plan with Pages access control. Since there's no
   API key or personal data baked into the site itself (recipes only exist in
   *your* browser's IndexedDB), this is low-risk — someone who found the URL
   would see an empty Rustle Up with no recipes, not your data. If you'd
   rather it not be discoverable at all, keep the URL to yourselves and don't
   link it anywhere public.

## Installing it as an app

Once it's live (or even running locally), open the URL on your phone:
- **iOS Safari:** Share → Add to Home Screen
- **Android Chrome:** menu → Install app / Add to Home Screen
- **Desktop Chrome/Edge:** address bar install icon, or menu → Install Rustle Up

After install, it works fully offline — the recipes and shopping list are
already local, and the service worker caches the app shell itself.

## Adding new recipes

1. Photograph or paste the recipe into a normal Claude chat.
2. Ask Claude to return it in the Rustle Up schema (shown in the app's Add
   tab, and below).
3. Paste the JSON it gives you into the **Add** tab in the app.

```json
{
  "id": "short-unique-slug",
  "title": "Recipe Title",
  "source": "e.g. cookbook name, page, or website",
  "tags": ["chicken", "quick", "weeknight"],
  "servesLabel": "Serves 2",
  "time": "20 min",
  "ingredients": ["200g chicken breast", "1 lemon"],
  "method": ["Step one.", "Step two."],
  "notes": "Optional",
  "dateAdded": "2026-07-11"
}
```

Only `title` and `ingredients` are required.

## Syncing between you and your partner

There's no live sync — instead, use **Settings → Export** to download the
whole library as a `.json` file, send it to each other however you like
(Drive, Telegram, email), and **Settings → Import** on the other end. Import
matches recipes by `id`, so re-importing the same file won't create
duplicates — it just updates existing ones and adds anything new.

## Backups

Since everything lives only in the browser, clearing site data / browser
storage will wipe your recipes. Export occasionally as a backup, especially
before clearing browser data or switching devices.
