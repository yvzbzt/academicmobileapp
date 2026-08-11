> [!WARNING]
> **HISTORICAL AUDIT — SUPERSEDED.** This report records a dated Cloud Run and
> source-retrieval snapshot from 2 July 2026. Use the current
> [test strategy](../05-test-strategy.md),
> [mobile-native test matrix](../mobile-native-redesign/TEST_MATRIX.md), and
> source registries for current behavior.

# Playwright University Retrieval Audit

Date: 2026-07-02
Backend URL: `https://academic-calendar-api-qrld4semgq-ew.a.run.app`
Final Cloud Run revision: `academic-calendar-api-00027-ker`
Runner: Playwright, 10 workers, 205 university tests
Final run result: 205 passed in 16.4 minutes

## Artifacts

- Test spec: `tests/e2e/university-retrieval-audit.spec.ts`
- Per-university worker: `scripts/audit-single-university-retrieval.ts`
- Raw per-university results: `.tmp-test-run/playwright-university-audit/*.json`
- Aggregate summary: `.tmp-test-run/playwright-university-audit-summary.json`
- Backend-only checks for timed-out workers: `.tmp-test-run/playwright-hard-timeout-api-check.json`

## Fixes Applied Before Final Run

1. Added a 205-university Playwright audit that runs with the requested 10-worker setup.
2. Added a per-university worker process so Nest decorators do not break Playwright test collection.
3. Added a hard timeout result writer so hanging sites are reported as findings instead of losing the result.
4. Fixed academic-year inference:
   - `2026-2025` is normalized to `2025-2026`.
   - future years such as `2027-2028` are rejected on 2026-07-02.
   - current acceptable years are preferred when PDF text mentions future application periods.
5. Fixed wrong-domain calendar discovery:
   - the calendar crawler now validates guessed homepage candidates against the target university.
   - one-token universities no longer generate broad acronym domains such as `mu.edu.tr`.
   - this stopped Marmara, MEF, Mersin, and Munzur from receiving Mugla's PDF.

## Verification Spot Checks

- `abdullah-gul-universitesi-kayseri`: API now returns `2025-2026`, 83 events.
- `tokat-gaziosmanpasa-universitesi`: API now returns `2026-2027`, 190 events.
- `mugla-sitki-kocman-universitesi`: API returns its own `mu.edu.tr` calendar, 200 events.
- `marmara-universitesi-istanbul`: API now returns 404 instead of Mugla's calendar.
- `mef-universitesi-istanbul`: API now returns 404 instead of Mugla's calendar.
- `mersin-universitesi`: API now returns 404 instead of Mugla's calendar.
- `munzur-universitesi-tunceli`: API now returns 404 instead of Mugla's calendar.
- `selcuk-universitesi-konya`: API returns `2025-2026`, 111 events.

## Final Counts

Announcements:
- Source found: 166 / 205
- Homepage found but no parseable items: 8 / 205
- Homepage not reachable/found: 8 / 205
- Audit worker hard timeout: 23 / 205

Academic calendar source discovery:
- Source found: 111 / 205
- Source not found or rejected: 71 / 205
- Audit worker hard timeout: 23 / 205

Deployed calendar API from the Playwright run:
- 200 OK: 95 / 205
- 404 not available: 87 / 205
- Worker timed out before API verification: 23 / 205
- 200 OK with zero events: 0
- Bad academic-year labels after fix: 0

Backend-only check for the 23 worker timeouts:
- 21 returned 404.
- 2 still aborted after 180 seconds: `dokuz-eylul-universitesi-izmir`, `istanbul-arel-universitesi`.

## Main Remaining Problems

1. Department/faculty-specific retrieval is not implemented.
   - The current backend discovers university-level announcement and calendar sources only.
   - Users can select faculty/department, but the crawler does not map those selections to faculty/department source pages.
   - This is the main reason some department-specific calendars or announcements cannot appear.

2. Calendar discovery coverage is incomplete.
   - 71 universities do not produce an acceptable current PDF source in the current crawler.
   - Common causes:
     - source exists behind JS-rendered pages or hidden APIs,
     - source is a non-PDF format such as Google Sheets,
     - source links are stale or nonstandard,
     - homepage blocks/redirects the crawler.

3. Calendar parse/publish pipeline still fails for some discovered PDFs.
   - 17 universities had a source found locally, but the deployed API still returned 404.
   - This means discovery can see a candidate PDF, but ingestion does not publish usable events.
   - Examples: `afyonkarahisar-saglik-bilimleri-universitesi`, `ankara-medipol-universitesi`, `ege-universitesi-izmir`, `izmir-bakircay-universitesi`, `karadeniz-teknik-universitesi-trabzon`, `samsun-universitesi`.

4. Some crawls hang on live university sites.
   - 23 universities hit the 120-second audit hard timeout.
   - The crawler needs stricter per-phase budgets and probably site-specific adapters for these.
   - Direct backend checks show most of these currently return 404; two still abort at API level.

5. Stale or ambiguous sources still need stronger rejection.
   - Some candidate URLs contain old years or single-year filenames that are not reliably rejected by the current source scoring.
   - These are not being published as valid calendars in the final API run, but they still appear in source audit output and should be cleaned up.

## Timed-Out Worker Slugs

`aydin-adnan-menderes-universitesi`, `bitlis-eren-universitesi`, `dokuz-eylul-universitesi-izmir`, `erzincan-binali-yildirim-universitesi`, `fatih-sultan-mehmet-vakif-universitesi-istanbul`, `halic-universitesi-istanbul`, `harran-universitesi-sanliurfa`, `ihsan-dogramaci-bilkent-universitesi-ankara`, `istanbul-arel-universitesi`, `istanbul-aydin-universitesi`, `istanbul-bilgi-universitesi`, `istanbul-gelisim-universitesi`, `istanbul-medipol-universitesi`, `istanbul-rumeli-universitesi`, `istanbul-teknik-universitesi`, `istanbul-ticaret-universitesi`, `istanbul-universitesi-cerrahpasa`, `istanbul-universitesi`, `kirikkale-universitesi`, `marmara-universitesi-istanbul`, `piri-reis-universitesi-istanbul`, `toros-universitesi-mersin`, `turk-hava-kurumu-universitesi-ankara`.

## Source Found But API Returned 404

`afyonkarahisar-saglik-bilimleri-universitesi`, `ankara-medipol-universitesi`, `burdur-mehmet-akif-ersoy-universitesi`, `cankiri-karatekin-universitesi`, `demiroglu-bilim-universitesi-istanbul`, `ege-universitesi-izmir`, `istanbul-saglik-ve-sosyal-bilimler-meslek-yuksekokulu`, `izmir-bakircay-universitesi`, `izmir-yuksek-teknoloji-enstitusu`, `karadeniz-teknik-universitesi-trabzon`, `kayseri-universitesi`, `kirsehir-ahi-evran-universitesi`, `kutahya-saglik-bilimleri-universitesi`, `lokman-hekim-universitesi-ankara`, `malatya-turgut-ozal-universitesi`, `ozyegin-universitesi-istanbul`, `samsun-universitesi`.
