## Mission principale

Tu es Codex.

Ta mission est de lire le rapport d’audit technique situé ici :

`docs/REVIEW-2.0-audit-report.md`

Puis de créer ou mettre à jour le fichier suivant :

`docs/Review-2.0.md`

Le fichier `docs/Review-2.0.md` doit contenir un **prompt maître complet** destiné à un futur contexte d’IA totalement vierge.

Ce futur contexte devra pouvoir concevoir et construire **ReView 2.0 from scratch**, proprement, sans rien oublier.

---

## Point très important

Le prompt final dans `docs/Review-2.0.md` ne doit pas raconter l’historique du projet.

Il ne doit pas présenter ReView 2.0 comme une migration, une correction ou une continuité technique d’une ancienne version.

Il doit parler uniquement de **ReView 2.0**.

Tu peux simplement indiquer que ReView 2.0 repart sur des bases saines, modernes et production-ready.

Le rapport d’audit doit être utilisé uniquement comme source de compréhension interne pour :

* identifier les fonctionnalités à reconstruire ;
* comprendre les besoins produit ;
* éviter les erreurs d’architecture ;
* déduire les modules nécessaires ;
* proposer un modèle de données propre ;
* définir les exigences de sécurité, permissions, stockage, média, admin et qualité.

Mais le prompt final ne doit pas exposer les détails historiques inutiles.

---

## Règles générales

* Lire intégralement `docs/REVIEW-2.0-audit-report.md` avant d’écrire.
* Ne pas modifier `docs/REVIEW-2.0-audit-report.md`.
* Ne pas modifier le code applicatif.
* Ne pas créer de fichiers applicatifs.
* Créer ou mettre à jour uniquement `docs/Review-2.0.md`, sauf instruction explicite contraire.
* Rédiger en français.
* Écrire un document autonome.
* Partir du principe que le futur contexte IA ne connaît rien au projet.
* Ne pas supposer que le futur contexte IA aura accès à l’audit.
* Ne pas mentionner d’ancienne version dans le prompt final.
* Ne pas inclure de section historique.
* Ne pas inclure de plan de migration historique.
* Ne pas parler d’anciennes données à transférer.
* Présenter ReView 2.0 comme un nouveau produit construit sur une base vierge.
* Privilégier les choix production-ready.
* Trancher les décisions ouvertes quand c’est possible.
* Si une décision reste réellement impossible à prendre, la lister clairement dans une section dédiée.

---

## Objectif de `docs/Review-2.0.md`

`docs/Review-2.0.md` doit être un prompt maître réutilisable dans un nouveau contexte IA.

Il doit expliquer comment concevoir et construire ReView 2.0 de A à Z :

* vision produit ;
* périmètre fonctionnel ;
* architecture cible ;
* stack recommandée ;
* modèle de données ;
* permissions ;
* sécurité ;
* stockage média ;
* traitements asynchrones ;
* API ;
* web ;
* mobile futur ;
* intégrations DCC futures ;
* administration ;
* limites système ;
* tests ;
* observabilité ;
* déploiement ;
* roadmap MVP et post-MVP.

Le document doit être suffisamment complet pour qu’un nouveau contexte IA puisse commencer la conception et l’implémentation sans dépendre d’un autre document.

---

## Orientation produit ReView 2.0

Le prompt final doit présenter ReView 2.0 comme une plateforme moderne de review collaborative de médias pour :

* studios VFX ;
* animation ;
* post-production ;
* équipes créatives ;
* freelances ;
* clients externes.

ReView 2.0 doit être pensé comme une plateforme multi-clients :

* web en priorité ;
* mobile à prévoir ;
* intégrations DCC possibles à l’avenir ;
* API stable ;
* backend robuste ;
* workers pour les traitements lourds ;
* stockage média scalable ;
* base de données propre.

---

## Architecture attendue

Le prompt final doit éviter de recommander une architecture monolithique classique trop couplée.

ReView 2.0 doit être conçu avec une architecture modulaire, extensible et production-ready.

Orientation recommandée :

```txt
apps/
  web/
  api/
  worker/
  mobile/        # futur
  dcc-plugins/   # futur

packages/
  domain/
  contracts/
  database/
  auth/
  permissions/
  media/
  storage/
  jobs/
  events/
  ui/
  config/
  observability/
```

Le prompt final doit expliquer que :

* le backend expose une API claire et stable ;
* le web, le mobile et les futures intégrations DCC consomment cette API ;
* les traitements média lourds sont isolés dans des workers ;
* les types, validations et contrats peuvent être partagés ;
* la base de données doit être conçue proprement dès le départ ;
* le stockage média doit être indépendant du serveur applicatif.

---

## Décisions produit à intégrer

### Projet obligatoire

Dans ReView 2.0 :

* un projet est obligatoire ;
* aucun média ne doit exister hors projet ;
* aucune review ne doit exister hors projet ;
* aucun commentaire ne doit exister hors projet ;
* aucune version ne doit exister hors projet.

Toutes les entités métier doivent pouvoir remonter clairement à un projet.

### Permissions des invités

Les invités ou utilisateurs externes peuvent uniquement :

* consulter ;
* commenter.

Ils ne peuvent pas :

* administrer ;
* uploader ;
* supprimer ;
* modifier la structure projet ;
* gérer les permissions ;
* accéder aux commentaires internes ;
* accéder à des ressources hors périmètre du partage.

### Partage public et privé

ReView 2.0 doit prévoir :

* partage privé ;
* partage public contrôlé ;
* liens sécurisés ;
* secrets hashés ;
* révocation ;
* expiration optionnelle ;
* sessions invitées ;
* audit des accès ;
* séparation stricte entre contenu interne et contenu partagé.

### Base de données vierge

ReView 2.0 part sur une base de données totalement neuve.

Le modèle de données doit être conçu proprement, sans contrainte historique.

### Expiration des partages

Les liens de partage doivent pouvoir être :

* actifs ;
* inactifs ;
* expirés ;
* révoqués.

Ils doivent pouvoir avoir ou non une date d’expiration.

### Règles France par défaut

ReView 2.0 doit appliquer par défaut les règles pertinentes pour la France.

L’administrateur doit pouvoir configurer ou surcharger certaines règles depuis l’interface d’administration.

Prévoir :

* paramètres globaux ;
* règles administrables ;
* historique des changements ;
* traçabilité ;
* séparation entre règles métier, configuration technique et secrets.

### USD post-MVP

La première version de ReView 2.0 ne doit pas inclure le support USD.

Le support USD, USDA, USDC ou USDZ doit être prévu comme évolution future.

L’architecture doit rester extensible pour l’ajouter plus tard.

### Limites par défaut

Les limites par défaut sont :

* 20 uploads simultanés ;
* 10 projets par utilisateur ;
* taille maximale d’un fichier : 500 MB ;
* stockage maximal par utilisateur : 10 GB ;
* stockage maximal par projet : 50 GB ;
* débit maximal : 1000 Mb/s.

Toutes ces limites doivent être configurables depuis le panel admin.

Prévoir :

* limites globales ;
* surcharges par utilisateur ;
* surcharges par projet ;
* surcharges par workspace si pertinent ;
* validation backend ;
* feedback UI clair ;
* audit des dépassements ;
* protection contre les abus.

---

## Stack technique recommandée

Le prompt final doit recommander une stack production-ready.

Orientation par défaut :

* TypeScript partout ;
* monorepo ;
* React pour le web ;
* React Native ou Expo pour le mobile futur ;
* API Node.js TypeScript ;
* Fastify, NestJS ou framework équivalent justifié ;
* PostgreSQL ;
* migrations versionnées ;
* ORM ou query builder typé ;
* Redis ;
* queue de jobs ;
* stockage objet compatible S3 ;
* FFmpeg dans des workers ;
* OpenAPI ;
* Zod ou validation équivalente ;
* tests unitaires ;
* tests d’intégration ;
* tests E2E ;
* Docker pour le développement ;
* CI/CD ;
* logs structurés ;
* audit log ;
* observabilité.

Si plusieurs options sont possibles, le prompt final doit demander au futur contexte IA de comparer brièvement puis de choisir une option par défaut.

---

## Contenu obligatoire du prompt final

`docs/Review-2.0.md` doit contenir au minimum :

1. Rôle de l’IA cible.
2. Mission globale.
3. Vision produit ReView 2.0.
4. Objectifs de conception.
5. Architecture cible.
6. Stack recommandée.
7. Modèle de domaine cible.
8. Schéma de base de données attendu.
9. Fonctionnalités MVP.
10. Fonctionnalités post-MVP.
11. Permissions et sécurité.
12. Partage public/privé.
13. Stockage média.
14. Traitements asynchrones.
15. API et contrats.
16. Web app.
17. Mobile futur.
18. Intégrations DCC futures.
19. Administration.
20. Limites configurables.
21. Observabilité.
22. Tests et qualité.
23. Déploiement.
24. Roadmap de construction.
25. Livrables attendus du futur contexte IA.

---

## Modèle de domaine à faire apparaître

Le prompt final doit demander au futur contexte IA de concevoir au minimum les entités suivantes :

* User ;
* Workspace ou Organization ;
* Membership ;
* Role ;
* Permission ;
* Project ;
* ProjectMember ;
* Asset ;
* AssetVersion ;
* MediaObject ;
* Comment ;
* CommentThread ;
* Annotation ;
* Reaction ;
* ReviewStatus ;
* ShareLink ;
* GuestSession ;
* Notification ;
* NotificationPreference ;
* Job ;
* AuditLog ;
* SystemSetting ;
* AdminRule ;
* QuotaPolicy ;
* StorageUsage.

Le futur modèle PostgreSQL doit inclure :

* clés primaires ;
* clés étrangères ;
* contraintes ;
* index ;
* enums ;
* règles d’intégrité ;
* timestamps ;
* soft delete si pertinent ;
* audit des actions sensibles.

---

## Fonctionnalités MVP minimales

Le prompt final doit inclure au minimum ces fonctionnalités dans le MVP :

* setup initial ;
* authentification ;
* gestion utilisateurs ;
* workspaces ou organisations ;
* projets obligatoires ;
* rôles et permissions ;
* upload média ;
* stockage média ;
* versions ;
* review vidéo ;
* review image ;
* review 3D sans USD ;
* commentaires ;
* réponses ;
* annotations ;
* statuts de review ;
* partage privé ;
* partage public contrôlé ;
* sessions invitées ;
* expiration optionnelle des liens ;
* notifications in-app ;
* panneau admin ;
* limites configurables ;
* audit log minimal ;
* tests critiques.

---

## Fonctionnalités post-MVP

Le prompt final doit lister comme post-MVP :

* application mobile complète ;
* intégrations DCC ;
* support USD/USDZ ;
* exports avancés ;
* webhooks publics ;
* API publique ;
* recherche avancée ;
* analytics ;
* workflows avancés ;
* transcodage avancé ;
* collaboration temps réel avancée.

---

## Sécurité obligatoire

Le prompt final doit exiger :

* permissions centralisées ;
* RBAC ou RBAC + ABAC ;
* séparation admin/workspace/project/guest ;
* aucun accès implicite ;
* tests de permissions ;
* liens de partage avec secrets hashés ;
* sessions invitées sécurisées ;
* médias protégés ;
* URLs signées ou mécanisme équivalent ;
* pas de token sensible en URL ;
* secrets hors base applicative ou chiffrés ;
* rate limiting ;
* validation MIME réelle ;
* protection upload ;
* protection zip bomb ;
* audit log ;
* CSP propre ;
* CORS strict en production.

---

## Critères d’acceptation

La tâche est terminée uniquement si :

* `docs/Review-2.0.md` existe ;
* le document est un prompt maître autonome ;
* le document parle uniquement de ReView 2.0 ;
* le document ne contient pas de récit historique ;
* le document ne présente pas ReView 2.0 comme une migration ;
* le document indique seulement que ReView 2.0 repart sur des bases saines ;
* le document peut être utilisé dans un nouveau contexte IA vierge ;
* les décisions produit ci-dessus sont intégrées ;
* le projet obligatoire est intégré ;
* les invités sont limités à consultation/commentaire ;
* les partages publics et privés sont prévus ;
* l’expiration optionnelle est prévue ;
* la base de données neuve est prise en compte ;
* les règles France par défaut sont prévues ;
* l’USD est repoussé post-MVP ;
* les limites par défaut sont intégrées ;
* l’architecture est mobile-ready et DCC-ready ;
* la production-readiness est prioritaire.

---

## Résumé final de la consigne

Lis `docs/REVIEW-2.0-audit-report.md`.

Utilise ce rapport uniquement comme source interne pour comprendre les besoins, les fonctionnalités, les risques et les exigences.

Puis écris dans `docs/Review-2.0.md` un prompt maître complet pour un futur contexte IA vierge.
Prépare également un Agents.md complet pour le futur contexte IA.

Ce prompt doit permettre de concevoir et construire ReView 2.0 from scratch, sur des bases saines, modernes, modulaires et production-ready.
