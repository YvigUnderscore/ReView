# Contributing to ReView

Thanks for considering a contribution. This page covers the licensing side; the technical
conventions live in [DOCUMENTATION/development/](DOCUMENTATION/development/).

## License of the project

ReView is distributed under the **GNU Affero General Public License v3.0 or later**
(see [LICENSE](LICENSE)). Anything merged here ships under that license.

## Contributor License Agreement — required

Before a pull request can be merged, you must sign the
[Contributor License Agreement](CLA.md).

**You keep the copyright on your work.** The CLA grants the maintainer a broad license,
including the right to sublicense, so that ReView can keep being offered both under the
AGPL and under a commercial license for studios that cannot accept the AGPL's obligations.
Without it, a single external contribution would permanently block that model.

To sign: read [CLA.md](CLA.md) and state in your pull request

> I have read CLA.md and I agree to it.

along with your full name and email. Contributing on behalf of a company? Have someone
authorised to bind it use the entity form in the same file.

## Translations — the easiest way in

ReView ships in fourteen languages, and **every one except English was machine-translated
with no human proofreading**. Wording is very likely clumsy or wrong somewhere.

If you speak one of them, fixing a string is a one-line edit in a JSON file — no build
step, no framework to learn:

```bash
# frontend/src/v2/i18n/messages/<code>.json   — interface
# backend/src/i18n/messages/<code>.json       — emails and notifications
node scripts/check-translations.mjs
```

This matters most for the **regional languages ReView stands up for** — Breton, Basque,
Corsican, Alsatian and Occitan. They have far fewer speakers reviewing software strings
than English does, and one native speaker reading through a catalogue changes everything.

**Proposals for new languages are just as welcome**, regional or otherwise. Adding one is
three steps, and untranslated keys fall back to English so a partial catalogue is useful
immediately. Two rules to keep in mind: keep `{placeholders}` intact, and leave production
terminology (`shot`, `sequence`, `dailies`, `playblast`, `version`, `annotation`, `review`,
`board`, `retake`) in English — artists read those words in English in every pipeline.

Full conventions: [DOCUMENTATION/development/i18n.md](DOCUMENTATION/development/i18n.md).

## Source file headers

Every source file carries an SPDX header. New files get theirs automatically:

```bash
node scripts/add-license-headers.mjs
```

Keep your own copyright line if you want one — add it *above* the existing
`SPDX-FileCopyrightText` line rather than replacing it.

## Third-party dependencies

Adding a dependency means redistributing it, so it must be AGPL-3.0 compatible. In
practice: MIT, BSD, ISC, Apache-2.0, MPL-2.0 and the public-domain-equivalents are fine;
proprietary, source-available (BSL, Elastic, Commons Clause) and GPL-incompatible licenses
are not. After `npm install`, refresh the notices:

```bash
node scripts/generate-notices.mjs
```

## Before opening a pull request

```bash
bash scripts/validate.sh
```

The suite must be green. It checks formatting, types, lint, unit tests, builds, the route
size budget, the SPDX headers, the freshness of `THIRD-PARTY-NOTICES.md` and the
consistency of the translation catalogues. Never disable, skip or delete a test to make it
pass — extend the suite, never weaken it.
