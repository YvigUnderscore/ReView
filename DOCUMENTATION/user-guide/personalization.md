# Personalization

*Theme, language, density, the Home layout, shortcuts and alerts — what each one changes, and which machine remembers it.*

> Updated: 2026-08-26

Two people never use ReView the same way. A compositor wants a dark, compact window with the
media as large as it goes; a producer wants the Home page to open on figures and a task list.
Almost none of that is negotiated in a settings maze: it is one **Profile** page, a
**right-click** on the thing you want to change, and a handful of keys.

What follows is that page, block by block, plus the two questions people actually ask about
it — *where does this setting live*, and *why did it not follow me to the other machine*.

## Where a setting is kept

Three layers, and they do not mean the same thing.

![Three stacked layers: a narrow browser layer holding the theme, the recently visited list, the push subscription and the changelog marker; a wide account layer holding language, density, shortcuts, saved views, the Home layout, the onboarding flag, the two email subscriptions and the last annotation colour; and a studio layer whose language default only applies to accounts that never chose.](../assets/user-guide/where-preferences-live.svg)

| Setting | Kept | Reached from |
|---------|------|--------------|
| Theme | **This browser** | Profile → Display, sidebar footer, `Ctrl/Cmd + K` |
| Recently visited (last 5) | **This browser** | Recorded automatically from the breadcrumb |
| Push subscription | **This browser** | Profile → Notifications |
| *What's new* read marker | **This browser** | Opening the panel |
| Language | **Your account** | Profile → Display (the sign-in page picker sets this browser only) |
| Density | **Your account** | Profile → Display |
| Keyboard shortcut overrides | **Your account** | The `?` panel |
| Saved list views (per list) | **Your account** | The **Saved views** menu of a filter bar |
| Default list view (cards or compact) | **Your account** | Profile → Display |
| Per-list view override | **Your account** | The cards/compact toggle of that list |
| Home layout | **Your account** | Right-click the Home background |
| Onboarding seen | **Your account** | Finishing or skipping the tour |
| Daily digest, weekly report | **Your account** | Profile → Notifications, unsubscribe link |
| Last annotation colour | **Your account** | The colour picker in a review |
| Favourites | **Your account** | The star, or right-click → Pin |
| Default language, accent colour, logo | **The studio** | Administration (administrators only) |

Everything on the account layer travels: sign in on a workstation you have never used and it
already has your language, your density, your shortcuts, your views and your Home layout. The
studio default only fills a gap — an account that never chose a language reads the interface
in whatever the browser asks for, and receives its **emails** in the studio's language.

> [!NOTE]
> An explicit choice made **in a browser** is never overwritten by the account value. Set
> *Compact* on the review workstation and it stays compact there, even if you later switch
> the laptop back to *Comfortable*. A browser that has never been told anything is the one
> that adopts the account setting.

## Cards or compact, everywhere and per list

Two levels, and they answer two different questions.

- **Default list view** (Profile → Display) applies to every list. Someone who prefers dense
  rows prefers them everywhere.
- **An override on one list**, set by clicking the cards/compact toggle of that list. A grid
  of shots reads in thumbnails, a task list in rows: one setting cannot answer for both.

A list with no override follows the account. Once it has one, a third button appears in its
toggle — **Follow the account setting** — because otherwise nothing would tell you an override
exists, nor how to lift it.

Both levels travel with your account, so a workstation you have never used already shows each
list the way you left it.

## Display: theme, density and language

Open **Profile → Display**. Three rows, each applying immediately, with no *Save*.

| Row | Values | Default | Effect |
|-----|--------|---------|--------|
| **Theme** | *System*, *Light*, *Dark* | *Dark* | *System* follows the OS and keeps following it if the OS flips while you work |
| **Density** | *Comfortable*, *Compact* | *Comfortable* | Root font size `16px` → `15px`, so every size in the interface follows |
| **Language** | 14, each written in its own language | Negotiated from your browser | Switches on the spot, and decides the language of your emails |

The theme is applied **before the first paint**, from this browser's own storage, so a reload
never flashes white on the way to dark. Two shortcuts reach it without opening the profile:
the light/dark button in the sidebar footer, and *Toggle theme* in the command palette
(`Ctrl/Cmd + K`). Both pin an explicit *Light* or *Dark* — go back through Profile → Display
to return to *System*.

> [!TIP]
> A colourist checking a shot on a calibrated display wants *Dark* plus *Compact*: the media
> takes the maximum area and the chrome around it stays neutral. Doing that on the review
> workstation costs nothing to the laptop, which keeps its own theme.

## Fourteen languages, and what a half-translated one looks like

English is the base language: it defines every key, and every other catalogue falls back to
it **key by key**. That is what makes a partial translation usable rather than broken — an
untranslated string appears in English inside an otherwise translated screen, instead of
showing a raw identifier or nothing at all.

![On screen the first match wins: a language chosen in this browser, then the one kept on your account, then a language the browser asks for, then English; inside the chosen catalogue an untranslated key falls back to its English entry. Emails have no browser to ask, so they follow the account language, then the studio default.](../assets/user-guide/language-resolution.svg)

| | Languages |
|---|-----------|
| **General** | English, Français, Español, Deutsch, Português, 简体中文, 한국어, 日本語, हिन्दी |
| **Regional** | Brezhoneg, Euskara, Corsu, Elsässisch, Occitan |

The picker groups regional languages separately, on purpose: it is how they stay visible
instead of being drowned in an alphabetical list. Only the catalogue you are using is
downloaded, so a fourteenth language costs the other thirteen nothing.

The same picker sits on the **sign-in page**, where there is no account to write to yet: the
choice made there applies to that browser, and picking one again from your profile afterwards
is what attaches it to the account — and therefore to your emails.

Under the picker sits a permanent notice, and it is worth reading once. Every catalogue other
than English is **machine-translated and has not been proofread by anyone**. When the language
you picked is incomplete the notice also counts it — *n of N strings translated* — and links
to the source code of this instance, which is where a correction is proposed. Saying it
plainly is deliberate: a studio should not mistake a clumsy phrase for a product decision.

> [!IMPORTANT]
> Production vocabulary is **never** translated, in any language: shot, sequence, dailies,
> playblast, version, annotation, review, board, kanban, retake. Artists read those words in
> English in every pipeline they touch, and a translated `shot` would be a false friend in a
> spreadsheet. Dates and numbers, on the other hand, follow your language everywhere.

## Your identity, and what others see

**Profile → Identity** carries what colleagues see on your member page: first name, last name,
username, **job title**, **phone** and a short **bio** (500 characters). Above it, the avatar
accepts PNG, JPEG or WebP and can be removed again in one click; without one you keep the
generated initials tile.

Your **email address** is on the same card, but it is your sign-in identifier, so changing it
— like changing your password, one card below — requires your **current password** in the
field provided. A password is 8 to 128 characters with at least one letter and one digit.

> [!WARNING]
> Changing your password **or** your login email signs out every other device and revokes all
> of your personal API tokens. That is the point: it is how taking your account back actually
> takes it back. The session you are using survives, so you are not thrown out of the page you
> just used. See [Account security](account-security.md#active-sessions).

Where those fields end up, and who is allowed to read them, is covered in
[Messaging & member profiles](messaging-and-profiles.md).

## The Home page, block by block

Home (`/`) is a twelve-column grid of five blocks, and the arrangement is yours. Enter edit
mode from the *Customise the home page* button in the header, by **right-clicking the page
background**, or
by right-clicking a block.

| Block | Default width | Widths offered | Shapes |
|-------|--------------:|----------------|--------|
| **Statistics** | 12 | 6, 8, 12 | KPI |
| **Projects** | 12 | 4, 6, 8, 12 | grid, list |
| **My tasks** | 6 | 4, 6, 8, 12 | list |
| **Latest reviews** | 6 | 4, 6, 8, 12 | list |
| **Activity** | 6 | 3, 4, 6, 8 | list |

In edit mode every block gains a handle and its own settings: **width**, **height** (short,
normal or tall), **density**, **shape** where it has more than one, and **bare** — no frame,
no header, the block flush against the page, which is what makes a stripped-down Home
possible. Blocks are reordered by drag-and-drop. Hiding one puts it in a catalogue of removed
blocks shown at the bottom of the page while editing, and in the *Add* submenu of the
right-click menu; **Reset layout** puts everything back. Outside edit mode there are no
handles, no dashed borders and no permanent shelf — it is a page, not a workshop.

The whole arrangement lives on your account, so it follows you between machines.

Next to that button, a compact **resume** chip appears when this browser has a review in
its recently visited list, and takes you straight back to that media. It is per browser, like
the recents it reads, and it names the media rather than a task.

## Keyboard shortcuts (configurable)

Press **`?`** anywhere to open the shortcut panel.

| Keys | Action | Rebindable |
|------|--------|------------|
| **`Ctrl / Cmd + K`** | Open (or close) the command palette | No |
| **`g` then `p`** | Go to Projects | Second key |
| **`g` then `k`** | Kanban of the current project | Second key |
| **`g` then `b`** | Board of the current project | Second key |
| **`?`** | Open the shortcut panel | Yes |
| **`Escape`** | Clear the current multi-selection | No |

In the **Navigation** section of the panel, click a key and press the new one. The capture
rules are strict on purpose:

- the leader `g` is fixed, and `g` itself is never accepted as a second key;
- the override must be a **single character**; anything else is refused with a message;
- a key already taken by another shortcut of the same kind is refused rather than silently
  shadowing it;
- `Escape` cancels the capture, and a small revert arrow next to any key you changed puts the
  default back;
- an override that has gone stale — emptied, several characters long, or `g` — is **ignored**
  at load time and the default key applies, so a shortcut never goes dead.

`g k` and `g b` do nothing when no project is in context, and every global shortcut is inert
while you are typing in a text field or while a dialog is open. The same panel also lists the
review shortcuts — transport, tools, the splat editor — which are handled by the viewers and
are **not** rebindable; see [Review workspace](review-workspace.md).

## Saved list views

A **view** is a named set of filters. Set the filters you want on a list, open the **Saved views**
menu in the filter bar, type a name, save. Recalling one is a click, and the menu shows the
active view's name on its own trigger.

| List | Scope key |
|------|-----------|
| Reviews | `reviews` |
| Shots of a project | `shots:<projectId>` |
| Assets of a project | `assets:<projectId>` |
| Kanban of a project | `kanban:<projectId>` |

- Saving under an existing name **replaces** it; matching ignores case and surrounding spaces,
  so *"My retakes"* and *"my retakes "* are the same view.
- Empty criteria are dropped before saving, so two views built differently but filtering
  identically are recognised as the same and neither one lights up by accident.
- Views are per account **and** per scope: a preset built on the Shots tab of one project
  never appears in another.

> [!TIP]
> A supervisor keeps two views on the Reviews list — *"Waiting on me"* and *"Retakes this
> week"*. Switching between them is one click instead of three dropdowns, on any machine they
> sign in from.

## Favourites and recents

**Favourites** are the star on a project, sequence, shot or asset — from the header of its
page, or by right-clicking its card. Pinned items sit in the sidebar on every page. They are
kept on your account and re-checked against your access: a pin on something you lost access
to, or that was trashed, simply stops appearing.

**Recently visited** is the last five entities, kept **in this browser only**, deduplicated
and newest first. It is what feeds the resume chip on Home. Live-session parameters are
stripped from the stored address, so a recent never drops you back into somebody else's live
review. Both gestures are detailed in
[Navigation & search](navigation-and-search.md#favourites-recents-and-the-home-page).

## Notifications

**Profile → Notifications** carries three switches, in this order.

| Switch | Who sees it | Default | Arrives as |
|--------|-------------|---------|-----------|
| **Daily digest** | Everyone | Off | One email a day |
| **Weekly production report** | Supervisors and administrators | Off | One email on Monday |
| **Push notifications (browser)** | Everyone, on a browser that supports it | Off | A system notification, per browser |

Both emails are **opt-in**: nothing is sent until you tick the box. The **digest** goes out
once a day, at the hour set for the instance (07:00 by default), and summarises the last
24 hours project by project — new versions, new media, new comments with an excerpt. The
**weekly report** leaves on Monday at the same hour and covers the whole studio, which is why
it is offered to supervisors and administrators only. Neither is ever sent empty: a day, or a
week, with nothing to report produces no email at all.

Because those two are the only recurring messages, they are the two that carry a **one-click
unsubscribe**. Your mail client's *Unsubscribe* button flips exactly the switch you see on this
page, and following the link by hand opens a small confirmation page instead of unsubscribing
on sight — link previewers and antivirus gateways fetch links on their own, and a preview must
not unsubscribe you. Turning it back on is one tick here.

**Push** alerts you when ReView is not the active tab: the notifications you would see on the
bell, plus direct messages. Enabling asks the browser for permission, and a refusal there is
reported back rather than failing silently. On a browser that does not support push there is
**no control at all** — a one-line message takes its place. Nothing has to be configured on
the server for this to work: the signing key pair is generated and kept on first use.

> [!TIP]
> An artist who lives in a DCC all day turns push on and leaves the digest off: the alert that
> matters arrives immediately, and the recap that does not, never arrives at all.

## First sign-in, and what changed since

On first sign-in a five-step tour introduces navigation, reviewing, personalization and help.
Skip it at any point — closing it counts as finishing it, and the account remembers, so it
never comes back.

The **What's new** panel (the sparkle in the sidebar footer) lists the product changelog, most
recent first. A dot marks entries you have not read; opening the panel clears it, in this
browser. When the changelog cannot be read at all the button is not shown, rather than opening
an empty panel.

For a change that must be noticed once rather than found later, an administrator can post an
[announcement](../admin-guide/smtp-and-announcements.md#announcements), which appears as a
banner across the top of Home.

## Related pages

- [Account security](account-security.md) — two-factor authentication, sessions, API tokens
- [Navigation & search](navigation-and-search.md) — the palette, right-click, favourites
- [Messaging & member profiles](messaging-and-profiles.md) — where your identity is shown
- [Review workspace](review-workspace.md) — the viewer shortcuts listed in the same panel
- [Internationalisation](../development/i18n.md) — how the catalogues are built and checked
