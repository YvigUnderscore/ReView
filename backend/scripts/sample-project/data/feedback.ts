// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Banque de retours de review.
 *
 * Les plans clés portent des fils écrits à la main (voir les fichiers de projet) ; tous les
 * autres sont peuplés depuis cette banque, département par département. Ce sont de vraies
 * phrases de daily — précises, adressées à quelqu'un, et parfois désagréables : un jeu de
 * démonstration rempli de « super, validé » ne montre rien de ce que l'outil sait faire.
 */

export interface NoteTemplate {
  text: string;
  /** Le retour désigne un endroit de l'image : le générateur y pose une annotation. */
  marks?: boolean;
  /** Le retour porte sur une action : il devient une plage in→out. */
  ranged?: boolean;
  state?: 'OPEN' | 'WIP' | 'QUESTION' | 'WONT_FIX' | 'RESOLVED';
}

export const NOTES_BY_DEPARTMENT: Record<string, NoteTemplate[]> = {
  LAYOUT: [
    {
      text: 'Camera height sits between the two characters — pick one. Right now it belongs to neither.',
      marks: true,
    },
    {
      text: 'The push starts too early and never resolves. Delay it eight frames and land it on the cut.',
      ranged: true,
    },
    { text: 'Headroom is tight on the left third. Reframe rather than scale up in comp.', marks: true },
    {
      text: 'Lens feels wrong for the coverage — 32 mm here against a 50 mm on the reverse.',
      state: 'QUESTION',
    },
    { text: 'Staging reads. Locking this so animation can start.', state: 'RESOLVED' },
    {
      text: 'The horizon crosses the eyeline exactly. Drop the camera 15 cm and the frame breathes.',
      marks: true,
    },
  ],
  ANIMATION: [
    {
      text: 'Contact is floating for about six frames. Pin the foot and let the hips carry the weight.',
      marks: true,
      ranged: true,
    },
    { text: 'The arc on the head turn flattens at the halfway point. Add a breakdown.', ranged: true },
    { text: 'Too much overlap on the settle — it reads as rubber. Halve it.', ranged: true },
    { text: 'Blink lands on the accent instead of before it. Move it two frames earlier.', marks: true },
    { text: 'Silhouette breaks when the arm crosses the torso. Rotate the shoulder out.', marks: true },
    { text: 'This is the pass. Timing and weight both read, sending to lighting.', state: 'RESOLVED' },
    {
      text: 'Can we see a version without the anticipation? I want to check the cut still works.',
      state: 'QUESTION',
    },
  ],
  MODELING: [
    { text: 'Edge flow collapses at the corner — it will pinch as soon as it deforms.', marks: true },
    { text: 'Scale is off against the reference: the prop should reach mid-thigh, not waist.', marks: true },
    { text: 'Topology is clean, thanks. Proxy still needs to ship with the asset.', state: 'RESOLVED' },
    { text: 'Normals are flipped on the inner faces — you only see it in the proxy purpose.', marks: true },
  ],
  RIGGING: [
    {
      text: 'The elbow pops past 140 degrees. Clamp it or the animators will find it the hard way.',
      marks: true,
    },
    { text: 'Control naming does not match the show convention. Rename before publishing.', state: 'OPEN' },
    {
      text: 'Deformation on the shoulder is much better in this version. Approved for animation.',
      state: 'RESOLVED',
    },
  ],
  LOOKDEV: [
    {
      text: 'Specular is reading as plastic under the key. Roughness up, and break it with the map.',
      marks: true,
    },
    {
      text: 'Texel density does not match the neighbouring asset — it will show in the wide.',
      state: 'OPEN',
    },
    { text: 'Both variants look right in the turntable. Good to publish.', state: 'RESOLVED' },
  ],
  FX: [
    {
      text: 'Direction is inconsistent with the sequence: everything drifts camera-left, this one does not.',
      marks: true,
    },
    { text: 'Density is fine but the particles die too evenly — stagger the lifetimes.', ranged: true },
    {
      text: 'The cache is heavier than the shot needs. Can we halve the resolution outside the frame?',
      state: 'QUESTION',
    },
    {
      text: 'Interaction with the ground is missing entirely. It should displace where he lands.',
      marks: true,
      ranged: true,
    },
  ],
  LIGHTING: [
    {
      text: 'Key is doing everything. Add a rim or we lose the subject against the background.',
      marks: true,
    },
    {
      text: 'Colour temperature drifts across the sequence — this one is 500 K warmer than the previous shot.',
      state: 'OPEN',
    },
    {
      text: 'Shadow terminator is crunchy on the left cheek. Soften the source or move it wider.',
      marks: true,
    },
    { text: 'This is the look. Matching the rest of the sequence exactly.', state: 'RESOLVED' },
    { text: 'Ground bounce is lifting the blacks too much. Flag it.', marks: true },
  ],
  COMPOSITING: [
    {
      text: 'Edges are chattering on the right side, frame by frame. Looks like a matte, not a filter.',
      marks: true,
      ranged: true,
    },
    { text: 'Grain does not match the plate — ours is finer and static.', state: 'OPEN' },
    { text: 'Black level sits at 0.008 instead of 0. Distribution will bounce it.', state: 'OPEN' },
    { text: 'Depth haze is doing the work nicely here. No notes.', state: 'RESOLVED' },
    { text: 'Can we get a version without the vignette for the trailer team?', state: 'QUESTION' },
  ],
  MATTEPAINT: [
    {
      text: 'Perspective on the far towers does not match the camera solve — they lean the wrong way.',
      marks: true,
    },
    { text: 'Card separation is visible when the camera moves. Add a third depth layer.', ranged: true },
  ],
  EDIT: [
    {
      text: 'This is four frames long against the cut. Trimming on our side, no action needed.',
      state: 'RESOLVED',
    },
    { text: 'Handles are missing at the tail — we need eight frames for the transition.', state: 'OPEN' },
  ],
};

/** Réponses courtes, réutilisées pour donner du fil aux discussions. */
export const REPLIES: string[] = [
  'On it — next version tonight.',
  'Good catch, I had not seen it at full resolution.',
  'Fixed in the next publish, thanks.',
  'That one is on purpose, the director asked for it. Leaving as is.',
  'Can we look at it together in the daily? Hard to judge on a still.',
  'Reworked and re-cached, should be clean now.',
  'Agreed. Same note applies to the next shot of the sequence.',
];

/** Décisions de review, par statut. */
export const DECISION_NOTES: Record<string, string[]> = {
  Approved: [
    'Approved. Nice work.',
    'Approved for the cut — no further notes.',
    'Approved, ship it.',
    'Approved with the minor note already fixed.',
  ],
  Retake: [
    'Retake: see the notes on the arc and the contact.',
    'Retake — the sequence continuity is broken here.',
    'Retake, but only the second half of the shot.',
  ],
  CBB: ['Could be better, but it holds for the client reel.', 'CBB — revisit if the schedule allows.'],
  Pending: ['Looking at this in tomorrow’s daily.', 'Waiting on the supervisor pass.'],
};

/** Messages de la messagerie interne (conversations d'équipe). */
export const CHAT_MESSAGES: { channel: string; by: string; text: string; minutesAgo: number }[] = [
  {
    channel: 'sq010',
    by: 'tomas',
    text: 'SQ010 is locked as of this morning. Anything you send now goes straight to lighting.',
    minutesAgo: 2880,
  },
  {
    channel: 'sq010',
    by: 'sofia',
    text: 'Good — I am re-rendering SH0100 and SH0120 with the new dome. Should land before the daily.',
    minutesAgo: 2820,
  },
  {
    channel: 'sq010',
    by: 'marisol',
    text: 'Remember the horizon note. If the sky is hot again we lose another day.',
    minutesAgo: 2760,
  },
  {
    channel: 'sq010',
    by: 'sofia',
    text: 'Down 1.5 stops, and I flagged the ground bounce. Posting v004 now.',
    minutesAgo: 2700,
  },
  {
    channel: 'sq010',
    by: 'malik',
    text: 'Once lighting is final I need two days for the comp on 0100 and 0140.',
    minutesAgo: 1440,
  },
  {
    channel: 'dailies',
    by: 'ines',
    text: 'Daily at 10:00 as usual. Playlist is “Dailies — Monday”, five shots, twelve minutes.',
    minutesAgo: 600,
  },
  {
    channel: 'dailies',
    by: 'elodie',
    text: 'I will not make it, dentist. Kenji can present SH0310 for me.',
    minutesAgo: 560,
  },
  {
    channel: 'dailies',
    by: 'kenji',
    text: 'Sure. I still have the wing intersection open on that one, I will show it.',
    minutesAgo: 540,
  },
  {
    channel: 'dailies',
    by: 'tomas',
    text: 'Show it. Better to talk about it now than after lighting starts.',
    minutesAgo: 520,
  },
  {
    channel: 'pipeline',
    by: 'ada',
    text: 'Reminder: publish with the rig version in the file name. Three files came in yesterday without it.',
    minutesAgo: 4320,
  },
  {
    channel: 'pipeline',
    by: 'noah',
    text: 'Scales rig v013 is up — growth blend is on a spline now, no more snapping between stages.',
    minutesAgo: 300,
  },
  { channel: 'pipeline', by: 'elodie', text: 'Thank you. Unblocking SH0430 today.', minutesAgo: 280 },
  {
    channel: 'pipeline',
    by: 'ada',
    text: 'The render farm account now publishes through the API — anything it uploads shows up as Render Farm.',
    minutesAgo: 200,
  },
];
