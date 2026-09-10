#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

#
# Agent d'exploitation ReView — exécute, pour le compte de l'administration, les trois
# seules opérations qu'elle sait commander : sauvegarder, vérifier une sauvegarde, mettre
# à jour. Rien d'autre. Il n'y a pas de commande libre dans ce fichier, et c'est le point.
#
# ── Pourquoi un conteneur à part, dans un PROJET compose à part ───────────────
#
# `scripts/update.sh` fait `docker compose up -d` sans liste de services : tout ce qui
# appartient au projet principal est recréé. Un exécuteur logé dans cette pile se
# détruirait donc au milieu de sa propre exécution, laissant l'instance à moitié basculée
# et personne pour jouer le retour arrière. L'agent vit dans le projet `review-ops`, que
# rien de la pile principale ne touche.
#
# ── Pourquoi un spool de fichiers plutôt qu'une file Redis ───────────────────
#
# Parce que le conteneur qui commande est celui qu'on détruit. L'ordre, le journal et le
# verdict doivent survivre au backend qui les a demandés — et être relus, ensuite, par un
# backend d'une AUTRE version. Un fichier sur l'hôte est la seule chose qui traverse ça.
# C'est aussi ce qu'un exploitant peut lire avec `cat`, le jour où plus rien ne répond.
#
# ── Le partage des privilèges ────────────────────────────────────────────────
#
# Le backend écrit dans `ops/queue` et ne lit `ops/state` qu'en lecture seule ; l'agent
# fait l'inverse. Le backend est joignable depuis internet et tourne en root : s'il
# pouvait écrire dans `state/`, il pourrait y pré-poser un lien symbolique et faire
# écrire l'agent — donc le démon docker — n'importe où sur l'hôte. Les deux montages
# distincts SONT la barrière ; les contrôles ci-dessous n'en sont que le second tour.
#
set -euo pipefail

PROTOCOL=1
AGENT_VERSION="${OPS_AGENT_VERSION:-unknown}"
POLL_SEC="${OPS_POLL_SEC:-2}"
MAX_RUNTIME_CAP="${OPS_MAX_RUNTIME:-3600}"
# ⚠ Pas d'apostrophe dans ce message : le mot de `${var:?mot}` subit le traitement des
# guillemets, une apostrophe y ouvre une chaîne et le script entier cesse de s'analyser.
ROOT="${REVIEW_ROOT:?REVIEW_ROOT requis (chemin absolu du depot sur la machine hote)}"
QUEUE_DIR="$ROOT/ops/queue"
STATE_DIR="$ROOT/ops/state"
RUNS_DIR="$STATE_DIR/runs"
AGENT_FILE="$STATE_DIR/agent.json"
CONF_FILE="$ROOT/deploy/agent.conf"

# Autorisations, lues dans un fichier que le backend NE MONTE PAS. C'est la seule barrière
# qu'une compromission du backend ne franchit pas : un attaquant qui obtient une session
# d'administration peut commander ce que l'exploitant a autorisé, jamais davantage.
OPS_ALLOW_UPDATE=1
OPS_ALLOW_BACKUP=1
OPS_ALLOW_VERIFY=1
OPS_ALLOW_DOWNGRADE=0
# Lu par `.` et non interprété autrement : c'est un fichier de l'exploitant, pas un ordre.
# shellcheck source=/dev/null
if [ -f "$CONF_FILE" ]; then . "$CONF_FILE"; fi

log() { printf '%s agent: %s\n' "$(date -Iseconds)" "$1" >&2; }

# ── Fichier témoin : l'agent voit-il le dépôt AU MÊME CHEMIN que l'hôte ? ─────
#
# `scripts/backup.sh` calcule son `pwd` et le passe tel quel à `docker run -v "$HOST_DIR:…"`,
# que le DÉMON résout côté hôte. Si le dépôt était monté ailleurs que sur son chemin hôte,
# le miroir MinIO partirait dans un répertoire vide — sans une seule erreur, découvert le
# jour de la restauration. Ce contrôle transforme cette panne silencieuse en refus net.
ROOT_OK=0
check_root_path() {
  local witness image
  witness=".witness-$$-$(date +%s)"
  : > "$STATE_DIR/$witness"
  image="${REVIEW_OPS_IMAGE:-alpine}"
  if docker run --rm -v "$ROOT/ops/state:/w" "$image" test -f "/w/$witness" >/dev/null 2>&1; then
    ROOT_OK=1
  else
    ROOT_OK=0
    log "le dépôt n'est pas monté sur son chemin hôte ($ROOT) — aucun ordre ne sera accepté"
  fi
  rm -f "$STATE_DIR/$witness"
}

# ── Battement de cœur ────────────────────────────────────────────────────────
#
# Écrit à chaque tour, à vide comme en cours d'exécution : c'est ce qui permet à l'écran
# de distinguer « aucune opération » d'« agent mort ». Écriture atomique (tmp + rename) :
# le backend lit ce fichier en permanence et ne doit jamais tomber sur un demi-JSON.
write_agent_state() {
  local tmp="$STATE_DIR/.agent.json.$$"
  cat > "$tmp" <<JSON
{"protocol":$PROTOCOL,"version":"$AGENT_VERSION","seenAt":"$(date -Iseconds)",
 "rootOk":$([ "$ROOT_OK" -eq 1 ] && echo true || echo false),"pollSec":$POLL_SEC,
 "allow":{"update":$([ "$OPS_ALLOW_UPDATE" -eq 1 ] && echo true || echo false),
          "backup":$([ "$OPS_ALLOW_BACKUP" -eq 1 ] && echo true || echo false),
          "verify":$([ "$OPS_ALLOW_VERIFY" -eq 1 ] && echo true || echo false)}}
JSON
  mv -f "$tmp" "$AGENT_FILE"
}

# Écrit le statut d'un run, atomiquement. Tous les champs à chaque fois : le backend lit
# ce fichier seul, sans mémoire de ce qu'il valait au tour précédent.
write_status() {
  local dir="$1" state="$2" phase="$3" reason="$4" exit_code="$5" ended="$6"
  local tmp="$dir/.status.json.$$"
  cat > "$tmp" <<JSON
{"protocol":$PROTOCOL,"id":"$RUN_ID","kind":"$RUN_KIND","target":"$RUN_TARGET",
 "state":"$state","phase":"$phase","reason":$([ -n "$reason" ] && printf '"%s"' "$reason" || echo null),
 "startedAt":"$RUN_STARTED","heartbeatAt":"$(date -Iseconds)",
 "endedAt":$([ -n "$ended" ] && printf '"%s"' "$ended" || echo null),
 "exitCode":$([ -n "$exit_code" ] && printf '%s' "$exit_code" || echo null),
 "backupId":$([ -n "$RUN_BACKUP_ID" ] && printf '"%s"' "$RUN_BACKUP_ID" || echo null),
 "actor":$RUN_ACTOR,"agentVersion":"$AGENT_VERSION"}
JSON
  mv -f "$tmp" "$dir/status.json"
}

# Un ordre refusé laisse une trace : sans elle, l'écran resterait sur « en attente » pour
# toujours, et personne ne saurait pourquoi.
reject() {
  local id="$1" reason="$2"
  log "ordre refusé ($id) : $reason"
  # Un identifiant qui n'est pas un identifiant ne laisse aucune trace : il servirait de
  # nom de dossier, et c'est précisément ce qu'on refuse de faire avec une valeur douteuse.
  case "$id" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *) return 0 ;;
  esac
  mkdir -p "$RUNS_DIR/$id" 2>/dev/null || return 0
  RUN_ID="$id"
  RUN_TARGET=""
  RUN_STARTED="$(date -Iseconds)"
  RUN_ACTOR="null"
  RUN_BACKUP_ID=""
  write_status "$RUNS_DIR/$id" rejected none "$reason" "" "$(date -Iseconds)"
}

# `1` si $1 précède strictement $2. `sort -V` (coreutils) : la comparaison de versions ne
# se fait pas en texte, « 2.10.0 » suit « 2.9.0 ».
version_lt() {
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" = "$1" ]
}

# ── Purge ────────────────────────────────────────────────────────────────────
# Vingt runs suffisent à l'écran, et un dossier qui grossit sans fin sur le pool de
# données d'un studio est une panne qui arrive des mois plus tard, sans prévenir.
purge_runs() {
  local keep=20
  ls -1d "$RUNS_DIR"/*/ 2>/dev/null | sort -r | tail -n "+$((keep + 1))" | while read -r dir; do
    rm -rf "$dir"
  done || true
}

# ── Une exécution ────────────────────────────────────────────────────────────
run_order() {
  local order="$1"
  local id kind version stamp skip_backup ready_timeout max_runtime actor
  id="$(printf '%s' "$order" | jq -r '.id // empty')"
  kind="$(printf '%s' "$order" | jq -r '.kind // empty')"
  version="$(printf '%s' "$order" | jq -r '.params.version // empty')"
  stamp="$(printf '%s' "$order" | jq -r '.params.backupId // empty')"
  skip_backup="$(printf '%s' "$order" | jq -r '.params.skipBackup // false')"
  ready_timeout="$(printf '%s' "$order" | jq -r '.params.readyTimeoutSec // 600')"
  max_runtime="$(printf '%s' "$order" | jq -r '.params.maxRuntimeSec // 3600')"
  actor="$(printf '%s' "$order" | jq -c '.actor // null')"

  # Identifiant : c'est un NOM DE DOSSIER, donc la première chose à filtrer.
  case "$id" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *) log "ordre ignoré : identifiant invalide"; return 0 ;;
  esac
  RUN_KIND="$kind"

  # Chaque champ numérique est refiltré ICI, quoi qu'en dise le backend. `readyTimeoutSec`
  # atterrit dans une expression arithmétique de update.sh, où bash ré-évalue le contenu
  # des variables : « x[$(commande)] » s'y exécuterait. Trois passes valent mieux qu'une.
  case "$ready_timeout" in ''|*[!0-9]*) reject "$id" BAD_TIMEOUT; return 0 ;; esac
  case "$max_runtime" in ''|*[!0-9]*) reject "$id" BAD_RUNTIME; return 0 ;; esac
  [ "$max_runtime" -le "$MAX_RUNTIME_CAP" ] || max_runtime="$MAX_RUNTIME_CAP"

  if [ "$ROOT_OK" -ne 1 ]; then reject "$id" ROOT_MISMATCH; return 0; fi

  # Vocabulaire fermé. Aucun `eval`, aucun `source`, aucun chemin venu de l'ordre : les
  # arguments sont montés dans un tableau, un par un, à partir de valeurs déjà filtrées.
  local -a argv
  case "$kind" in
    update)
      [ "$OPS_ALLOW_UPDATE" -eq 1 ] || { reject "$id" NOT_ALLOWED; return 0; }
      case "$version" in
        v[0-9]*.[0-9]*.[0-9]*) ;;
        *) reject "$id" BAD_VERSION; return 0 ;;
      esac
      case "$version" in *[!0-9A-Za-z.v-]*) reject "$id" BAD_VERSION; return 0 ;; esac
      # Monotonie : c'est CE contrôle, et non la liste blanche du backend, qui empêche un
      # backend compromis de faire redescendre l'instance sur une version vulnérable.
      local current
      current="$(sed -n 's/^APP_VERSION=//p' "$ROOT/.env" 2>/dev/null | tail -n 1)"
      if [ "$OPS_ALLOW_DOWNGRADE" -ne 1 ] && [ -n "$current" ] &&
        version_lt "${version#v}" "${current#v}"; then
        reject "$id" DOWNGRADE_REFUSED
        return 0
      fi
      argv=(bash "$RUN_SCRIPT" --version "$version" --yes --timeout "$ready_timeout")
      [ "$skip_backup" = "true" ] && argv+=(--no-backup)
      ;;
    backup)
      [ "$OPS_ALLOW_BACKUP" -eq 1 ] || { reject "$id" NOT_ALLOWED; return 0; }
      argv=(bash "$ROOT/scripts/backup.sh")
      ;;
    verify)
      [ "$OPS_ALLOW_VERIFY" -eq 1 ] || { reject "$id" NOT_ALLOWED; return 0; }
      case "$stamp" in
        [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]) ;;
        *) reject "$id" BAD_BACKUP_ID; return 0 ;;
      esac
      [ -d "$ROOT/backups/$stamp" ] || { reject "$id" BACKUP_NOT_FOUND; return 0; }
      # `verify` seulement : jamais `db`, jamais `all`. Restaurer écrase sans confirmation
      # et sans terminal ; cela reste un geste d'exploitant, devant un clavier.
      argv=(bash "$ROOT/scripts/restore.sh" verify "backups/$stamp")
      ;;
    *) reject "$id" UNKNOWN_KIND; return 0 ;;
  esac

  # `mkdir` sans -p : il ÉCHOUE si le dossier existe. C'est le refus du rejeu — un même
  # ordre déposé deux fois ne s'exécute pas deux fois.
  local dir="$RUNS_DIR/$id"
  if ! mkdir "$dir" 2>/dev/null; then reject "$id" REPLAY; return 0; fi

  RUN_ID="$id"; RUN_KIND="$kind"; RUN_TARGET="${version:-$stamp}"
  RUN_STARTED="$(date -Iseconds)"; RUN_ACTOR="$actor"; RUN_BACKUP_ID=""
  printf '%s' "$order" > "$dir/order.json"
  : > "$dir/output.log"
  : > "$dir/phases"
  write_status "$dir" running queued "" "" ""
  log "exécution $id ($kind ${RUN_TARGET:-})"

  # `timeout` : un convertisseur bloqué, un registre qui ne répond pas, et l'agent
  # resterait occupé pour toujours — l'écran afficherait « en cours » sans fin.
  #
  # `GIT_CONFIG_*` : en mode construction, update.sh fait `git checkout`. Le dépôt de
  # l'hôte n'appartient pas à l'utilisateur du conteneur, et git refuse alors d'y toucher.
  OPS_PHASE_FILE="$dir/phases" \
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0='*' \
    timeout -k 30 "$max_runtime" "${argv[@]}" >> "$dir/output.log" 2>&1 &
  local child=$!
  local cancelled=0 phase=queued

  while kill -0 "$child" 2>/dev/null; do
    phase="$(sed -n 's/^OPS_PHASE=//p' "$dir/phases" 2>/dev/null | tail -n 1)"
    [ -n "$phase" ] || phase="$kind"
    # Annulation — refusée dès que la bascule est engagée : tuer `docker compose up` à
    # mi-course laisserait la pile dans un état que personne ne sait décrire, et le retour
    # arrière automatique, lui, n'aurait pas eu lieu.
    if [ -e "$QUEUE_DIR/$id.cancel" ] && [ "$cancelled" -eq 0 ]; then
      rm -f "$QUEUE_DIR/$id.cancel"
      case "$phase" in
        switch|health|rollback)
          log "annulation ignorée ($id) : la bascule est engagée"
          printf '\n[agent] annulation demandée trop tard : la bascule est engagée.\n' >> "$dir/output.log"
          ;;
        *)
          cancelled=1
          log "annulation ($id)"
          kill -TERM "$child" 2>/dev/null || true
          ;;
      esac
    fi
    write_status "$dir" running "$phase" "" "" ""
    write_agent_state
    sleep "$POLL_SEC"
  done

  local rc=0
  wait "$child" || rc=$?
  phase="$(sed -n 's/^OPS_PHASE=//p' "$dir/phases" 2>/dev/null | tail -n 1)"
  [ -n "$phase" ] || phase="$kind"
  RUN_BACKUP_ID="$(sed -n 's/^BACKUP_ID=//p' "$dir/output.log" | tail -n 1)"

  # Le verdict se lit dans le code de sortie et le dernier jalon — jamais dans la prose du
  # journal, qui est écrite pour un humain et change de formulation à chaque version.
  local state reason=""
  if [ "$cancelled" -eq 1 ]; then
    state=cancelled
  elif [ "$rc" -eq 0 ]; then
    state=succeeded
  elif [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
    state=failed; reason=TIMEOUT
  elif [ "$phase" = "rollback" ]; then
    state=rolled-back
  else
    state=failed
  fi
  write_status "$dir" "$state" "$phase" "$reason" "$rc" "$(date -Iseconds)"
  log "fin $id : $state (code $rc, jalon $phase)"
  purge_runs
}

# ── Démarrage ────────────────────────────────────────────────────────────────
mkdir -p "$QUEUE_DIR" "$RUNS_DIR"
[ -f "$ROOT/scripts/update.sh" ] || { log "dépôt introuvable sous $ROOT"; exit 1; }

# `update.sh` est copié hors du dépôt avant chaque exécution : en mode construction, il
# fait `git checkout`, ce qui RÉÉCRIT le fichier que bash est en train de lire au fil de
# l'eau. Le script honore `REVIEW_ROOT`, il retrouve donc le dépôt depuis n'importe où.
RUN_SCRIPT="/tmp/review-update.sh"

RUN_ID=""; RUN_KIND=""; RUN_TARGET=""; RUN_STARTED=""; RUN_ACTOR="null"; RUN_BACKUP_ID=""

log "agent $AGENT_VERSION (protocole $PROTOCOL) — dépôt $ROOT"
check_root_path
write_agent_state

while true; do
  next="$(ls -1 "$QUEUE_DIR"/*.json 2>/dev/null | sort | head -n 1 || true)"
  if [ -n "$next" ]; then
    if [ -L "$next" ]; then
      log "ordre ignoré : lien symbolique ($next)"
      rm -f "$next"
    elif [ ! -f "$next" ] || [ "$(wc -c < "$next")" -gt 8192 ]; then
      log "ordre ignoré : ni fichier régulier ni taille plausible ($next)"
      rm -f "$next"
    else
      # `cat` puis `rm` — jamais `mv`, qui déplacerait la CIBLE d'un lien plutôt que le lien.
      order="$(cat "$next")"
      rm -f "$next"
      if printf '%s' "$order" | jq -e . >/dev/null 2>&1; then
        cp -f "$ROOT/scripts/update.sh" "$RUN_SCRIPT"
        # Un ordre périmé n'est pas exécuté : entre son dépôt et ce tour, l'exploitant a
        # pu redémarrer, corriger, ou renoncer. Une mise à jour qui se déclenche une heure
        # après le clic est une surprise, pas un service.
        # Comparaison en SECONDES, jamais en texte : deux horodatages ISO écrits dans des
        # fuseaux différents ne s'ordonnent pas alphabétiquement.
        expires="$(printf '%s' "$order" | jq -r '.expiresAt // empty')"
        expires_at="$(date -d "$expires" +%s 2>/dev/null || echo 0)"
        if [ "$expires_at" -gt 0 ] && [ "$(date +%s)" -gt "$expires_at" ]; then
          RUN_KIND=""
          reject "$(printf '%s' "$order" | jq -r '.id // empty')" EXPIRED
        else
          check_root_path
          run_order "$order" || log "exécution interrompue par une erreur inattendue"
        fi
      else
        log "ordre ignoré : JSON illisible"
      fi
    fi
  fi
  write_agent_state
  sleep "$POLL_SEC"
done
