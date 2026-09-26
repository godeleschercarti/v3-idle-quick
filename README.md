# Victoria 3: Quick Idle

A small, dependency-free Victoria 3-inspired idle game built for GitHub Pages.

## Run it

Open `index.html` directly, or serve/upload the folder as a static site. There is no build step and no external JavaScript dependency.

For GitHub Pages, upload the contents of this folder to a repository and publish the repository root from your chosen branch.

## Current game loop

- Click the Construction Sector to generate GDP and level up manual construction.
- Buy seven increasingly expensive industries: Logging Camps, Iron Mines, Coal Mines, Tooling Workshops, Steel Mills, Glassworks and Automotive Industries.
- Industry generates passive GDP. GDP milestones multiply output.
- The National Accounts graph records cumulative GDP produced, so spending GDP never makes the line fall.
- Three company slots cost £500K, £10M and £100M.
- A chartered company starts with its own building portfolio, accumulates private cash, pays 40% of profits as dividends and automatically buys the next building in its visible queue whenever it can afford it.
- State and company construction use the same building-price curve, so autonomous company expansion makes subsequent buildings more expensive for everyone.

The company roster uses flavored-company names from Victoria 3 and adapts their industries to this intentionally tiny seven-building economy. It currently includes Klabin Irmãos & Cia., New Russia Company Ltd., Société anonyme John Cockerill, Glasfabrik Ludwig Moser & Söhne, Carnegie Steel Co. and Ford Motor Company.

## Saves

The save key remains `vic3QuickIdleSave_v1`, so saves from the earlier version remain compatible. Old saves simply begin with all three company slots locked.

The game autosaves every 10 seconds and on page exit. Normal saves use `localStorage`; a smaller cookie fallback preserves gameplay state if local storage is unavailable. Graph history is omitted from the cookie fallback to keep it below cookie size limits. Export/import can be used to move a save between browsers or devices.

Offline production is capped at eight hours. Company retained earnings, dividends and automatic expansion are simulated during offline progress as well.


### Company economics
Company profit is derived from the same GDP/sec values as normal buildings. Companies pay 40% of profit as dividends and retain 60% for automatic expansion. Diversified companies pay 55% of current market construction prices; single-industry specialists pay 35% and receive a 25% profit bonus. Company purchases still increase the shared market building count and therefore raise future prices for both the player and other companies.
