# Desk blotter (paper)

Minimal light blotter for the XAUUSD desk. Same live book and event bus as the dark board, less chrome.

Every number on the page is polled or aged. Nothing is baked into the HTML.

- Card, book, M30 / D1 boxes, FVG as three lines (profit area, not a buy)
- One labeled WAIT picture
- Activity feed, newest first
- Polls `events.json` + `book.json` every 3s (`?t=` cache-bust)
- Live XAU mid from [gold-api.com](https://api.gold-api.com/price/XAU) every 20s (indicative; not Coinexx, not TradingView). Shows LIVE + seconds-old. Falls back to last book bid and marks STALE if the feed fails.

Static host. No build step. GitHub Pages: `/` on `main`.
