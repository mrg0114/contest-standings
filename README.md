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

## Changing things

- Competitor names: edit the Form's "Competitor" choices. The script reads them from the Form, so old names drop out of the standings on their own.
- Contest name: `CONFIG.NAME` in `Code.gs`, `name` in `config.js`, `manifest.json`, and the OneSignal site name.
- Icons: `swift tools/make_icons.swift` from the repo root.
