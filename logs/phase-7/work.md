# Phase 7 — Migration stockage → MinIO

**Statut :** ⏳ À faire  
**Branche suggérée :** `phase-7/minio-migration`  
**Prérequis :** Phase 6 terminée (ou peut être parallélisée avec Phase 5/6)

---

## Contexte

Actuellement : fichiers stockés dans `backend/storage/` (filesystem local).  
Cible : MinIO (S3-compatible, self-hosté), ajouté au `docker-compose.yml`.

---

## Tâche 7.1 — Ajouter MinIO au docker-compose

```yaml
minio:
  image: minio/minio
  command: server /data --console-address ":9001"
  ports:
    - "9000:9000"
    - "9001:9001"  # Console admin MinIO
  environment:
    MINIO_ROOT_USER: ${MINIO_ROOT_USER}
    MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
  volumes:
    - minio_data:/data
```

Variables `.env` à ajouter :
- `MINIO_ENDPOINT=http://minio:9000`
- `MINIO_ROOT_USER=...`
- `MINIO_ROOT_PASSWORD=...`
- `MINIO_BUCKET=review-media`

---

## Tâche 7.2 — Service d'abstraction `StorageService`

Créer `backend/services/storage.js` :

```js
// Interface
uploadFile(key, buffer, mimeType) → Promise<url>
getFileStream(key) → ReadableStream
deleteFile(key) → Promise<void>
getPresignedUrl(key, expiresIn) → Promise<string>
```

Implémenté avec `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`.

---

## Tâche 7.3 — Migration des routes d'upload

- `project.routes.js` : remplacer `multer({dest})` + `fs.rename` par `StorageService.uploadFile`
- Chaque upload génère une `key` (ex: `projects/{projectId}/media/{filename}`) stockée en DB à la place du chemin filesystem

---

## Tâche 7.4 — Migration du serving des médias

- `media.routes.js` : remplacer `res.sendFile` par une redirection vers URL présignée MinIO (ou proxy stream)
- URLs présignées valides 1h (paramétrable)

---

## Tâche 7.5 — Script de migration des fichiers existants

Créer `backend/scripts/migrate-to-minio.js` :
1. Parcourir `backend/storage/`
2. Pour chaque fichier → `StorageService.uploadFile`
3. Mettre à jour la DB avec la nouvelle `key`
4. Log de migration

---

## Tâche 7.6 — Tests de régression

- Upload vidéo ✓
- Upload image ✓
- Upload GLB/FBX/ZIP ✓
- Upload PLY/splat ✓
- Preview vidéo (streaming) ✓
- Preview image ✓
- Preview splat (fetch dans iframe SuperSplat) ✓
- Download ✓
