# What this changes

<!-- One paragraph: what the change does and why. Link the issue it closes, if any. -->

## How it was verified

<!-- Tests added, and what you exercised by hand (browser, docker stack, media used). -->

## Checklist

- [ ] `bash scripts/validate.sh` is green. The suite is never disabled, skipped or
      narrowed to make a change pass — extend it instead.
- [ ] New code comes with tests, and no existing test was commented out, skipped or deleted.
- [ ] No text reaches the screen hard-coded: every visible string goes through `t()`, and
      new keys were added to all fourteen catalogues with `node scripts/i18n-add.mjs`.
- [ ] New source files carry their SPDX header (`node scripts/add-license-headers.mjs`).
- [ ] New dependencies are AGPL-3.0 compatible, and `node scripts/generate-notices.mjs`
      was re-run.
- [ ] `DOCUMENTATION/` is up to date for anything user-visible this change adds.

## Contributor License Agreement

Merging requires a signed CLA — see [CONTRIBUTING.md](../CONTRIBUTING.md). Copy the line
below into this pull request, with your full name and email, once you have read
[CLA.md](../CLA.md):

> I have read CLA.md and I agree to it.
