# Platinum +1 Club

Live standings for a three-horse points contest. The judge enters points through a Google Form, the linked Sheet holds the log, a small Apps Script serves the log as JSON, and this page (GitHub Pages) draws the race.

## Pieces

| Piece | Where | What it does |
|---|---|---|
| Google Form "Contest points" | the judge's phone | one entry per ruling: competitor, points (-2 to 2), reason |
| Sheet "Contest points (Responses)" | Google Drive, time zone GMT | the log; every timestamp is UTC |
| `apps-script/Code.gs` | inside the Sheet (Extensions > Apps Script) | `doGet` serves the log as JSON; `onFormSubmit` pushes lead changes; `scheduledPush` sends the 7 PM local summary, the seal notice, and the final results |
| `index.html`, `app.js`, `styles.css` | this repo, served at `https://mrg0114.github.io/contest-standings/` | the standings page |
| OneSignal app "Platinum +1 Club" | onesignal.com | web push to anyone who turns notifications on |

## Scoring rules

- Total points, then most points earned (the sum of positive rulings), then fewest points lost. Equal on all three shares the tier.
- Tiers: platinum, zinc, wood.
- Scoring runs from `CONTEST_START` to `CONTEST_END` in `Code.gs`. The last 24 hours are sealed: the page hides the standings, and the final results appear at the end.
- Days follow the group's local clock: Chicago midnight (05:00Z) until departure, Auckland midnight (11:00Z) after landing. The 4-hour and 24-hour changes are rolling windows and ignore the days.

## Setup, in order

1. **Apps Script.** Open the Sheet, Extensions > Apps Script, paste `Code.gs` over the default file. Deploy > New deployment > Web app, execute as Me, access Anyone. Copy the web app URL into `config.js` as `dataUrl`.
2. **Script properties.** Project Settings > Script Properties: `ONESIGNAL_APP_ID` and `ONESIGNAL_REST_API_KEY` (from OneSignal, Settings > Keys & IDs).
3. **Triggers.** In the editor, run `setupTriggers` once. It installs the form-submit trigger and the 5-minute scheduler.
4. **Test.** Run `testPayload` (logs the JSON), `testSchedule` (logs the push times), and `testPush` (sends one test notification).
5. **Page.** Push this repo; GitHub Pages serves `main` from the root. `?demo=1` runs the page on `sample.json`; `?demo=sealed`, `?demo=final`, and `?demo=practice` show the other phases.

## Live values

- Web app: `https://script.google.com/macros/s/AKfycbz9HfhX-Xb_JmhfRE4Pf8ppzuBaus2GZch9GQ-psnHx9PAwenvbK0I6_9cK-acBGPWO/exec` (execute as matt@teamgallagher.net, access Anyone). Version 3, deployed Oct. 22, 2026, 3:40 PM CDT: scoring started 3:26 PM CDT (20:26Z), at the judge's first ruling, so his four rulings from 3:26 to 3:29 PM are the starting points. Competitors frozen as Jen, Kathy, Blas.
- Freeze for the contest: the competitor list is fixed in `Code.gs`, so editing the Form's choices does not change the standings. The Sheet "Form Responses 1" shows a warning on any manual edit. Corrections go in as offsetting entries through the Form. The page (index.html, app.js, styles.css) can change at any time without touching the data.
- Apps Script project "Platinum +1 Club", bound to the Sheet. Triggers installed Oct. 22, 2026. Script property `ONESIGNAL_APP_ID` is set; `ONESIGNAL_REST_API_KEY` is added by hand.
- A code change in the editor needs Deploy > Manage deployments > edit > New version, or the web app keeps serving the old code.
- Some networks block `*.github.io` in DNS (this Mac's Tailscale DNS answers 0.0.0.0). The site itself is fine from public DNS.

## Changing things

- Competitor names: edit the Form's "Competitor" choices. The script reads them from the Form, so old names drop out of the standings on their own.
- Contest name: `CONFIG.NAME` in `Code.gs`, `name` in `config.js`, `manifest.json`, and the OneSignal site name.
- Sponsor banner: `sponsor` in `config.js` (name, link, label, logo). It shows the name in text until `logo` points at an approved logo file; Plex's trademark guidelines require their authorization to display the Plex logo. Bump `config.js?v=` in `index.html` after changing it.
- Artwork: `assets/horse-source.png` is the original icon. `swift tools/make_horse.swift` cuts out `horse.png` (dark theme) and `horse-ink.png` (light theme); `swift tools/make_icons.swift` then builds the Home Screen icons on the wine background. Bump the `?v=` on the icon links in `index.html` and `manifest.json` after changing them.
