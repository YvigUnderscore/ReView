// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ProjectSpec } from './types';

/**
 * « Caminandes » — le projet de démonstration.
 *
 * Une série de trois courts métrages, avec le niveau **épisode** activé : c'est le seul cas
 * où ReView montre ce cran de hiérarchie, et il change la navigation, les filtres et le
 * montage.
 *
 * Chaque plan est prélevé à un point **vérifié image par image** dans le master de son
 * épisode, et sa durée s'arrête avant la coupe suivante. C'est fastidieux et c'est le cœur
 * du travail : un extrait qui traverse une coupe montre deux plans différents sous une seule
 * fiche, et l'incohérence saute aux yeux à la première ouverture — bien avant qu'on regarde
 * les statuts, les versions ou les commentaires.
 *
 * Source : *Caminandes* (Blender Foundation — Beorn Leonard, Pablo Vazquez), CC BY 3.0.
 */
export const CAMINANDES: ProjectSpec = {
  slug: 'caminandes',
  name: 'Caminandes',
  description:
    'Comedy short series set in Patagonia — Koro the guanaco against a road, an electric fence, and a very persistent penguin. Three episodes, episode level enabled.',
  status: 'ACTIVE',
  film: 'caminandes3',
  resolution: { width: 1920, height: 1080 },
  framerate: 24,
  startFrame: 1001,
  episodesEnabled: true,
  pipeline: [
    'EDIT',
    'LAYOUT',
    'MODELING',
    'RIGGING',
    'LOOKDEV',
    'ANIMATION',
    'FX',
    'LIGHTING',
    'COMPOSITING',
  ],
  storageQuotaGb: 200,
  naming: { pattern: '^[A-Za-z0-9._-]+$', mode: 'warn' },
  team: [
    { member: 'ada' },
    { member: 'marisol' },
    { member: 'tomas' },
    { member: 'ines' },
    { member: 'priya' },
    { member: 'noah' },
    { member: 'elodie' },
    { member: 'kenji' },
    { member: 'rui' },
    { member: 'sofia' },
    { member: 'malik' },
    { member: 'hannah' },
    { member: 'victor' },
    { member: 'lucas' },
    { member: 'ingrid' },
    { member: 'farm' },
  ],
  brief: `# Caminandes — series bible

::small Three episodes · 1920×1080 · 24 fps · comedy timing above everything

## The rules

1. **No dialogue, ever.** If a beat needs a line, the beat is wrong.
2. **Koro loses physically, wins morally.** Oti wins physically, every time.
3. One obstacle per episode: the road, the fence, the winter.
4. The landscape is a character. Patagonia is wide, empty and indifferent.

## Where each episode stands

::progress EP01 Llama Drama 100 %
::progress EP02 Gran Dillama 100 %
::progress EP03 Llamigos 54 %

- **EP01 — Llama Drama** — delivered. Kept as the reference for staging and comedy timing.
- **EP02 — Gran Dillama** — delivered. The fence rig and the electric FX setup come from here.
- **EP03 — Llamigos** — in production. The lake, the locomotive and the mine are open.

## Rules of the show

- Playblasts carry burn-ins: shot, task, version, frame. No exceptions.
- A retake is a **new version**, never a fixed one — the published version stays as it was seen.
- Assets are referenced from the library, never imported. Ask Priya before changing one.
`,
  episodes: [
    {
      code: 'EP01',
      name: 'Llama Drama',
      description: 'Koro wants to cross the road. The road disagrees.',
      film: 'caminandes1',
    },
    {
      code: 'EP02',
      name: 'Gran Dillama',
      description: 'A fence, then a fence with a current running through it.',
      film: 'caminandes2',
    },
    {
      code: 'EP03',
      name: 'Llamigos',
      description: 'Winter, one berry, and a penguin who wants it just as much.',
      film: 'caminandes3',
    },
  ],
  sequences: [
    {
      code: 'SQ010',
      name: 'Roadside',
      description: 'Koro reaches the highway and sizes it up.',
      episode: 'EP01',
      assignees: ['hannah', 'kenji'],
      brief: `# SQ010 — Roadside

::small 2 shots · delivered · exterior day, altiplano

## Intent

Establish the emptiness before the first vehicle. The audience must believe nothing will ever
come — that is what makes the next sequence work.

## Continuity

- The road runs camera-left to camera-right in every shot of the episode.
- Koro enters from the grass side, never from the tarmac.
`,
      shots: [
        {
          code: 'SH0100',
          name: 'Highway wide',
          description: 'Establishing wide: the empty road, the altiplano and the peaks in the haze.',
          at: 7,
          duration: 3.5,
          stage: 'final',
          assignees: ['hannah', 'sofia'],
          assets: ['patagonia', 'rock-set'],
          brief: `# SH0100 — Highway wide

::small 1001–1084 · 3.5 s · lens 35 mm · delivered

## Brief

The first image of the series. Hold the emptiness: no camera move, no cut, until the shape of
the animal registers at the edge of frame.

::progress Layout 100 %
::progress Animation 100 %
::progress Lighting 100 %
::progress Compositing 100 %
`,
          feedback: [
            {
              stage: 'lighting',
              notes: [
                {
                  by: 'marisol',
                  text: 'The sky is two stops hotter than the ground — we lose the mountain line entirely. Bring the dome down and let the road carry the exposure.',
                  at: 1.2,
                  draw: { shape: 'box', x: 0.06, y: 0.08, w: 0.88, h: 0.26, color: '#ff5c5c', label: 'sky' },
                  state: 'RESOLVED',
                  replies: [
                    {
                      by: 'sofia',
                      text: 'Agreed. Dome down 1.5 stops, bounce card on the tarmac. v004 after the cache finishes.',
                    },
                    { by: 'marisol', text: 'Perfect on v004. Approved.' },
                  ],
                  reactions: [{ by: 'tomas', emoji: '👍' }],
                },
              ],
            },
            {
              stage: 'comp',
              notes: [
                {
                  by: 'lucas',
                  text: 'Lovely opening. One note from our side: the grain is heavier here than on the rest of the reel.',
                  client: true,
                  state: 'RESOLVED',
                  replies: [
                    {
                      by: 'malik',
                      text: 'Matched to the show grain plate on the next pass — this one still had the default.',
                    },
                  ],
                  reactions: [{ by: 'marisol', emoji: '🙏' }],
                },
              ],
            },
          ],
          markers: [
            { at: 0.4, name: 'Wind drop', color: '#22d3ee', by: 'sofia' },
            { at: 2.4, name: 'Koro enters', color: '#f5b841', by: 'tomas' },
          ],
        },
        {
          code: 'SH0110',
          name: 'At the verge',
          description: 'Koro stands at the roadside, turning his head to follow the empty road.',
          at: 14.1,
          duration: 4,
          stage: 'final',
          assignees: ['kenji'],
          assets: ['koro', 'patagonia'],
          feedback: [
            {
              stage: 'anim',
              notes: [
                {
                  by: 'tomas',
                  text: 'The head turn lands on the accent instead of just before it. Two frames earlier and the pose reads as a decision rather than a reaction.',
                  at: 2.1,
                  draw: { shape: 'circle', x: 0.5, y: 0.3, r: 0.09, color: '#ffd166', label: 'head' },
                  state: 'RESOLVED',
                  replies: [{ by: 'elodie', text: 'Moved to 1043. Much better read, thanks.' }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      code: 'SQ020',
      name: 'Crossing',
      description: 'Every wrong way to cross a road, in order.',
      episode: 'EP01',
      assignees: ['tomas', 'elodie'],
      brief: `# SQ020 — Crossing

::small 7 shots · delivered · the gag sequence of the episode

## Intent

Escalation. Each attempt is bigger and lands worse than the last; the cut gets faster as the
sequence goes, and only the final shot breathes.

::progress Animation 100 %
::progress FX 100 %
`,
      shots: [
        {
          code: 'SH0200',
          name: 'Hoof on tarmac',
          description:
            'Insert at road level: a hoof comes down on the white line, coat filling the top of frame.',
          at: 27.7,
          duration: 4,
          stage: 'final',
          assignees: ['kenji'],
          assets: ['koro'],
        },
        {
          code: 'SH0210',
          name: 'Second attempt',
          description: 'Same insert, second try — the hoof lifts, hesitates, comes back down.',
          at: 32.5,
          duration: 4,
          stage: 'final',
          assignees: ['elodie'],
          assets: ['koro'],
        },
        {
          code: 'SH0220',
          name: 'Trot back',
          description: 'Koro trots along the verge, pretending it was all on purpose.',
          at: 39.4,
          duration: 4,
          stage: 'final',
          assignees: ['hannah'],
          assets: ['koro', 'patagonia'],
        },
        {
          code: 'SH0230',
          name: 'Tumble',
          description: 'Koro ends up on his back in the gravel, legs in the air.',
          at: 52.1,
          duration: 4,
          stage: 'final',
          assignees: ['victor'],
          assets: ['koro', 'patagonia'],
          feedback: [
            {
              stage: 'anim',
              notes: [
                {
                  by: 'tomas',
                  text: 'The roll is too even — it reads as a physics sim, not a fall. Break it: heavy on the shoulder first, then a delayed settle on the hips.',
                  at: 1.6,
                  range: [1.4, 2.6],
                  state: 'RESOLVED',
                  replies: [
                    {
                      by: 'kenji',
                      text: 'Reblocked the contact and added a two-frame hold before the settle.',
                    },
                    { by: 'marisol', text: 'Confirmed on the new pass. This is the version we ship.' },
                  ],
                  reactions: [{ by: 'elodie', emoji: '❤️' }],
                },
              ],
            },
          ],
          markers: [{ at: 1.5, name: 'Impact', color: '#ff5c5c', by: 'tomas' }],
        },
        {
          code: 'SH0240',
          name: 'Legs in the air',
          description: 'He stays down a beat too long, hooves waving at the sky.',
          at: 57.5,
          duration: 4,
          stage: 'final',
          assignees: ['elodie'],
          assets: ['koro'],
        },
        {
          code: 'SH0250',
          name: 'Dust cloud',
          description: 'The frame fills with dust as a vehicle tears past just out of shot.',
          at: 66,
          duration: 3.5,
          stage: 'final',
          assignees: ['rui'],
          assets: ['patagonia'],
        },
        {
          code: 'SH0260',
          name: 'Bolting through',
          description: 'Koro finally bolts across, silhouetted in the settling dust.',
          at: 69.9,
          duration: 4,
          stage: 'final',
          assignees: ['elodie'],
          assets: ['koro'],
        },
      ],
    },
    {
      code: 'SQ030',
      name: 'The Fence',
      description: 'A wire fence between Koro and better grass.',
      episode: 'EP02',
      assignees: ['tomas', 'priya'],
      brief: `# SQ030 — The Fence

::small 3 shots · delivered · exterior day, clear sky

## Intent

The fence is the antagonist. Shoot it like one: low angles, hard verticals, and Koro always
smaller than it in frame.

## Continuity

- Five wires, evenly spaced, red tensioners on every post.
- The mountains stay camera-right for the whole sequence.
`,
      shots: [
        {
          code: 'SH0300',
          name: 'Plain wide',
          description: 'Wide on the plain: grass tufts, boulders and the blue ridge behind, Koro grazing.',
          at: 8.5,
          duration: 3,
          stage: 'final',
          assignees: ['hannah', 'sofia'],
          assets: ['patagonia', 'rock-set', 'dead-tree'],
        },
        {
          code: 'SH0310',
          name: 'Along the fence',
          description: 'Koro walks the fence line, looking for a gap between the wires.',
          at: 23.2,
          duration: 3.7,
          stage: 'final',
          assignees: ['kenji'],
          assets: ['koro', 'wire-fence'],
        },
        {
          code: 'SH0320',
          name: 'Koro close',
          description: 'Big close-up: muzzle, eye, and the mountains thrown out of focus behind.',
          at: 28.8,
          duration: 3.8,
          stage: 'final',
          assignees: ['elodie'],
          assets: ['koro'],
          brief: `# SH0320 — Koro close

::small The character shot of the episode

## Brief

The audience meets Koro properly here. Everything is in the eye: hold the blink until the very
end of the shot.

::progress Animation 100 %
::progress Look dev 100 %
`,
          feedback: [
            {
              stage: 'anim',
              notes: [
                {
                  by: 'marisol',
                  text: 'The eyelid crosses the pupil for about six frames on the blink — it reads as a glitch at full resolution.',
                  at: 2.4,
                  draw: { shape: 'circle', x: 0.44, y: 0.4, r: 0.09, color: '#ff5c5c', label: 'blink' },
                  state: 'RESOLVED',
                  assignee: 'kenji',
                  spawnTask: {
                    dept: 'ANIMATION',
                    name: 'Eyelid crosses pupil 1035-1041 — SH0320',
                    assignee: 'kenji',
                  },
                  replies: [
                    { by: 'kenji', text: 'Offset the lid curve and reshaped the corner. Clean now.' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      code: 'SQ040',
      name: 'Voltage',
      description: 'The fence turns out to be electric.',
      episode: 'EP02',
      assignees: ['rui', 'marisol'],
      brief: `# SQ040 — Voltage

::small 6 shots · delivered · the FX sequence of the series

The jolt has to be instant and the recovery slow. Editorial locked both before animation
started; do not re-time either without asking Inès.
`,
      shots: [
        {
          code: 'SH0400',
          name: 'The jump',
          description: 'Koro launches over the wire and the current takes him mid-air.',
          at: 48.1,
          duration: 4,
          stage: 'final',
          assignees: ['kenji', 'rui'],
          assets: ['koro', 'wire-fence'],
          markers: [{ at: 1.2, name: 'Contact', color: '#4cc9f0', by: 'rui' }],
        },
        {
          code: 'SH0410',
          name: 'Knocked down',
          description: 'He lands hard and folds onto the gravel beside the posts.',
          at: 59.4,
          duration: 4,
          stage: 'final',
          assignees: ['kenji'],
          assets: ['koro', 'wire-fence'],
        },
        {
          code: 'SH0420',
          name: 'Down and out',
          description: 'Koro lies flat along the fence line, entirely still.',
          at: 66.8,
          duration: 4,
          stage: 'final',
          assignees: ['elodie'],
          assets: ['koro', 'wire-fence'],
        },
        {
          code: 'SH0430',
          name: 'Fence line',
          description: 'Low angle along the wires: tensioners, posts, and the mountains behind.',
          at: 77.7,
          duration: 4,
          stage: 'final',
          assignees: ['priya', 'sofia'],
          assets: ['wire-fence'],
        },
        {
          code: 'SH0440',
          name: 'The arc',
          description: 'The current arcs blue across the wires, lighting the whole set.',
          at: 91,
          duration: 2.5,
          stage: 'final',
          assignees: ['rui', 'malik'],
          assets: ['wire-fence'],
          brief: `# SH0440 — The arc

::small The FX shot of the series · delivered

## Brief

One discharge, two and a half seconds, and it has to light everything it touches. The arc is
simulated once and cached — do not re-run it per version.

::progress FX 100 %
::progress Lighting 100 %
::progress Compositing 100 %
`,
          feedback: [
            {
              stage: 'comp',
              notes: [
                {
                  by: 'marisol',
                  text: 'The arc is beautiful but it lights nothing. It has to spill onto the posts and the grass, or it sits on top of the plate.',
                  at: 1,
                  draw: {
                    shape: 'arrow',
                    from: [0.7, 0.7],
                    to: [0.5, 0.48],
                    color: '#4cc9f0',
                    label: 'spill',
                  },
                  state: 'RESOLVED',
                  replies: [
                    {
                      by: 'malik',
                      text: 'Added an interactive light pass driven by the arc geometry. Much better integrated.',
                    },
                  ],
                  reactions: [{ by: 'rui', emoji: '🔥' }],
                },
              ],
            },
          ],
        },
        {
          code: 'SH0450',
          name: 'Singed',
          description: 'Koro walks off with his coat blackened, entirely unbothered.',
          at: 107,
          duration: 4,
          stage: 'final',
          assignees: ['elodie', 'priya'],
          assets: ['koro', 'wire-fence'],
        },
      ],
    },
    {
      code: 'SQ050',
      name: 'Frozen Lake',
      description: 'Winter. Koro on the ice, and a penguin with the same idea.',
      episode: 'EP03',
      assignees: ['tomas', 'elodie'],
      brief: `# SQ050 — Frozen Lake

::small 4 shots · in production · the sequence the episode turns on

## Intent

Ice takes the weight out of every move. Koro cannot plant a foot, and that is the whole
comedy: he has to want the berry more than he can stay upright.

::progress Layout 100 %
::progress Animation 62 %
::progress Lighting 25 %
`,
      shots: [
        {
          code: 'SH0500',
          name: 'On the ice',
          description: 'Koro slides onto the frozen lake, legs splaying under him.',
          at: 10.7,
          duration: 4,
          stage: 'comp',
          assignees: ['kenji', 'sofia'],
          assets: ['koro', 'frozen-lake'],
          brief: `# SH0500 — On the ice

::small The shot everyone quotes when they talk about the episode

## Brief

Four legs, four different directions, and a head that stays perfectly level. The gag is the
contrast: the body panics, the face does not.

::progress Animation 100 %
::progress Lighting 100 %
::progress Compositing 80 %
`,
          feedback: [
            {
              stage: 'lighting',
              notes: [
                {
                  by: 'marisol',
                  text: 'Snow bounce is killing the eyes — he reads as a mask. Flag the ground bounce and keep a single hard key from camera-left.',
                  at: 2,
                  draw: { shape: 'box', x: 0.34, y: 0.18, w: 0.32, h: 0.26, color: '#4cc9f0', label: 'eyes' },
                  state: 'RESOLVED',
                  replies: [
                    { by: 'sofia', text: 'Flagged the bounce and cooled the rim. v005 up.' },
                    { by: 'tomas', text: 'Catchlight is back. Good.' },
                  ],
                  reactions: [
                    { by: 'sofia', emoji: '👀' },
                    { by: 'ines', emoji: '🔥' },
                  ],
                },
              ],
            },
          ],
          extraMedia: [{ stage: 'layout', media: [{ type: 'usdShot' }] }],
          markers: [{ at: 1.8, name: 'Slide starts', color: '#f5b841', by: 'marisol' }],
        },
        {
          code: 'SH0510',
          name: 'Oti arrives',
          description: 'Koro lands flat on the ice; the penguin walks into frame beside him, dead calm.',
          at: 22.2,
          duration: 3.5,
          stage: 'anim',
          assignees: ['kenji'],
          assets: ['koro', 'oti', 'frozen-lake'],
          feedback: [
            {
              stage: 'anim',
              notes: [
                {
                  by: 'tomas',
                  text: 'Oti enters too early — we see him before Koro has finished falling, and the reveal is wasted. Delay the entrance by twelve frames.',
                  at: 1.1,
                  state: 'WIP',
                  assignee: 'kenji',
                  spawnTask: { dept: 'ANIMATION', name: 'Delay Oti entrance — SH0510', assignee: 'kenji' },
                },
              ],
            },
          ],
        },
        {
          code: 'SH0520',
          name: 'Face down',
          description: 'Close on Koro, chin flat on the ice, one eye still tracking.',
          at: 25.9,
          duration: 3.5,
          stage: 'lighting',
          assignees: ['elodie', 'sofia'],
          assets: ['koro', 'frozen-lake'],
        },
        {
          code: 'SH0530',
          name: 'Snow bank',
          description: 'Koro sits up in the snow, ice fragments scattered around him.',
          at: 44.8,
          duration: 2,
          stage: 'blocking',
          assignees: ['elodie'],
          assets: ['koro'],
        },
      ],
    },
    {
      code: 'SQ060',
      name: 'The Train',
      description: 'A steam locomotive crosses the valley at the worst possible moment.',
      episode: 'EP03',
      assignees: ['rui', 'hannah'],
      shots: [
        {
          code: 'SH0600',
          name: 'Steam engine',
          description: 'The locomotive charges past, steam rolling off the stack.',
          at: 32.3,
          duration: 1.2,
          stage: 'lighting',
          assignees: ['rui', 'sofia'],
          assets: ['locomotive'],
          feedback: [
            {
              stage: 'anim',
              notes: [
                {
                  by: 'marisol',
                  text: 'The steam dissipates far too evenly. Stagger the lifetimes and let the wind take the top of the plume.',
                  at: 1.2,
                  state: 'OPEN',
                  assignee: 'rui',
                },
              ],
            },
          ],
        },
        {
          code: 'SH0610',
          name: 'On the tracks',
          description: 'Down the rails: the engine far off, Oti planted between the sleepers.',
          at: 37.6,
          duration: 1.8,
          stage: 'anim',
          assignees: ['kenji'],
          assets: ['locomotive', 'oti'],
        },
      ],
    },
    {
      code: 'SQ070',
      name: 'The Mine',
      description: 'An abandoned shaft under the snow, and what the penguin keeps in it.',
      episode: 'EP03',
      assignees: ['hannah', 'priya'],
      shots: [
        {
          code: 'SH0700',
          name: 'In the mine',
          description: 'Koro edges along the timbered gallery, lit from the entrance behind him.',
          at: 57.5,
          duration: 3.5,
          stage: 'anim',
          assignees: ['elodie'],
          assets: ['koro', 'mine-props', 'rock-set'],
        },
        {
          code: 'SH0710',
          name: 'The cart',
          description: 'Koro and Oti ride the mine cart, the berry cluster wedged between them.',
          at: 70.2,
          duration: 2.5,
          stage: 'layout',
          assignees: ['hannah'],
          assets: ['koro', 'oti', 'mine-props', 'berry'],
        },
        {
          code: 'SH0720',
          name: 'The stash',
          description: 'Insert on the berry cluster in the snow, redder than anything else in the film.',
          at: 125,
          duration: 2,
          stage: 'layout',
          assignees: ['priya'],
          assets: ['berry'],
        },
      ],
    },
    {
      code: 'SQ080',
      name: 'Downhill',
      description: 'The last run across the snow, and the beat that ends the episode.',
      episode: 'EP03',
      assignees: ['tomas', 'elodie'],
      shots: [
        {
          code: 'SH0800',
          name: 'Snow slide',
          description: 'Wide on the peaks; Koro comes down the slope on his side, spraying snow.',
          at: 93.8,
          duration: 4,
          stage: 'blocking',
          assignees: ['elodie'],
          assets: ['koro'],
        },
        {
          code: 'SH0810',
          name: 'Chewing',
          description: 'Close on Koro, chewing, entirely pleased with himself.',
          at: 104.6,
          duration: 4,
          stage: 'briefed',
          assignees: ['kenji'],
          assets: ['koro'],
        },
        {
          code: 'SH0820',
          name: 'Last look',
          description: 'Final close-up before the cut to the wide. Trimmed out of the current edit.',
          at: 108.5,
          duration: 2,
          stage: 'briefed',
          assignees: ['tomas'],
          assets: ['koro'],
          omitted: true,
        },
      ],
    },
  ],
  assets: [
    {
      key: 'koro',
      name: 'Koro',
      type: 'CHARACTER',
      typeLabel: 'Hero character',
      description: 'The guanaco. One rig across all three episodes, with a winter coat variant for EP03.',
      stage: 'lighting',
      assignees: ['priya', 'noah'],
      still: { at: 26.5, film: 'caminandes3' },
      brief: `# Koro

::small Lead character · rig v021 · shared by the three episodes

## The rig

- Oldest asset of the series and the most reused. **Any change is a series-wide change**:
  post in the pipeline channel before publishing.
- Four-legged setup with a dedicated neck chain — do not counter-animate the head on the
  chain, it fights the follow-through.
- The winter coat is a variant, not a separate asset. EP03 selects it in the layout layer.

::progress Modeling 100 %
::progress Rigging 92 %
::progress Look dev 70 %
`,
      feedback: [
        {
          by: 'elodie',
          text: 'The neck chain snaps between the second and third control — no interpolation in the middle third, and the ice shots are impossible like this.',
          state: 'WIP',
          assignee: 'noah',
          replies: [
            {
              by: 'noah',
              text: 'Found it: the blend driver was keyed stepped. Rebuilding on a spline, rig v022 tonight.',
            },
            { by: 'tomas', text: 'Hold SH0530 until v022 lands.' },
          ],
          reactions: [{ by: 'elodie', emoji: '🙏' }],
        },
      ],
    },
    {
      key: 'oti',
      name: 'Oti',
      type: 'CHARACTER',
      typeLabel: 'Creature',
      description: 'The Magellanic penguin. Small, fast, and entirely without remorse.',
      stage: 'anim',
      assignees: ['priya', 'noah'],
      still: { at: 23, film: 'caminandes3' },
      brief: `# Oti

::small Second character · introduced in EP03 · rig v008

Built for speed rather than nuance: three expressions, and he never needs a fourth. The waddle
cycle is baked into the rig — do not re-time it per shot.
`,
    },
    {
      key: 'wire-fence',
      name: 'Wire Fence',
      type: 'PROP',
      typeLabel: 'Hero prop',
      description: 'The five-wire fence of EP02, modular by section, with the live-wire dressing.',
      stage: 'final',
      assignees: ['priya', 'rui'],
      still: { at: 79, film: 'caminandes2' },
      brief: `# Wire Fence

::small Hero prop · EP02 · modular sections · published

## Build notes

- Sections are five metres; posts carry their own insulators, so the electric dressing is a
  variant rather than a second asset.
- The wires are simulated, not animated: the cache ships **with** the asset.
- Compositing pulls the wires as a separate matte — keep them on their own material.

::progress Modeling 100 %
::progress Look dev 100 %
::progress FX setup 100 %
`,
    },
    {
      key: 'locomotive',
      name: 'Steam Locomotive',
      type: 'VEHICLE',
      description: 'The narrow-gauge engine that crosses the valley in EP03.',
      stage: 'lookdev',
      assignees: ['priya'],
      still: { at: 31.2, film: 'caminandes3' },
    },
    {
      key: 'berry',
      name: 'Berry Cluster',
      type: 'PROP',
      description:
        'The berries Oti keeps in the mine. Smallest asset of the series, and the reason for the episode.',
      stage: 'final',
      assignees: ['priya'],
      still: { at: 125.6, film: 'caminandes3' },
    },
    {
      key: 'patagonia',
      name: 'Patagonia Plains',
      type: 'ENVIRONMENT',
      description:
        'The base set: grass tufts, gravel, boulders and the mountain backdrop. One set, three episodes.',
      stage: 'lighting',
      assignees: ['priya', 'sofia'],
      still: { at: 9.5, film: 'caminandes2' },
      splat: { scan: 'rock_moss_set_01', count: 220000 },
      brief: `# Patagonia Plains

::small Environment · shared by the three episodes · scan-backed

The ground was scanned on a location survey. The Gaussian splat stays published as the
**reference** the built set is matched against: it is never rendered, but every lighting
version is checked against it.

::progress Built set 85 %
::progress Scan cleanup 100 %
`,
      feedback: [
        {
          by: 'sofia',
          text: 'The scan is our only ground truth for the horizon line and the gravel colour. Please keep it published — I check every lighting version against it.',
          state: 'OPEN',
          reactions: [{ by: 'hannah', emoji: '👍' }],
        },
      ],
    },
    {
      key: 'frozen-lake',
      name: 'Frozen Lake',
      type: 'ENVIRONMENT',
      description: 'The ice surface of EP03 — a shader problem far more than a modelling one.',
      stage: 'lighting',
      assignees: ['sofia', 'priya'],
      still: { at: 11.5, film: 'caminandes3' },
    },
    {
      key: 'rock-set',
      name: 'Rock Set',
      type: 'ENVIRONMENT',
      typeLabel: 'Set dressing',
      description:
        'Scattered boulders dressing the plain and the mine mouth. Two look variants: clean and weathered.',
      stage: 'final',
      assignees: ['priya'],
      usd: { polyHavenSlug: 'namaqualand_rocks_01', scale: 1 },
      brief: `# Rock Set

::small Set dressing · referenced in 4 shots · published

## Build notes

- Ships as a full USD asset graph: interface layer, payload, geometry layer, material library,
  binding layer, and a **look variant set** (clean / weathered).
- Render and proxy purposes both ship — layout must never load the render mesh.
`,
    },
    {
      key: 'dead-tree',
      name: 'Dead Timber',
      type: 'PROP',
      typeLabel: 'Set dressing',
      description: 'Bleached trunks used as silhouette breaks on the horizon line.',
      stage: 'lookdev',
      assignees: ['priya'],
      usd: { polyHavenSlug: 'dead_tree_trunk', scale: 1 },
    },
    {
      key: 'mine-props',
      name: 'Mine Props',
      type: 'PROP',
      typeLabel: 'Set dressing',
      description: 'Crates and timber dressing the abandoned shaft of EP03.',
      stage: 'lookdev',
      assignees: ['priya'],
      usd: { polyHavenSlug: 'wooden_crate_01', scale: 1 },
    },
    {
      key: 'quadruped-cycle',
      name: 'Quadruped Cycle',
      type: 'OTHER',
      typeLabel: 'Animation reference',
      description:
        'Reference walk cycle used to check Koro’s leg timing. Khronos glTF sample (CC0) — a reference, never rendered.',
      stage: 'final',
      assignees: ['noah', 'elodie'],
      glb: 'fox',
      brief: `# Quadruped Cycle

::small Animation reference · CC0 · not part of the film

An open-licence quadruped rig kept in the library so animators can compare leg timing and
weight transfer without opening a production file. It never appears in a shot, and it is not
maintained beyond that use.
`,
    },
  ],
  playlists: [
    {
      name: 'Dailies — Monday',
      shots: ['SH0500', 'SH0510', 'SH0520', 'SH0600', 'SH0700'],
      createdBy: 'ines',
    },
    {
      name: 'EP03 — animation review',
      shots: ['SH0500', 'SH0510', 'SH0520', 'SH0530', 'SH0800'],
      createdBy: 'tomas',
    },
    {
      name: 'Series highlights',
      shots: ['SH0100', 'SH0230', 'SH0320', 'SH0400', 'SH0440'],
      createdBy: 'ines',
    },
  ],
  shares: [
    {
      label: 'Producer — weekly reel',
      scope: 'PLAYLIST',
      playlist: 'Series highlights',
      permission: 'COMMENT',
      createdBy: 'ines',
      expiresInDays: 21,
    },
    {
      label: 'Broadcaster — EP03 preview',
      scope: 'PLAYLIST',
      playlist: 'EP03 — animation review',
      permission: 'VIEW',
      createdBy: 'ada',
      expiresInDays: 14,
      password: true,
      maxViews: 50,
    },
  ],
};
