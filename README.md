# Victoria 3: Quick Idle

A tiny Victoria 3-inspired idle/clicker parody. It is deliberately lightweight: no build system, no frameworks and no external assets.

## Run locally

Open `index.html` in a browser. The game is entirely client-side.

## Put it on GitHub Pages

1. Create a new GitHub repository.
2. Upload `index.html`, `style.css` and `game.js` to the repository root.
3. In GitHub, open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`, then save.

GitHub will publish the game at the Pages URL shown in that settings screen.

## Saving

The game autosaves every 10 seconds and when the page is hidden or closed. It uses `localStorage` as the main save mechanism and also writes the same compact save string to a first-party cookie as a fallback. Export/import is included for manual backups or moving the save between browsers.

Offline production is credited for up to 8 hours.

## Gameplay tuning

All economy numbers are near the top of `game.js`:

- `BUILDINGS` controls building names, starting prices and GDP/sec.
- Building costs grow by `1.155` per purchase.
- `MILESTONES` controls global production multipliers.
- `clickPower()` controls manual construction scaling.
- `xpNeeded()` controls construction-sector level pacing.

No Victoria 3 art, music or other game assets are included.
