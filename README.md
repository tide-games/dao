# The Season DAO

A venue of the [Tide Games fleet](https://tide-games.github.io/): a million shares a
season, bought with sealed gold that never comes back. Who holds the season, drawn
live from Tideholm's ledger.

**Play:** https://tide-games.github.io/dao/

## How it works

- The book lives in [Tideholm](https://github.com/melvincarvalho/tideholm)'s ledger
  beside the hall of fame (`dao.json`), keyed by season, and is served public and
  CORS-open at `/api/dao`. This page reads it and draws the charts — every pixel
  from code, no chart library.
- A buy is a signed trail move, exactly like a tavern stake: a **negative** delta on
  the sealed balance whose evidence names this venue
  (`{ venue: 'dao', mark, stake, shares }`). The move rides home in the URL and
  Tideholm's **Redeem** burns the gold and credits the shares.
- One gold a share, one-way, first come first served, no per-key cap, at most
  100,000 shares in one signed move (the slip rides in a URL).
- The slip segment is shared with the tavern and the den (same origin, same
  `localStorage` key), and cut at the trail's tip on arrival
  (`cutSlip`, imported from the tavern) — one purse across the fleet.

Arrive through the Tidegate at Tideholm (Market tab → *The Games Fleet*) with
`?did=&seal=&tip=&return=` and the buy form appears. Without a seal the page is
read-only.

`?api=https://host/tideholm` points the page at another Tideholm.

The plan beyond v1 — a vote, the parent DAO, trading — is
[melvincarvalho/tideholm#189](https://github.com/melvincarvalho/tideholm/issues/189).
