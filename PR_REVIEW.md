# Color Warper implementation and verification

Updated 2026-09-09 on branch `feat/color-warper`, based on upstream `97fada36`. Changes are local and uncommitted; nothing has been pushed or submitted as a PR. The original addition remains backed up in the stash named `color-warper backup before upstream sync 2026-09-08`.

**Implemented from the review:**

1. Identity/reset, lock-only, plot-setting, and bypass states no longer mark otherwise untouched images as visibly edited. Sidecar persistence is independent of that visual-edit flag.
2. Rust and frontend normalization agree on default grid 7, default chroma range 0.2, accepted ranges/grids, angle normalization, lock-array validation, malformed data, and schema-1 control migration. Hidden sections retain their plot coordinates while bypassing image changes.
3. Pointer return-to-origin, Escape, pointer cancellation, lost capture, and unmount restore the baseline appropriately. Image/grid changes reset selection via component keys. Secondary pointers/buttons cannot hijack a drag.
4. Distribution results carry unique request IDs through Tauri and analytics. Only current successful results are accepted; failed/lost results retry up to three attempts. Distribution jobs survive histogram coalescing, and readback errors are logged.
5. All 13 locales contain the warper labels, help, and accessible node names. Unrelated locale reordering and empty translations were removed; a semantic diff confirms that only warper keys changed.
6. The two failing frontend tests were repaired. Added regression coverage for normalization, unsupported-state retention, edited-state classification, caching equivalence, and stale/failed distribution requests.
7. New-file lint/format issues and trailing whitespace were fixed. The local reference directory is excluded through `.git/info/exclude` instead of a PR change to `.gitignore`.
8. Distribution signatures are only computed for idle requests with the panel open. Immutable image payloads use version tokens instead of copied/serialized pixels. Rust skips identity lattice solves and caches the last deformation per processing thread. Plot backgrounds are cached separately from density overlays and painted before display; closed warper controls unmount.
9. Added visible plane/axis labels, accessible button/node names, keyboard selection/nudging, shortcut isolation from application navigation, translated help, and [usage/state documentation](docs/color-warper.md). README links to that documentation.

**Verification:**

| Check | Result |
| --- | --- |
| Frontend unit tests | 21 passed. |
| Rust warper tests | 9 passed, including WGSL validation. |
| Frontend production build | Passed; existing bundle-size warning remains. |
| Native Windows debug build | Passed. |
| Clippy, default features, all targets | Passed with `-D warnings`. |
| Rustfmt; Prettier on edited frontend code; Git whitespace | Passed. |
| TypeScript | 76 diagnostics, same count and file/error-code counts as upstream. |
| ESLint, excluding local reference fixtures | 877 errors / 52 warnings versus upstream's 880 / 52; no new production-code findings. |
| Translation runtime validation | 88 pre-existing issues, down from the addition's 243. |
| Translation extraction | Existing unrelated missing keys still fail globally; no missing warper keys. |
| Native PNG exports | Absent, identity, and bypassed warpers produce byte-identical files. Active deformation produces a different image. |
| Browser controls | Real pointer drag/return/Escape, keyboard nudge, undo/redo, image/grid switching, and layout verified using the actual component in an isolated fixture. No runtime errors or horizontal overflow at 375px width. |

The full all-features Clippy invocation cannot compile on Windows because upstream's tethering feature references `gphoto2`, whose dependency is configured for supported Unix targets. The normal Windows feature set passes; Linux/macOS tethering builds remain unverified.

The export fixture is a generated 128×96 RGB PNG, processed through RapidRAW's native headless export command. SHA-256 of absent/identity/bypass output: `F924CD7946164471E86E8E5CF4F60680AC5DD5C9A923F38F7CEE67F955EACF12`. Active output: `9083C7B2F58551B949D5D03987DA6A45AD7B6BFE4893AA64D77EC92478845DE0`. The native application was built before the final analytics-queue-only change; the final Rust source also passed unit tests and Clippy.

A synthetic Node benchmark with one immutable 5 MiB patch and a 13×13 mesh measured signature construction over 30 iterations: about 2.65 ms previously versus 0.008 ms now, with output shrinking from about 5 MiB to 247 characters. This measures signature work only, not end-to-end preview frame rate.

Local evidence: [desktop controls](reference/warper-verification/desktop.png), [mobile controls](reference/warper-verification/mobile.png), [benchmark](reference/warper-verification/signature-benchmark.json), and export PNGs/logs in `reference/warper-verification/`. The screenshots show the component test fixture, not the native application. Logs are retained in `.git/implementation-*`. The original review is retained in `.git/review-before-implementation.md`.

**Before submitting upstream:**

- Keep Vitest and Naga regression tests in the proposed change, but explicitly resolve the template's no-added-tests convention with the maintainer. No maintainer message has been sent and no compliance checkbox should be falsely checked.
- Obtain human testing in the native editor, especially RAW files, real GPU distribution updates, preview/export/thumbnail consistency, masks, crop/transform, LUTs, presets/copy-paste round trips, touch devices, and supported platforms. Automated component checks and one synthetic PNG export do not establish those outcomes.
- Attach screenshots/recordings and an accurate AI involvement statement. This review and local fixture artifacts need not be included in the feature PR.

The temporary upstream comparison worktree from the previous review remains at `C:\Users\konra\AppData\Local\Temp\rapidraw-upstream-review-97fada36`; its cleanup was previously rejected by automatic approval review.
