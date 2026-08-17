// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Simulateur de site ShotGrid / Flow Production Tracking.
 *
 * Reproduit la surface de l'API REST v1.1 dont ReView se sert : authentification
 * OAuth2, recherche paginée avec filtres, lecture de schéma, écriture, envoi de
 * webhooks signés. Il sert à développer et à tester l'intégration sans site réel.
 *
 * Le jeu de données contient VOLONTAIREMENT trois projets qui se ressemblent
 * (« Demo Project », « Demo Project 2 », « Demo Archive ») avec des entités portant
 * les mêmes codes : c'est ce qui permet de vérifier qu'une synchronisation ne
 * déborde jamais sur le projet voisin.
 *
 * Usage :
 *   node scripts/fake-shotgrid.mjs [--port 8890]
 *   node scripts/fake-shotgrid.mjs --emit Shot_Change --entity 2001 --field sg_status_list --value ip
 */

import { createServer } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.FAKE_SG_PORT ?? '8890' },
    quiet: { type: 'boolean', default: false },
  },
  strict: false,
});

const PORT = Number.parseInt(values.port, 10);
const SCRIPT_NAME = 'review_sync';
const SCRIPT_KEY = 'dev-script-key-0000';
const USER_LOGIN = 'demo.user';
const USER_PASSWORD = 'dev-legacy-password';

const log = (...args) => {
  if (!values.quiet) console.log('[fake-sg]', ...args);
};

// ─────────────────────────── Jeu de données ───────────────────────────

/**
 * Vidéo servie pour tous les médias : deux secondes de mire 320×180 encodées en H.264.
 * Un fichier réellement décodable est nécessaire — ReView transcode l'import et en tire
 * une miniature, ce qu'un fichier factice ferait échouer.
 */
const SAMPLE_MP4_BASE64 =
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAQmbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAA1B0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAUAAAAC0AAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAIAAABAAAAAALIbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAwAAAAYABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACc21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAjNzdGJsAAAAw3N0c2QAAAAAAAAAAQAAALNhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAUAAtABIAAAASAAAAAAAAAABFUxhdmM1OS4zNy4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAOWF2Y0MBZAAV/+EAG2dkABWscgRBQZ+fARAAAAMAEAAAAwGA8WLYRgEAB2joQ4OSyLD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAQAgAAEAIAAAAGHN0dHMAAAAAAAAAAQAAABgAAAQAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAACYY3R0cwAAAAAAAAARAAAAAQAACAAAAAABAAAkAAAAAAEAABAAAAAAAwAAAAAAAAADAAAEAAAAAAEAABgAAAAAAQAACAAAAAABAAAAAAAAAAIAAAQAAAAAAQAAGAAAAAABAAAIAAAAAAEAAAAAAAAAAgAABAAAAAABAAAYAAAAAAEAAAgAAAAAAQAAAAAAAAACAAAEAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAGAAAAAEAAAB0c3RzegAAAAAAAAAAAAAAGAAAB6kAAAGWAAAAaQAAADYAAAA9AAAAOAAAACIAAAAuAAAAMAAAAWYAAABFAAAAJgAAACEAAAAqAAABAgAAADgAAAAkAAAAGQAAACAAAADYAAAAOAAAACEAAAAiAAAAKQAAABRzdGNvAAAAAAAAAAEAAARWAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY1OS4yNy4xMDAAAAAIZnJlZQAAEAptZGF0AAACsAYF//+s3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCByMzA5NSBiYWVlNDAwIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMiAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTE2IGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMzMgbWU9dW1oIHN1Ym1lPTEwIHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MjQgY2hyb21hX21lPTEgdHJlbGxpcz0yIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9NiBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTggYl9weXJhbWlkPTIgYl9hZGFwdD0yIGJfYmlhcz0wIGRpcmVjdD0zIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MTIgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD02MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTQwLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAw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';

const now = () => new Date().toISOString();

/** Statuts globaux du site (entité Status) — bg_color en RGB décimal, comme ShotGrid. */
const statuses = [
  { id: 1, type: 'Status', code: 'wtg', name: 'Waiting to Start', bg_color: '150,150,150', list_order: 1 },
  { id: 2, type: 'Status', code: 'rdy', name: 'Ready to Start', bg_color: '110,160,220', list_order: 2 },
  { id: 3, type: 'Status', code: 'ip', name: 'In Progress', bg_color: '45,140,240', list_order: 3 },
  { id: 4, type: 'Status', code: 'rev', name: 'Pending Review', bg_color: '245,170,30', list_order: 4 },
  { id: 5, type: 'Status', code: 'apr', name: 'Approved', bg_color: '60,190,90', list_order: 5 },
  { id: 6, type: 'Status', code: 'fin', name: 'Final', bg_color: '30,150,60', list_order: 6 },
  { id: 7, type: 'Status', code: 'cbb', name: 'Cbb', bg_color: '215,80,200', list_order: 7 },
  { id: 8, type: 'Status', code: 'omt', name: 'Omitted', bg_color: '200,60,60', list_order: 8 },
  { id: 9, type: 'Status', code: 'hld', name: 'On Hold', bg_color: '170,140,90', list_order: 9 },
];

const projects = [
  { id: 70, type: 'Project', name: 'Demo Project', sg_status: 'Active', archived: false },
  { id: 71, type: 'Project', name: 'Demo Project 2', sg_status: 'Active', archived: false },
  { id: 72, type: 'Project', name: 'Demo Archive', sg_status: 'Bidding', archived: false },
];

const humanUsers = [
  {
    id: 500,
    type: 'HumanUser',
    login: 'demo.user',
    name: 'Demo User',
    email: 'admin@review.local',
    sg_status_list: 'act',
  },
  {
    id: 501,
    type: 'HumanUser',
    login: 'a.artist',
    name: 'Alice Artist',
    email: 'artist@review.local',
    sg_status_list: 'act',
  },
  {
    id: 502,
    type: 'HumanUser',
    login: 'x.extern',
    name: 'Xavier Extern',
    email: 'xavier@studio-externe.example',
    sg_status_list: 'act',
  },
];

const steps = [
  { id: 300, type: 'Step', code: 'Layout', short_name: 'LAY', entity_type: 'Shot' },
  { id: 301, type: 'Step', code: 'Animation', short_name: 'ANM', entity_type: 'Shot' },
  { id: 302, type: 'Step', code: 'Lighting', short_name: 'LGT', entity_type: 'Shot' },
  { id: 303, type: 'Step', code: 'Compositing', short_name: 'CMP', entity_type: 'Shot' },
  { id: 304, type: 'Step', code: 'Modeling', short_name: 'MOD', entity_type: 'Asset' },
  { id: 305, type: 'Step', code: 'Rigging', short_name: 'RIG', entity_type: 'Asset' },
];

const ref = (type, id, name) => ({ type, id, name });

/** Construit un jeu cohérent pour un projet : mêmes codes d'un projet à l'autre. */
function buildProjectData(projectId, prefix, base) {
  const p = ref('Project', projectId, projects.find((x) => x.id === projectId).name);
  const sequences = [
    {
      id: base + 1,
      type: 'Sequence',
      code: `${prefix}_SQ010`,
      project: p,
      sg_status_list: 'ip',
      description: 'Opening sequence',
      updated_at: now(),
    },
    {
      id: base + 2,
      type: 'Sequence',
      code: `${prefix}_SQ020`,
      project: p,
      sg_status_list: 'wtg',
      description: 'Chase',
      updated_at: now(),
    },
  ];
  const shots = [
    {
      id: base + 11,
      type: 'Shot',
      code: `${prefix}_SH010`,
      project: p,
      sg_sequence: ref('Sequence', base + 1, `${prefix}_SQ010`),
      sg_cut_in: 1001,
      sg_cut_out: 1096,
      sg_cut_duration: 96,
      sg_status_list: 'ip',
      description: 'Wide establishing',
      updated_at: now(),
    },
    {
      id: base + 12,
      type: 'Shot',
      code: `${prefix}_SH020`,
      project: p,
      sg_sequence: ref('Sequence', base + 1, `${prefix}_SQ010`),
      sg_cut_in: 1001,
      sg_cut_out: 1048,
      sg_cut_duration: 48,
      sg_status_list: 'rev',
      description: 'Close up',
      updated_at: now(),
    },
    {
      id: base + 13,
      type: 'Shot',
      code: `${prefix}_SH030`,
      project: p,
      sg_sequence: ref('Sequence', base + 2, `${prefix}_SQ020`),
      sg_cut_in: 1001,
      sg_cut_out: 1120,
      sg_cut_duration: 120,
      sg_status_list: 'wtg',
      description: 'Car chase',
      updated_at: now(),
    },
  ];
  const assets = [
    {
      id: base + 21,
      type: 'Asset',
      code: `${prefix}_Hero`,
      project: p,
      sg_asset_type: 'Character',
      description: 'Hero character',
      sg_status_list: 'ip',
      updated_at: now(),
    },
    {
      id: base + 22,
      type: 'Asset',
      code: `${prefix}_Car`,
      project: p,
      sg_asset_type: 'Vehicle',
      description: 'Chase car',
      sg_status_list: 'apr',
      updated_at: now(),
    },
  ];
  const tasks = [
    {
      id: base + 31,
      type: 'Task',
      content: 'Animation',
      project: p,
      entity: ref('Shot', base + 11, `${prefix}_SH010`),
      step: ref('Step', 301, 'Animation'),
      sg_status_list: 'ip',
      start_date: '2026-08-10',
      due_date: '2026-08-20',
      duration: 4800,
      task_assignees: [ref('HumanUser', 501, 'Alice Artist')],
      updated_at: now(),
    },
    {
      id: base + 32,
      type: 'Task',
      content: 'Lighting',
      project: p,
      entity: ref('Shot', base + 11, `${prefix}_SH010`),
      step: ref('Step', 302, 'Lighting'),
      sg_status_list: 'wtg',
      start_date: '2026-08-21',
      due_date: '2026-08-28',
      duration: 2400,
      task_assignees: [],
      updated_at: now(),
    },
    {
      id: base + 33,
      type: 'Task',
      content: 'Compositing',
      project: p,
      entity: ref('Shot', base + 12, `${prefix}_SH020`),
      step: ref('Step', 303, 'Compositing'),
      sg_status_list: 'rev',
      start_date: '2026-08-12',
      due_date: '2026-08-18',
      duration: 2880,
      task_assignees: [ref('HumanUser', 502, 'Xavier Extern')],
      updated_at: now(),
    },
    {
      id: base + 34,
      type: 'Task',
      content: 'Modeling',
      project: p,
      entity: ref('Asset', base + 21, `${prefix}_Hero`),
      step: ref('Step', 304, 'Modeling'),
      sg_status_list: 'apr',
      start_date: '2026-07-20',
      due_date: '2026-08-01',
      duration: 4800,
      task_assignees: [ref('HumanUser', 501, 'Alice Artist')],
      updated_at: now(),
    },
  ];
  const versions = [
    {
      id: base + 41,
      type: 'Version',
      code: `${prefix}_SH010_anim_v001`,
      project: p,
      entity: ref('Shot', base + 11, `${prefix}_SH010`),
      sg_task: ref('Task', base + 31, 'Animation'),
      sg_status_list: 'rev',
      user: ref('HumanUser', 501, 'Alice Artist'),
      description: 'First animation pass',
      sg_first_frame: 1001,
      sg_last_frame: 1096,
      frame_count: 96,
      sg_uploaded_movie: {
        name: `${prefix}_SH010_anim_v001.mov`,
        link_type: 'upload',
        content_type: 'video/quicktime',
      },
      sg_uploaded_movie_mp4: {
        name: `${prefix}_SH010_anim_v001.mp4`,
        link_type: 'upload',
        content_type: 'video/mp4',
      },
      sg_path_to_movie: `/mnt/prod/${prefix}/SH010/anim/v001.mov`,
      updated_at: now(),
    },
    {
      id: base + 42,
      type: 'Version',
      code: `${prefix}_SH020_comp_v003`,
      project: p,
      entity: ref('Shot', base + 12, `${prefix}_SH020`),
      sg_task: ref('Task', base + 33, 'Compositing'),
      sg_status_list: 'apr',
      user: ref('HumanUser', 502, 'Xavier Extern'),
      description: 'Comp with grade',
      sg_first_frame: 1001,
      sg_last_frame: 1048,
      frame_count: 48,
      sg_uploaded_movie: {
        name: `${prefix}_SH020_comp_v003.mov`,
        link_type: 'upload',
        content_type: 'video/quicktime',
      },
      sg_uploaded_movie_mp4: {
        name: `${prefix}_SH020_comp_v003.mp4`,
        link_type: 'upload',
        content_type: 'video/mp4',
      },
      updated_at: now(),
    },
  ];
  const notes = [
    {
      id: base + 51,
      type: 'Note',
      subject: 'Timing',
      content: 'The hero lands two frames late.',
      project: p,
      user: ref('HumanUser', 500, 'Demo User'),
      note_links: [
        ref('Version', base + 41, `${prefix}_SH010_anim_v001`),
        ref('Shot', base + 11, `${prefix}_SH010`),
      ],
      tasks: [ref('Task', base + 31, 'Animation')],
      created_at: now(),
      updated_at: now(),
    },
  ];
  const playlists = [
    {
      id: base + 61,
      type: 'Playlist',
      code: `${prefix}_Dailies_2026_08_15`,
      project: p,
      description: 'Morning dailies',
      versions: [ref('Version', base + 41, ''), ref('Version', base + 42, '')],
      updated_at: now(),
    },
  ];
  const publishedFiles = [
    {
      id: base + 71,
      type: 'PublishedFile',
      code: `${prefix}_SH010_anim_v001.abc`,
      project: p,
      entity: ref('Shot', base + 11, `${prefix}_SH010`),
      task: ref('Task', base + 31, 'Animation'),
      version_number: 1,
      path: { local_path: `/mnt/prod/${prefix}/SH010/anim/v001.abc`, name: 'v001.abc' },
      published_file_type: ref('PublishedFileType', 90, 'Alembic Cache'),
      updated_at: now(),
    },
  ];
  return { sequences, shots, assets, tasks, versions, notes, playlists, publishedFiles };
}

const data = {
  Project: projects,
  HumanUser: humanUsers,
  Status: statuses,
  Step: steps,
  Sequence: [],
  Shot: [],
  Asset: [],
  Task: [],
  Version: [],
  Note: [],
  Playlist: [],
  PublishedFile: [],
  EventLogEntry: [],
};

for (const [projectId, prefix, base] of [
  [70, 'DEMO', 2000],
  [71, 'DEMO', 3000], // mêmes codes que le projet 70 : piège à cloisonnement
  [72, 'ARCH', 4000],
]) {
  const built = buildProjectData(projectId, prefix, base);
  data.Sequence.push(...built.sequences);
  data.Shot.push(...built.shots);
  data.Asset.push(...built.assets);
  data.Task.push(...built.tasks);
  data.Version.push(...built.versions);
  data.Note.push(...built.notes);
  data.Playlist.push(...built.playlists);
  data.PublishedFile.push(...built.publishedFiles);
}

let nextEventId = 900000;
let nextEntityId = 9000;

/** Webhooks enregistrés : { url, secret, projectId } — configurés via l'API du simulateur. */
const webhooks = [];

// ─────────────────────────── Schéma ───────────────────────────

const statusValues = statuses.map((s) => s.code);
const displayValues = Object.fromEntries(statuses.map((s) => [s.code, s.name]));

const schemas = {
  Shot: {
    code: { data_type: { value: 'text' } },
    sg_status_list: {
      data_type: { value: 'status_list' },
      properties: { valid_values: { value: statusValues }, display_values: { value: displayValues } },
    },
    sg_cut_in: { data_type: { value: 'number' } },
    sg_cut_out: { data_type: { value: 'number' } },
    sg_cut_duration: { data_type: { value: 'number' } },
    sg_sequence: { data_type: { value: 'entity' } },
    description: { data_type: { value: 'text' } },
    project: { data_type: { value: 'entity' } },
    updated_at: { data_type: { value: 'date_time' } },
  },
  Task: {
    content: { data_type: { value: 'text' } },
    sg_status_list: {
      data_type: { value: 'status_list' },
      properties: { valid_values: { value: statusValues }, display_values: { value: displayValues } },
    },
    start_date: { data_type: { value: 'date' } },
    due_date: { data_type: { value: 'date' } },
    duration: { data_type: { value: 'duration' } },
    step: { data_type: { value: 'entity' } },
    entity: { data_type: { value: 'entity' } },
    task_assignees: { data_type: { value: 'multi_entity' } },
    project: { data_type: { value: 'entity' } },
    updated_at: { data_type: { value: 'date_time' } },
  },
  Version: {
    code: { data_type: { value: 'text' } },
    sg_status_list: {
      data_type: { value: 'status_list' },
      properties: { valid_values: { value: statusValues }, display_values: { value: displayValues } },
    },
    entity: { data_type: { value: 'entity' } },
    sg_task: { data_type: { value: 'entity' } },
    user: { data_type: { value: 'entity' } },
    description: { data_type: { value: 'text' } },
    sg_uploaded_movie: { data_type: { value: 'url' } },
    sg_uploaded_movie_mp4: { data_type: { value: 'url' } },
    sg_first_frame: { data_type: { value: 'number' } },
    sg_last_frame: { data_type: { value: 'number' } },
    project: { data_type: { value: 'entity' } },
    updated_at: { data_type: { value: 'date_time' } },
  },
  Sequence: {
    code: { data_type: { value: 'text' } },
    sg_status_list: {
      data_type: { value: 'status_list' },
      properties: { valid_values: { value: statusValues }, display_values: { value: displayValues } },
    },
    description: { data_type: { value: 'text' } },
    project: { data_type: { value: 'entity' } },
    updated_at: { data_type: { value: 'date_time' } },
  },
  Asset: {
    code: { data_type: { value: 'text' } },
    sg_asset_type: { data_type: { value: 'list' } },
    sg_status_list: {
      data_type: { value: 'status_list' },
      properties: { valid_values: { value: statusValues }, display_values: { value: displayValues } },
    },
    description: { data_type: { value: 'text' } },
    project: { data_type: { value: 'entity' } },
    updated_at: { data_type: { value: 'date_time' } },
  },
  Note: {
    subject: { data_type: { value: 'text' } },
    content: { data_type: { value: 'text' } },
    note_links: { data_type: { value: 'multi_entity' } },
    tasks: { data_type: { value: 'multi_entity' } },
    user: { data_type: { value: 'entity' } },
    attachments: { data_type: { value: 'multi_entity' } },
    project: { data_type: { value: 'entity' } },
    updated_at: { data_type: { value: 'date_time' } },
  },
  Playlist: {
    code: { data_type: { value: 'text' } },
    description: { data_type: { value: 'text' } },
    versions: { data_type: { value: 'multi_entity' } },
    project: { data_type: { value: 'entity' } },
    updated_at: { data_type: { value: 'date_time' } },
  },
  PublishedFile: {
    code: { data_type: { value: 'text' } },
    path: { data_type: { value: 'url' } },
    version_number: { data_type: { value: 'number' } },
    entity: { data_type: { value: 'entity' } },
    task: { data_type: { value: 'entity' } },
    published_file_type: { data_type: { value: 'entity' } },
    project: { data_type: { value: 'entity' } },
    updated_at: { data_type: { value: 'date_time' } },
  },
  Step: {
    code: { data_type: { value: 'text' } },
    short_name: { data_type: { value: 'text' } },
    entity_type: { data_type: { value: 'text' } },
  },
  HumanUser: {
    login: { data_type: { value: 'text' } },
    name: { data_type: { value: 'text' } },
    email: { data_type: { value: 'text' } },
  },
  Status: {
    code: { data_type: { value: 'text' } },
    name: { data_type: { value: 'text' } },
    bg_color: { data_type: { value: 'color' } },
  },
  Project: { name: { data_type: { value: 'text' } }, sg_status: { data_type: { value: 'text' } } },
};

// ─────────────────────────── Filtres ───────────────────────────

function valueOf(record, field) {
  if (field.includes('.')) {
    // Filtre profond (« entity.Shot.code ») : non utilisé par ReView, ignoré.
    return undefined;
  }
  return record[field];
}

function matchFilter(record, [field, op, value]) {
  const actual = valueOf(record, field);
  switch (op) {
    case 'is':
      if (value && typeof value === 'object' && 'id' in value)
        return actual && typeof actual === 'object' && actual.id === value.id;
      return actual === value;
    case 'is_not':
      return !matchFilter(record, [field, 'is', value]);
    case 'in':
      return Array.isArray(value) && value.some((v) => matchFilter(record, [field, 'is', v]));
    case 'greater_than':
      return typeof actual === 'string' || typeof actual === 'number' ? actual > value : false;
    case 'less_than':
      return typeof actual === 'string' || typeof actual === 'number' ? actual < value : false;
    case 'contains':
      return typeof actual === 'string' && actual.toLowerCase().includes(String(value).toLowerCase());
    case 'starts_with':
      return typeof actual === 'string' && actual.toLowerCase().startsWith(String(value).toLowerCase());
    default:
      return true;
  }
}

function jsonApi(record, fields) {
  const { id, type, ...rest } = record;
  const attributes = {};
  const relationships = {};
  for (const [key, value] of Object.entries(rest)) {
    if (fields && fields.length > 0 && !fields.includes(key)) continue;
    const isEntity =
      value && typeof value === 'object' && !Array.isArray(value) && 'type' in value && 'id' in value;
    const isEntityList =
      Array.isArray(value) && value.every((v) => v && typeof v === 'object' && 'type' in v);
    if (isEntity || (isEntityList && value.length > 0)) relationships[key] = { data: value };
    else attributes[key] = value;
  }
  return { id, type, attributes, relationships, links: { self: `/api/v1.1/entity/${type}/${id}` } };
}

// ─────────────────────────── Serveur ───────────────────────────

const tokens = new Set();

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw));
  });
}

function send(res, status, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

/**
 * Un site ShotGrid réel refuse `Content-Type: application/json` sur une requête sans
 * corps (« Unsupported Content-Type »). Le simulateur applique la même exigence :
 * un serveur plus permissif que la réalité laisserait passer un défaut jusqu'en
 * production, ce qui est exactement arrivé une fois.
 */
function rejectStrayContentType(req, res) {
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method);
  if (!hasBody && req.headers['content-type']) {
    send(res, 500, {
      errors: [
        {
          status: 500,
          title: 'Internal Server Error',
          detail: `Unsupported Content-Type '${req.headers['content-type']}'`,
        },
      ],
    });
    return true;
  }
  return false;
}

function requireAuth(req, res) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || !tokens.has(token)) {
    send(res, 401, { errors: [{ status: 401, title: 'Unauthorized', detail: 'Invalid access token' }] });
    return false;
  }
  return true;
}

/** Enregistre un EventLogEntry et notifie les webhooks abonnés au projet. */
function recordEvent({
  eventType,
  entity,
  projectId,
  attributeName,
  oldValue,
  newValue,
  operation = 'update',
}) {
  nextEventId += 1;
  const entry = {
    id: nextEventId,
    type: 'EventLogEntry',
    event_type: eventType,
    entity,
    project: projectId ? ref('Project', projectId, projects.find((p) => p.id === projectId)?.name) : null,
    user: ref('HumanUser', 500, 'Demo User'),
    created_at: now(),
    attribute_name: attributeName ?? null,
    meta: {
      type: 'attribute_change',
      entity_id: entity?.id,
      attribute_name: attributeName,
      old_value: oldValue,
      new_value: newValue,
    },
  };
  data.EventLogEntry.push(entry);
  deliverWebhooks(entry, operation);
  return entry;
}

async function deliverWebhooks(entry, operation) {
  for (const hook of webhooks) {
    if (hook.projectId && entry.project && hook.projectId !== entry.project.id) continue;
    const payload = {
      data: {
        id: entry.id,
        event_type: entry.event_type,
        entity: entry.entity,
        project: entry.project,
        user: entry.user,
        operation,
        created_at: entry.created_at,
        meta: entry.meta,
      },
      timestamp: now(),
    };
    const body = JSON.stringify(payload);
    const headers = {
      'Content-Type': 'application/json',
      'x-sg-delivery-id': randomUUID(),
    };
    if (hook.secret)
      headers['x-sg-signature'] = `sha1=${createHmac('sha1', hook.secret).update(body).digest('hex')}`;
    try {
      const res = await fetch(hook.url, { method: 'POST', headers, body });
      log(`webhook → ${hook.url} : ${res.status} (${entry.event_type})`);
    } catch (err) {
      log(`webhook → ${hook.url} : échec ${err.message}`);
    }
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const raw = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : '';
  const json = (() => {
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  })();

  // ── Authentification
  if (path === '/api/v1.1/auth/access_token') {
    const params = new URLSearchParams(raw);
    const grant = params.get('grant_type');
    const ok =
      (grant === 'client_credentials' &&
        params.get('client_id') === SCRIPT_NAME &&
        params.get('client_secret') === SCRIPT_KEY) ||
      (grant === 'password' &&
        params.get('username') === USER_LOGIN &&
        params.get('password') === USER_PASSWORD);
    if (!ok) {
      log(`auth refusée (grant=${grant})`);
      return send(res, 401, {
        errors: [{ status: 401, title: 'Unauthorized', detail: "Can't authenticate user" }],
      });
    }
    const token = randomUUID();
    tokens.add(token);
    log(`auth ok (grant=${grant})`);
    return send(res, 200, {
      access_token: token,
      refresh_token: randomUUID(),
      expires_in: 600,
      token_type: 'Bearer',
    });
  }

  // ── Pilotage du simulateur (hors API ShotGrid)
  if (path === '/_control/webhook' && req.method === 'POST') {
    webhooks.push({ url: json.url, secret: json.secret ?? null, projectId: json.projectId ?? null });
    log(`webhook enregistré : ${json.url} (projet ${json.projectId ?? 'tous'})`);
    return send(res, 201, { ok: true, count: webhooks.length });
  }
  if (path === '/_control/webhook' && req.method === 'DELETE') {
    webhooks.length = 0;
    return send(res, 200, { ok: true });
  }
  if (path === '/_control/mutate' && req.method === 'POST') {
    // { entityType, id, field, value } → modifie et émet l'événement correspondant
    const list = data[json.entityType] ?? [];
    const record = list.find((r) => r.id === json.id);
    if (!record) return send(res, 404, { error: 'not found' });
    const oldValue = record[json.field];
    record[json.field] = json.value;
    record.updated_at = now();
    recordEvent({
      eventType: `Shotgun_${json.entityType}_Change`,
      entity: ref(json.entityType, record.id, record.code ?? record.content ?? ''),
      projectId: record.project?.id ?? null,
      attributeName: json.field,
      oldValue,
      newValue: json.value,
    });
    log(`mutation ${json.entityType}#${json.id}.${json.field} = ${JSON.stringify(json.value)}`);
    return send(res, 200, { ok: true, record });
  }
  // Inventaire des plans d'un projet — le scénario de vérification s'en sert pour
  // connaître l'effectif attendu sans le figer dans le test.
  if (path === '/_control/shots' && req.method === 'GET') {
    const pid = Number(url.searchParams.get('projectId'));
    const shots = data.Shot.filter((s) => s.project?.id === pid);
    return send(res, 200, {
      codes: shots.map((s) => s.code),
      shots: shots.map((s) => ({ id: s.id, code: s.code, sg_cut_in: s.sg_cut_in, sg_cut_out: s.sg_cut_out })),
    });
  }
  if (path === '/_control/state' && req.method === 'GET') {
    return send(res, 200, {
      counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
      webhooks: webhooks.length,
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
    });
  }

  // Contenu d'un média : servi sans jeton, comme une URL S3 signée chez ShotGrid.
  if (path.startsWith('/_media/')) {
    const buf = Buffer.from(SAMPLE_MP4_BASE64, 'base64');
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': buf.length });
    return res.end(buf);
  }
  if (path === '/_upload-sink') {
    log('fichier reçu (puits de test)');
    return send(res, 200, { ok: true });
  }

  if (rejectStrayContentType(req, res)) return;
  if (!requireAuth(req, res)) return;

  // ── Informations serveur
  if (path === '/api/v1.1/' || path === '/api/v1.1') {
    return send(res, 200, { data: { shotgun_version: '8.60 (fake)', api_version: 'v1.1' } });
  }

  // ── Schéma
  let m = path.match(/^\/api\/v1\.1\/schema\/([^/]+)\/fields\/([^/]+)$/);
  if (m) {
    const field = schemas[m[1]]?.[m[2]];
    if (!field) return send(res, 404, { errors: [{ status: 404, title: 'Not Found' }] });
    return send(res, 200, { data: field });
  }
  m = path.match(/^\/api\/v1\.1\/schema\/([^/]+)\/fields$/);
  if (m) {
    const entity = schemas[m[1]];
    if (!entity) return send(res, 404, { errors: [{ status: 404, title: 'Not Found' }] });
    return send(res, 200, { data: entity });
  }

  // ── Recherche
  m = path.match(/^\/api\/v1\.1\/entity\/([^/]+)\/_search$/);
  if (m && req.method === 'POST') {
    // Comme un site réel : la recherche exige un type de contenu qui déclare la forme
    // des filtres, et refuse `application/json`.
    const ct = (req.headers['content-type'] ?? '').split(';')[0].trim();
    const FILTER_TYPES = [
      'application/vnd+shotgun.api3_array+json',
      'application/vnd+shotgun.api3_hash+json',
    ];
    if (!FILTER_TYPES.includes(ct)) {
      return send(res, 415, {
        errors: [
          {
            status: 415,
            code: 103,
            title: `Unsupported Content-Type '${ct || 'aucun'}'`,
            source: { content_type: `Content-Type must be one of: '${FILTER_TYPES.join("', '")}'.` },
          },
        ],
      });
    }
    const entity = m[1];
    const list = data[entity] ?? [];
    const raw = json.filters;
    const isHash = raw && !Array.isArray(raw) && typeof raw === 'object';
    const filters = isHash ? (raw.conditions ?? []) : Array.isArray(raw) ? raw : [];
    const op = (isHash ? raw.logical_operator : json.logical_operator) === 'or' ? 'some' : 'every';
    const matched = list.filter((r) => filters[op]((f) => matchFilter(r, f)));
    const size = json.page?.size ?? 500;
    const number = json.page?.number ?? 1;
    const slice = matched.slice((number - 1) * size, number * size);
    log(`search ${entity} → ${matched.length} (page ${number}, filtres ${JSON.stringify(filters)})`);
    return send(res, 200, {
      data: slice.map((r) => jsonApi(r, json.fields)),
      links: { self: path },
    });
  }

  // ── Lecture d'une entité
  m = path.match(/^\/api\/v1\.1\/entity\/([^/]+)\/(\d+)$/);
  if (m && req.method === 'GET') {
    const record = (data[m[1]] ?? []).find((r) => r.id === Number(m[2]));
    if (!record) return send(res, 404, { errors: [{ status: 404, title: 'Not Found' }] });
    const fields = url.searchParams.get('fields')?.split(',').filter(Boolean);
    return send(res, 200, { data: jsonApi(record, fields) });
  }

  // ── Mise à jour
  if (m && req.method === 'PUT') {
    const entity = m[1];
    const record = (data[entity] ?? []).find((r) => r.id === Number(m[2]));
    if (!record) return send(res, 404, { errors: [{ status: 404, title: 'Not Found' }] });
    const sudo = url.searchParams.get('sudo_as_login');
    for (const [k, v] of Object.entries(json)) {
      const oldValue = record[k];
      record[k] = v;
      recordEvent({
        eventType: `Shotgun_${entity}_Change`,
        entity: ref(entity, record.id, record.code ?? record.content ?? ''),
        projectId: record.project?.id ?? null,
        attributeName: k,
        oldValue,
        newValue: v,
      });
    }
    record.updated_at = now();
    log(`update ${entity}#${record.id}${sudo ? ` (sudo ${sudo})` : ''} : ${Object.keys(json).join(', ')}`);
    return send(res, 200, { data: jsonApi(record) });
  }

  // ── Création
  m = path.match(/^\/api\/v1\.1\/entity\/([^/]+)$/);
  if (m && req.method === 'POST') {
    const entity = m[1];
    if (!data[entity]) data[entity] = [];
    nextEntityId += 1;
    const record = { id: nextEntityId, type: entity, ...json, created_at: now(), updated_at: now() };
    data[entity].push(record);
    const sudo = url.searchParams.get('sudo_as_login');
    recordEvent({
      eventType: `Shotgun_${entity}_New`,
      entity: ref(entity, record.id, record.code ?? record.content ?? ''),
      projectId: record.project?.id ?? null,
      operation: 'create',
    });
    log(`create ${entity}#${record.id}${sudo ? ` (sudo ${sudo})` : ''}`);
    return send(res, 201, { data: jsonApi(record) });
  }

  // ── Téléchargement d'un média : renvoie une petite vidéo de test.
  // L'URL est construite depuis l'en-tête Host de l'appelant : un client dans un
  // conteneur ne joindrait pas « localhost », qui désigne son propre conteneur.
  m = path.match(/^\/api\/v1\.1\/entity\/([^/]+)\/(\d+)\/([^/]+)\/download$/);
  if (m) {
    const host = req.headers.host ?? `localhost:${PORT}`;
    return send(res, 200, { data: { url: `http://${host}/_media/${m[1]}/${m[2]}/${m[3]}` } });
  }
  // ── Dépôt de fichier
  m = path.match(/^\/api\/v1\.1\/entity\/([^/]+)\/(\d+)\/([^/]+)\/_upload$/);
  if (m) {
    const host = req.headers.host ?? `localhost:${PORT}`;
    return send(res, 200, {
      data: { upload_url: `http://${host}/_upload-sink`, upload_info: { id: randomUUID() } },
      links: { complete_upload: `/api/v1.1/entity/${m[1]}/${m[2]}/${m[3]}/_upload/complete` },
    });
  }
  if (path.endsWith('/_upload/complete')) {
    return send(res, 201, { data: { ok: true } });
  }

  send(res, 404, { errors: [{ status: 404, title: 'Not Found', detail: path }] });
});

server.listen(PORT, () => {
  log(`site ShotGrid simulé sur http://localhost:${PORT}`);
  log(`script : ${SCRIPT_NAME} / ${SCRIPT_KEY}`);
  log(`utilisateur : ${USER_LOGIN} / ${USER_PASSWORD}`);
  log(`projets : ${projects.map((p) => `${p.name} (#${p.id})`).join(', ')}`);
});
