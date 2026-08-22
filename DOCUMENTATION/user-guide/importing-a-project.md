# Importing a project from a CSV file

> Updated: 2026-08-22

Between `docker compose up` and the first dailies there is one step: getting your shot
list in. The CSV import is that step. It reads the spreadsheet a production coordinator
already keeps — or the export of ShotGrid, ftrack or Kitsu — creates the episodes,
sequences, shots and tasks it describes, and can be replayed as many times as you like
without ever duplicating anything.

Open it from the project header: **Import CSV**. The action is reserved to project
managers (effective project `SUPERVISOR`).

## The three steps

1. **Give it the file.** Drop a `.csv` onto the dialog, pick one with the file field, or
   paste the content into the text area. **Template** downloads a valid file with every
   supported column, filled with two example rows.
2. **Check the columns.** The preview shows which column of *your* file feeds which field
   of ReView, and lets you change any of them — including setting one to *Ignored*. You
   never have to rewrite a header.
3. **Read the preview, then import.** The dialog says exactly what will be created,
   updated and left alone, lists the rejected rows with their reason, and only then
   enables the **Import** button. Nothing is written before you press it.

## Columns

The header row is required; column order is free. Header matching ignores case, accents,
spaces and underscores, so `Cut In`, `cut_in` and `CUTIN` are the same column. Only
**shot** is mandatory.

| Field | Recognised headers | Applies to |
|-------|--------------------|------------|
| Episode | `episode`, `ep`, `episode_code`, `sg_episode` | sequence |
| Sequence | `sequence`, `seq`, `sq`, `sequence_code`, `sg_sequence`, `scene` | shot |
| **Shot** (required) | `shot`, `shot_code`, `plan`, `sg_shot`, `code` | — |
| Name | `name`, `shot_name`, `title`, `label` | shot |
| Description | `description`, `desc`, `notes`, `brief`, `synopsis` | shot |
| Shot status | `shot_status`, `status_shot` (or a bare `status`, see below) | shot |
| Start frame | `start_frame`, `frame_in`, `cut_in`, `head_in`, `first_frame`, `in` | shot |
| End frame | `end_frame`, `frame_out`, `cut_out`, `tail_out`, `last_frame`, `out` | shot |
| Duration | `frames`, `duration`, `length`, `nb_frames`, `cut_duration` | shot |
| Tasks | `task`, `tasks`, `task_name`, `sg_task`, `activity` | task |
| Department | `department`, `dept`, `discipline`, `step`, `pipeline_step`, `sg_step` | task |
| Task status | `task_status`, `status_task` (or a bare `status`, see below) | task |
| Assignee | `assignee`, `assigned_to`, `artist`, `owner`, `sg_assigned_to` | task |
| Start date | `start_date`, `begin`, `date_debut`, `task_start` | task |
| Due date | `due_date`, `due`, `deadline`, `end_date`, `delivery` | task |
| Tags | `tags`, `keywords`, `labels` | *recognised, not stored* |

A column that matches nothing is reported as a warning and ignored — the file is never
refused because it carries extra columns.

**A bare `status` column** (also `state`, `sg_status_list`) does not say what it is the
status *of*. It is read as the **task** status when the file has a task column, and as
the **shot** status otherwise. Use `shot_status` / `task_status` when a file carries
both.

## One row per task is normal

Trackers export a shot once per task. Rows that name the same shot — same sequence, same
code — are therefore **merged into one shot**, and their tasks are collected. The first
non-empty value wins for shot-level fields; a later row that says something different is
reported as a warning, never as an error.

```csv
sequence,shot,name,task,assignee
SQ010,SH0010,Rooftop,Anim,mia@studio.tld
SQ010,SH0010,,Comp,leo@studio.tld
```

That file creates **one** shot with **two** tasks.

Alternatively, several tasks fit in one cell, separated by `|`:

```csv
sequence,shot,name,tasks
SQ010,SH0010,Rooftop,Anim|Comp
```

## Value formats

- **Delimiter**: comma, semicolon or tab, whichever dominates the header. Quoted fields
  and doubled quotes are handled, so `"Rooftop, wide"` stays one value.
- **Numbers**: whole numbers. Spaces and thousands separators produced by spreadsheets
  (`1 001`, `1,001`) are accepted; anything else is a warning and the field is skipped.
- **Dates**: `YYYY-MM-DD`, `YYYY/MM/DD`, `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY`. The
  day comes first, never the month — convert US-style dates before importing, otherwise
  deadlines would move silently.
- **Frame range**: give two of the three among start, end and duration. With a start, the
  end is derived from the duration; with neither bound, the project's first frame is used
  as the origin. If all three are present and disagree, the explicit range wins and the
  mismatch is reported.
- **Status, department, assignee** are resolved against what the project already knows —
  status by code or name, department by key or name, a person by e-mail, username or
  full name. An unknown value is a warning: the row is still imported, that one field is
  left empty.
- **Episodes** are only read when the project has the [Episode
  level](projects-and-pipeline.md#episodes-series) switched on. Otherwise the column is
  ignored with a warning; the import is not refused.
- **Tags** are recognised so they are not mistaken for a typo, but ReView does not store
  tags on a shot yet, so the column is dropped.

## Replaying a file

Import is **idempotent**. Identity is the same as the database's own uniqueness rules:
a sequence is its code, a shot is `(sequence, code)`, a task is `(shot, name)` — all
case-insensitive. Running the same file twice therefore reports every line as
*Unchanged* and writes nothing.

When a value did change, only that value is written: the preview lists the shot as
*Changed* and the import updates the changed fields alone. **An absent column never
erases anything** — a file with only `shot` and `due_date` touches due dates and nothing
else. An import is not a replacement.

Nothing is ever deleted by an import. Removing a shot from the file does not remove it
from the project.

## The report

Every warning and every rejected row carries the file line number, the column and the
offending value. **Report** downloads the whole list as a CSV — line, shot, severity,
reason — so the file can be fixed in a spreadsheet and replayed.

| Reason | Meaning |
|--------|---------|
| No shot code | The row names no shot; it is skipped. This is the only row-level rejection. |
| Column not recognised | The header matched no field. Map it by hand, or leave it ignored. |
| Not a whole number / not a date | The cell could not be read; that field alone is skipped. |
| Duration contradicts the range | Start, end and duration disagree; the range wins. |
| Contradicts an earlier row | Two rows of the same shot disagree; the first value is kept. |
| Task appears twice | The same task name is listed twice for one shot. |
| Unknown status / department / person | The value is not in this project's vocabulary or team. |
| Episode column ignored | The project has no episode level. |

## Limits

- 1 000 000 characters per request, 20 000 data rows per file. A longer file is read up
  to the limit and the cut is reported.
- The preview details the first 1 000 shots; the counts always cover the whole file, and
  the downloaded report carries every warning.
- Writing is done in bulk inside a single bounded transaction: a feature film's two
  thousand shots and ten thousand tasks go in as one all-or-nothing operation.
- An archived project refuses the import (`403`) — the check happens at commit, not at
  preview.

## Getting a file back out

**Export CSV**, next to the import button, writes the project's shots and their tasks in
the same format, and re-imports as-is. Fields starting with `=`, `+`, `-` or `@` are
prefixed with an apostrophe so a shot named `=cmd()` cannot execute as a formula in Excel
or Sheets — the downloaded report applies the same guard.

Note that the export is readable by **every** project member, clients included.

## Example file

[`examples/pipeline-import.csv`](examples/pipeline-import.csv) — a two-episode series
excerpt using every column. The same file is available from the dialog itself
(**Template**), generated by the server so it can never drift from what the parser
accepts.

## Related

- [Projects & pipeline](projects-and-pipeline.md) — the hierarchy, bulk generators,
  the Episode level.
- [Project organization](../admin-guide/project-organization.md) — roles, templates,
  archiving, quotas.
- [ShotGrid integration](../admin-guide/shotgrid-integration.md) — for a studio that
  keeps its tracker rather than migrating off it.
