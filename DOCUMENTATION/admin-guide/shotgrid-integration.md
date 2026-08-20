# ShotGrid (Flow Production Tracking) integration

Link a ReView project to a ShotGrid project and keep both in step: sequences, shots,
assets, tasks, statuses, schedule and published media flow into ReView, while review
decisions, statuses and dates flow back.

> ShotGrid was renamed **Autodesk Flow Production Tracking**. This guide uses
> "ShotGrid" throughout, as the API and URLs still do.

---

## 1. Before you start

You need a **ShotGrid site address** (`https://yourstudio.shotgrid.autodesk.com`) and
credentials. Two kinds are supported.

### Script key — recommended

A service account created once by a ShotGrid administrator. It survives password
rotations and people leaving, and its actions are attributable in the ShotGrid event
log.

1. In ShotGrid, open **Admin → Scripts**.
2. Create a script, for example `review_sync`.
3. Copy the **Script Name** and the **Application Key** — the key is shown once.
4. Give the script a permission group that can read (and, if you want write-back,
   update) Shots, Assets, Tasks, Versions, Notes and Playlists.

### User login — the Prism-style option

The same approach as the Prism ShotGrid plugin. It is offered as a fallback, but it is
more fragile: it ties the integration to one person's account.

Since the migration to Autodesk Identity, an Autodesk password does **not** work for the
API. Each user must:

1. Enable **Legacy Login** and set a legacy password in
   `https://<your-site>/page/account_settings`.
2. Generate a **Personal Access Token** from the Autodesk profile page.
3. Paste that token into the **Token Code** field of the same ShotGrid page and bind it.

Only then do the login and legacy password work against the API. Note that repeated
wrong passwords lock the ShotGrid account.

---

## 2. Registering a site

Sites are managed studio-wide in **Administration → Communications → ShotGrid**, or
created on the fly from a project. Credentials are encrypted at rest and never returned
by the API — editing a site leaves secret fields blank, and only what you type replaces
the stored value.

The site address must be public HTTPS. Addresses pointing at private networks are
refused, so that no one can make the server probe internal services.

---

## 3. Linking a project

Open a project, then **Settings → ShotGrid**. The **ShotGrid** tab appears only once the
project is linked: a studio that does not use ShotGrid never sees the integration.

1. Choose the site.
2. Search the target project **by name** and select it.
3. Confirm.

The name matters. A studio site hosts every project, often with similar names
("Demo", "Demo 2"). ReView records both the id and the name, re-checks the name before
every synchronisation, and stops if it no longer matches — a renamed or reused id halts
the sync instead of writing into the wrong project.

---

## 4. What is exchanged

The **Settings** section holds a matrix: for each kind of data, whether ReView reads it
from ShotGrid and whether it writes back.

| Data | Read | Write back |
|---|---|---|
| Sequences, shots, assets | codes, cut ranges, shot statuses | shot statuses |
| Tasks | name, pipeline step, status, start/due dates, assignee | status, dates, assignee |
| Status list | the exact statuses of your site, names and colours | — (reference data) |
| Versions and published media | media imported for review | review decisions, new versions |
| Notes | ShotGrid notes as ReView comments | ReView comments as notes |
| Playlists | dailies playlists | dailies playlists |
| People | matched by email address | — (no account is ever created) |

Field notes:

- **Duplicate codes**: a site may hold several entities with the same code (four
  sequences named `DO_NOT_USE_`, say). ReView can only hold one per code, so the extra
  ones are imported with their ShotGrid id appended — `DO_NOT_USE_ (4686)`. The suffix is
  stable, and the comparison ignores it.
- **Cut ranges**: `sg_cut_in` / `sg_cut_out` become the shot's start and end frames.
- **Task duration**: ShotGrid stores working minutes (2400 = five 8-hour days). ReView
  keeps the raw value alongside the link and displays working days.
- **Dates**: start and due dates are pushed together, because ShotGrid recalculates
  duration from whichever one changes.
- **Statuses**: imported with their site colours (ShotGrid encodes them as decimal RGB).

---

## 5. Creating entities

By default, **creating sequences, shots and assets in ReView is refused** on a linked
project: the request returns a link to the matching ShotGrid form, pre-filled with the
right project. This keeps ShotGrid the single place where production structure is
decided.

Turn off *Create in ShotGrid only* in the settings if your studio prefers the opposite.

---

## 5bis. Bringing the crew into ReView

Linking a project brings in its shots, tasks and media — but not the people. The
**Members** tab of a linked project therefore offers **Load the ShotGrid crew**: the list
comes from `Project.users` of the linked project, not from the whole site directory.

Each person shows one of four states:

| State | What it means | What inviting does |
| --- | --- | --- |
| Project member | Already has access here | Records the ShotGrid link, nothing else |
| Has an account | Same email address exists in ReView | Adds them to this project |
| No account yet | Nobody in ReView uses this address | Creates the account, emails the invitation, adds them to the project |
| Cannot be invited | No email, or disabled on the site | Nothing — the row is not selectable |

New accounts are created as **artists**. Promote afterwards, explicitly: an account that
starts as a supervisor is one nobody decided to make a supervisor.

Two rules worth knowing:

- **Creating accounts is reserved to administrators and studio supervisors** — the global
  role, not the project one. A supervisor *of a project* can add people who already have
  an account, but cannot mint new ones; the administration screen does not let them
  either, and going through ShotGrid must not be a way around it.
- The invitation goes through the usual circuit. **Without a configured mail relay
  nothing is sent**, and the panel says so before you click: an account created without
  its activation email is reachable by nobody and holds the address hostage.

The ShotGrid link is recorded at the same time. It is what lets ReView write to the site
*on that person's behalf* rather than as an anonymous « ReView ».

---

## 6. Staying up to date

Three mechanisms work together. You are not expected to choose one and hope.

### Webhooks (near-instant)

Copy the address shown in the settings, then in ShotGrid:

1. Open **Admin → Webhooks → Create Webhook**.
2. Paste the URL.
3. Filter on **the linked project** and on the entity types you care about (Shot,
   Sequence, Asset, Task, Version, Note, Playlist).
4. Set the **secret token** to the one shown in ReView.

ReView answers within milliseconds and processes in the background — ShotGrid requires a
reply within six seconds and counts response time against a site-wide budget.

The address can be renewed at any time; the previous one stops working immediately.

### Polling

If your ReView instance is not reachable from the internet, switch the update mode to
**periodic polling**. ReView reads the ShotGrid event log from its last processed entry.
Slightly delayed, but it needs no inbound connection.

### Catch-up after downtime

Neither of the above survives everything: an instance can be stopped for a night, and
ShotGrid disables a webhook endpoint after a hundred failed deliveries, keeping delivery
logs for only seven days.

So ReView also re-reads a **look-back window** — nightly, and when the instance starts.
Set the window to cover the longest outage you want to survive (72 hours by default).
ShotGrid is the production record: on catch-up, ReView realigns on it.

---

## 7. Comparing both sides

The **Comparison** section reads both sides live and lists every difference, without
changing anything:

- present in ShotGrid, missing in ReView;
- present in ReView, gone from ShotGrid;
- values that diverge, field by field;
- local entities that were never linked.

Use **Realign on ShotGrid** to run a full synchronisation and close the gaps. It is a
separate, explicit action, because overwriting work should be decided rather than
happen quietly.

---

## 8. Published media

New ShotGrid versions carrying media are imported automatically and enter the normal
ReView pipeline (transcoding, thumbnails, frame-accurate review). You can:

- choose between the **ShotGrid transcode** (lighter) and the **original file**;
- cap the size above which media is skipped and logged;
- restrict the automatic import to certain statuses;
- import anything else on demand from the **Published media** section.

A version whose ShotGrid task is unknown to ReView is attached to a per-shot task named
`ShotGrid`, rather than being dropped.

### Media names

An imported media takes the **code of its ShotGrid version** — `SH010_comp_v003.mov` —
rather than the name of the attached file. That code is what production reads in its
playlists and says out loud in dailies, so both tools name the same thing the same way.
The extension always comes from the delivered file (or its content type), never from the
code: it is what tells ReView how to validate, transcode and play the file.

The delivered file name is not lost. It is kept and shown as **Source file** in the
technical sheet of the review — a studio naming convention often carries information the
code does not repeat (colour space, encoding, retake marker).

Two details worth knowing:

- Media imported before this behaviour existed are renamed on the next synchronisation
  that reads their version. Nothing to migrate, nothing to click.
- A file dropped into ReView by hand is **never** renamed, even on a linked project.

Set **Media name** to *Delivered file name* in the settings if your studio would rather
keep the file names as they arrive.

---

## 9. Writing back

- **Review decisions** update the ShotGrid version status through the status mapping.
- **Task statuses, dates and assignments** are pushed when the matching domain is open
  for writing.
- **Publishing in ReView** creates a ShotGrid version — either with a link back to the
  ReView review (default, no duplicated storage) or with the media file uploaded.
- Changes are attributed to the ReView user when their email matches a ShotGrid account.

Writes go through a queue: a ShotGrid outage never makes a local action fail. What could
not be written is logged, and the catch-up pass closes the gap.

---

## 10. Conflicts

If a field changed on both sides between two synchronisations, the policy decides:

- **ShotGrid wins** (default) — the production record prevails, and each overwrite is
  logged;
- **ReView wins** — the local value is kept and pushed back;
- **Ask a human** — the conflict waits in the log for an explicit decision.

---

## 10bis. Site-specific limits

Sites differ, and some restrict what an account may write. Two cases met in the field:

- **`note_links` refused.** When the site does not allow writing note links, ReView
  still posts the note, with the version name in the subject and a link back to the
  ReView review. Ask a ShotGrid administrator to grant the permission if you want notes
  attached to their version.
- **Status codes outside the standard lists.** `rtk`, `pass`, `suprev` and similar
  studio codes are mapped explicitly; an unknown code falls back to *To Do* rather than
  failing the import. Add yours to the mapping if a status lands in the wrong column.

## 11. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| *Authentication refused* | Script name/key wrong, or in user mode: Legacy Login not enabled, or the Personal Access Token not bound to the site. |
| *Remote project name changed* | The linked ShotGrid project was renamed or its id reused. Check the target, then unlink and relink. |
| No events arriving | Check the webhook status in ShotGrid (it is disabled after 100 failures), the secret, and that the URL is reachable from the internet. Switch to polling if it is not. |
| Media not imported | Look at the run log: the version may carry no media, exceed the size limit, or fall outside the status filter. |
| A shot exists in ReView but nowhere in ShotGrid | It was created locally before the link. The comparison lists it as *not linked*. |
| An entity disappeared from ReView | It was moved to the ShotGrid bin. Deletion happens there and propagates here; restore it in ShotGrid and re-synchronise. |
| A task deleted in ShotGrid is still in ReView | It carries versions. Deleting the task would delete that review work with it, so ReView keeps it and logs a warning. Move the versions elsewhere, then re-synchronise. |
| The comparison shows more tasks or versions in ReView | Expected when tasks were kept as above, or when local versions were never pushed (see *publish mode*). |
| Annotations not attached to notes | Check the run log: the media file must still exist in storage, and the site must accept uploads on `Note.attachments`. |

Every synchronisation is recorded with per-domain counters and a filterable log, kept
under **Synchronisation**.

---

## 12. Development without a ShotGrid site

The repository ships a simulator that reproduces the API surface ReView uses:

```bash
node scripts/fake-shotgrid.mjs --port 8890
```

It exposes three projects, two of which deliberately carry entities with identical
codes — the fixture that proves synchronisation never spills into a neighbouring
project. Point a site at `http://localhost:8890` with script `review_sync` and key
`dev-script-key-0000`, after allowing the host:

```bash
SHOTGRID_INSECURE_HOSTS=localhost:8890
```

That variable lifts the HTTPS and private-network checks for the listed hosts only. It
is empty by default and logged loudly at startup — a real ShotGrid site never needs it.

The end-to-end scenario runs with:

```bash
node scripts/test-shotgrid-e2e.mjs
```
