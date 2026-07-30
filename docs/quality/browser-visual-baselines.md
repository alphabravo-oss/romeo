# Browser visual baselines

The visual quality gate compares every route, theme, and viewport in
`browser-visual-baseline-contract.json` with committed Chromium PNGs. It fails
on missing baselines, dimension changes, runtime or hydration errors,
horizontal overflow, and pixel differences above the contract threshold.

To review an intentional visual change:

1. Start the app with seeded login enabled.
2. Run `ROMEO_BASE_URL=http://127.0.0.1:3000 pnpm test:browser:visual:update`.
3. Inspect every changed PNG under `docs/quality/browser-visual-baselines/chromium`.
4. Run `ROMEO_BASE_URL=http://127.0.0.1:3000 pnpm test:browser:visual` to prove
   the committed images reproduce cleanly.

Failed comparisons write actual and diff images to
`dist/ci/browser-visual-baselines`; those artifacts are never used as the
expected result.
