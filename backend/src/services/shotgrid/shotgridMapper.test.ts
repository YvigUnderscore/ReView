// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { AssetType, TaskStatus, TaskType } from '@prisma/client';
import {
  asDate,
  asEntityRef,
  disambiguatedName,
  plainName,
  asEntityRefs,
  attachmentName,
  attachmentUrl,
  cutDuration,
  minutesToWorkdays,
  pickVersionMediaField,
  rgbToHex,
  sgAssetType,
  sgDisplayName,
  sgStatusIsApproval,
  sgStatusIsRetake,
  sgStatusToEnum,
  sgStepToTaskType,
  toSgDate,
  workdaysToMinutes,
} from './shotgridMapper';

describe('shotgridMapper — couleurs de statut', () => {
  it('convertit le RGB décimal de ShotGrid en hexadécimal', () => {
    expect(rgbToHex('202,225,202')).toBe('#CAE1CA');
    expect(rgbToHex('45,140,240')).toBe('#2D8CF0');
    expect(rgbToHex('0,0,0')).toBe('#000000');
    expect(rgbToHex('255,255,255')).toBe('#FFFFFF');
  });

  it('tolère les espaces et accepte un hexadécimal déjà formé', () => {
    expect(rgbToHex(' 60 , 190 , 90 ')).toBe('#3CBE5A');
    expect(rgbToHex('#aabbcc')).toBe('#AABBCC');
  });

  it('retombe sur le gris neutre plutôt que d’échouer', () => {
    expect(rgbToHex(null)).toBe('#6B7280');
    expect(rgbToHex('bleu')).toBe('#6B7280');
    expect(rgbToHex('300,0,0')).toBe('#6B7280');
    expect(rgbToHex('1,2')).toBe('#6B7280');
  });
});

describe('shotgridMapper — statuts', () => {
  it('rapproche les codes ShotGrid standard de l’enum ReView', () => {
    expect(sgStatusToEnum('ip')).toBe(TaskStatus.IN_PROGRESS);
    expect(sgStatusToEnum('rev')).toBe(TaskStatus.PENDING_REVIEW);
    expect(sgStatusToEnum('apr')).toBe(TaskStatus.APPROVED);
    expect(sgStatusToEnum('fin')).toBe(TaskStatus.APPROVED);
    expect(sgStatusToEnum('cbb')).toBe(TaskStatus.RETAKE);
    // « rtk » est le code de reprise le plus répandu sur les sites réels, alors qu'il
    // ne figure dans aucune liste standard : l'oublier rangeait ces tâches en « à faire ».
    expect(sgStatusToEnum('rtk')).toBe(TaskStatus.RETAKE);
    expect(sgStatusToEnum('pass')).toBe(TaskStatus.APPROVED);
    expect(sgStatusToEnum('suprev')).toBe(TaskStatus.PENDING_REVIEW);
    expect(sgStatusToEnum('omt')).toBe(TaskStatus.REJECTED);
    expect(sgStatusToEnum('WTG')).toBe(TaskStatus.TODO);
  });

  it('range un code inconnu en TODO sans lever', () => {
    expect(sgStatusToEnum('zzz_custom')).toBe(TaskStatus.TODO);
    expect(sgStatusToEnum(null)).toBe(TaskStatus.TODO);
    expect(sgStatusToEnum(undefined)).toBe(TaskStatus.TODO);
  });

  it('distingue approbation et demande de reprise', () => {
    expect(sgStatusIsApproval('apr')).toBe(true);
    expect(sgStatusIsApproval('fin')).toBe(true);
    expect(sgStatusIsApproval('ip')).toBe(false);
    expect(sgStatusIsRetake('cbb')).toBe(true);
    expect(sgStatusIsRetake('rrq')).toBe(true);
    expect(sgStatusIsRetake('apr')).toBe(false);
  });
});

describe('shotgridMapper — durées', () => {
  it('convertit les minutes ouvrées de ShotGrid en jours', () => {
    // 2400 minutes = 5 jours de 8 h, l'exemple du cookbook officiel.
    expect(minutesToWorkdays(2400)).toBe(5);
    expect(minutesToWorkdays(480)).toBe(1);
    expect(minutesToWorkdays(240)).toBe(0.5);
  });

  it('ignore les durées absentes ou absurdes', () => {
    expect(minutesToWorkdays(0)).toBeNull();
    expect(minutesToWorkdays(-10)).toBeNull();
    expect(minutesToWorkdays(null)).toBeNull();
    expect(minutesToWorkdays(Number.NaN)).toBeNull();
  });

  it('fait l’aller-retour jours → minutes', () => {
    expect(workdaysToMinutes(5)).toBe(2400);
    expect(workdaysToMinutes(1)).toBe(480);
    expect(workdaysToMinutes(null)).toBeNull();
  });

  it('compte la durée d’un plan bornes incluses', () => {
    expect(cutDuration(1001, 1096)).toBe(96);
    expect(cutDuration(1001, 1001)).toBe(1);
    expect(cutDuration(1096, 1001)).toBeNull();
    expect(cutDuration(null, 1096)).toBeNull();
  });
});

describe('shotgridMapper — dates', () => {
  it('lit les dates simples et les horodatages complets', () => {
    expect(asDate('2026-08-20')?.toISOString()).toBe('2026-08-20T00:00:00.000Z');
    expect(asDate('2026-08-20T14:30:00Z')?.toISOString()).toBe('2026-08-20T14:30:00.000Z');
  });

  it('rejette ce qui n’est pas une date', () => {
    expect(asDate('')).toBeNull();
    expect(asDate('demain')).toBeNull();
    expect(asDate(null)).toBeNull();
    expect(asDate(42)).toBeNull();
  });

  it('réécrit une date au format attendu par ShotGrid', () => {
    expect(toSgDate(new Date('2026-08-20T14:30:00Z'))).toBe('2026-08-20');
    expect(toSgDate(null)).toBeNull();
  });
});

describe('shotgridMapper — références d’entités', () => {
  it('reconnaît une référence complète', () => {
    expect(asEntityRef({ type: 'Shot', id: 12, name: 'SH010' })).toEqual({
      type: 'Shot',
      id: 12,
      name: 'SH010',
    });
  });

  it('refuse ce qui n’est pas une référence', () => {
    expect(asEntityRef(null)).toBeNull();
    expect(asEntityRef({ id: 'douze', type: 'Shot' })).toBeNull();
    expect(asEntityRef({ id: 12 })).toBeNull();
    expect(asEntityRef('Shot')).toBeNull();
  });

  it('filtre les listes de références', () => {
    expect(
      asEntityRefs([{ type: 'HumanUser', id: 1 }, null, { id: 2 }, { type: 'HumanUser', id: 3 }]),
    ).toHaveLength(2);
    expect(asEntityRefs(undefined)).toEqual([]);
  });
});

describe('shotgridMapper — types', () => {
  it('devine le type d’asset depuis le vocabulaire du site', () => {
    expect(sgAssetType('Character')).toBe(AssetType.CHARACTER);
    expect(sgAssetType('Hero Character')).toBe(AssetType.CHARACTER);
    expect(sgAssetType('Vehicle')).toBe(AssetType.VEHICLE);
    expect(sgAssetType('Environment')).toBe(AssetType.ENVIRONMENT);
    expect(sgAssetType('Set Piece')).toBe(AssetType.ENVIRONMENT);
    expect(sgAssetType('FX Rig')).toBe(AssetType.FX);
    expect(sgAssetType('Matte Painting')).toBe(AssetType.OTHER);
    expect(sgAssetType(null)).toBe(AssetType.OTHER);
  });

  it('devine le type de tâche depuis l’étape de pipeline', () => {
    expect(sgStepToTaskType('Animation')).toBe(TaskType.ANIMATION);
    expect(sgStepToTaskType('Character Modeling')).toBe(TaskType.MODELING);
    expect(sgStepToTaskType('Lookdev')).toBe(TaskType.LOOKDEV);
    expect(sgStepToTaskType('Shading')).toBe(TaskType.LOOKDEV);
    expect(sgStepToTaskType('Compositing')).toBe(TaskType.COMPOSITING);
    expect(sgStepToTaskType('Blocking')).toBe(TaskType.LAYOUT);
    expect(sgStepToTaskType('Setdress')).toBe(TaskType.OTHER);
  });
});

describe('shotgridMapper — médias et libellés', () => {
  const version = {
    id: 1,
    type: 'Version',
    code: 'SH010_v001',
    sg_uploaded_movie: { name: 'master.mov' },
    sg_uploaded_movie_mp4: { name: 'proxy.mp4' },
  };

  it('préfère le transcodé ou l’original selon le réglage', () => {
    expect(pickVersionMediaField(version, 'transcoded')?.field).toBe('sg_uploaded_movie_mp4');
    expect(pickVersionMediaField(version, 'original')?.field).toBe('sg_uploaded_movie');
  });

  it('se rabat sur ce qui existe quand le champ préféré est vide', () => {
    const onlyOriginal = { id: 1, type: 'Version', sg_uploaded_movie: { name: 'master.mov' } };
    expect(pickVersionMediaField(onlyOriginal, 'transcoded')?.field).toBe('sg_uploaded_movie');
    expect(pickVersionMediaField({ id: 1, type: 'Version' }, 'transcoded')).toBeNull();
  });

  it('nomme une entité par son champ le plus parlant', () => {
    expect(sgDisplayName({ id: 1, type: 'Shot', code: 'SH010' })).toBe('SH010');
    expect(sgDisplayName({ id: 2, type: 'Task', content: 'Animation' })).toBe('Animation');
    expect(sgDisplayName({ id: 3, type: 'Project', name: 'Demo' })).toBe('Demo');
    expect(sgDisplayName({ id: 4, type: 'Shot' })).toBe('Shot 4');
  });

  it('retrouve le nom de fichier d’une pièce jointe', () => {
    expect(attachmentName({ name: 'plan.mov' }, 'defaut')).toBe('plan.mov');
    expect(attachmentName(null, 'defaut')).toBe('defaut');
  });
});

describe('attachmentUrl', () => {
  it('lit l’adresse portée par le champ fichier', () => {
    // Repli quand l'endpoint de téléchargement dédié ne répond pas.
    expect(attachmentUrl({ name: 'v001.mov', url: 'https://s3/signed' })).toBe('https://s3/signed');
  });

  it('descend dans un attachment imbriqué', () => {
    expect(attachmentUrl({ attachment: { url: 'https://s3/nested' } })).toBe('https://s3/nested');
  });

  it('rend null quand il n’y a rien à télécharger', () => {
    expect(attachmentUrl({ name: 'v001.mov' })).toBeNull();
    expect(attachmentUrl(null)).toBeNull();
    expect(attachmentUrl('https://direct')).toBeNull();
  });
});

describe('disambiguatedName / plainName', () => {
  it('sépare deux entités du site qui portent le même code', () => {
    // Un site accepte quatre séquences « DO_NOT_USE_ » ; la base locale, une seule.
    expect(disambiguatedName('DO_NOT_USE_', 4686)).toBe('DO_NOT_USE_ (4686)');
  });

  it('retrouve le nom du site pour comparer sans faux écart', () => {
    expect(plainName('DO_NOT_USE_ (4686)', 4686)).toBe('DO_NOT_USE_');
    expect(plainName('sq010', 4685)).toBe('sq010');
  });

  it("ne retire que le suffixe de l'entité comparée", () => {
    // Un nom qui finit par les parenthèses d'un AUTRE identifiant reste intact.
    expect(plainName('DO_NOT_USE_ (4686)', 4687)).toBe('DO_NOT_USE_ (4686)');
    expect(plainName(null, 1)).toBeNull();
  });

  it('est stable : re-synchroniser n’empile pas les suffixes', () => {
    const once = disambiguatedName('Alba', 19472);
    expect(plainName(once, 19472)).toBe('Alba');
  });
});
