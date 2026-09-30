#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Yvig Bidon
# SPDX-License-Identifier: AGPL-3.0-or-later

#
# ReView operations agent — runs, on behalf of the admin screen, the only three operations
# it can order: back up, verify a backup, update. Nothing else. There is no free-form
# command anywhere in this file, and that is the point.
#
# ── Why a separate container, in a separate compose PROJECT ──────────────────
#
# `scripts/update.sh` runs `docker compose up -d` without a service list: everything in the
# main project is recreated. An executor living in that stack would destroy itself halfway
# through its own run, leaving the instance half-switched with nobody left to roll back.
# The agent lives in the `review-ops` project, which nothing in the main stack touches.
#
# ── Why a file spool rather than a Redis queue ───────────────────────────────
#
# Because the container that gives the order is the one being destroyed. The order, the
# log and the verdict must outlive the backend that requested them — and be read back
# afterwards by a backend of ANOTHER version. A file on the host is the only thing that
# survives that. It is also what an operator can read with `cat` when nothing else answers.
#
# ── Privilege split ──────────────────────────────────────────────────────────
#
# The backend writes to `ops/queue` and only reads `ops/state` (read-only mount); the agent
# does the opposite. The backend is reachable from the internet and runs as root: if it
# could write to `state/`, it could plant a symlink there and make the agent — hence the
# docker daemon — write anywhere on the host. The two separate mounts ARE the barrier; the
# checks below are only the second line of defence.
#
set -euo pipefail

PROTOCOL=1
AGENT_VERSION="${OPS_AGENT_VERSION:-unknown}"
POLL_SEC="${OPS_POLL_SEC:-2}"
MAX_RUNTIME_CAP="${OPS_MAX_RUNTIME:-3600}"
# ⚠ No apostrophe in this message: the word in `${var:?word}` goes through quote removal,
# an apostrophe would open a string and the whole script would stop parsing.
ROOT="${REVIEW_ROOT:?REVIEW_ROOT is required (absolute path of the repository on the host)}"
QUEUE_DIR="$ROOT/ops/queue"
STATE_DIR="$ROOT/ops/state"
RUNS_DIR="$STATE_DIR/runs"
AGENT_FILE="$STATE_DIR/agent.json"
CONF_FILE="$ROOT/deploy/agent.conf"

# Permissions, read from a file the backend does NOT mount. This is the one barrier a
# compromised backend cannot cross: an attacker holding an admin session can order what
# the operator has allowed, never more.
OPS_ALLOW_UPDATE=1
OPS_ALLOW_BACKUP=1
OPS_ALLOW_VERIFY=1
OPS_ALLOW_DOWNGRADE=0
# Sourced with `.` and nothing else: it is the operator's file, not an order.
# shellcheck source=/dev/null
if [ -f "$CONF_FILE" ]; then . "$CONF_FILE"; fi

log() { printf '%s agent: %s\n' "$(date -Iseconds)" "$1" >&2; }

# ── Witness file: does the agent see the repository at the SAME path as the host? ──
#
# `scripts/backup.sh` computes its `pwd` and passes it verbatim to `docker run -v "$HOST_DIR:…"`,
# which the DAEMON resolves on the host side. If the repository were mounted anywhere other
# than its host path, the MinIO mirror would land in an empty directory — without a single
# error, discovered on restore day. This check turns that silent failure into a clear refusal.
ROOT_OK=0
check_root_path() {
  local witness image
  witness=".witness-$$-$(date +%s)"
  : > "$STATE_DIR/$witness"
  image="${REVIEW_OPS_IMAGE:-alpine}"
  # ⚠ `--entrypoint test` is not a precaution, it is what makes the check work. The image
  # used here is the agent's own (compose always sets REVIEW_OPS_IMAGE; the `alpine`
  # fallback is never used), and its entrypoint IS the agent: without this option,
  # "test -f …" become mere ARGUMENTS, the container restarts the agent, which dies at once
  # for lack of REVIEW_ROOT — the check would always fail and no order would ever run.
  # `timeout` on top: should the entrypoint ever take over again, it would loop forever.
  if timeout 60 docker run --rm --entrypoint test -v "$ROOT/ops/state:/w" "$image" -f "/w/$witness" >/dev/null 2>&1; then
    ROOT_OK=1
  else
    ROOT_OK=0
    log "the repository is not mounted at its host path ($ROOT) — no order will be accepted"
  fi
  rm -f "$STATE_DIR/$witness"
}

# ── Heartbeat ────────────────────────────────────────────────────────────────
#
# Written on every loop, idle or busy: this is what lets the screen tell "no operation"
# from "agent dead". Atomic write (tmp + rename): the backend reads this file constantly
# and must never see half a JSON document.
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

# Writes a run's status, atomically. Every field every time: the backend reads this file
# on its own, with no memory of its previous value.
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

# A rejected order leaves a trace: without it, the screen would show "pending" forever
# and nobody would know why.
reject() {
  local id="$1" reason="$2"
  log "order rejected ($id): $reason"
  # An id that does not look like an id leaves no trace: it would be used as a directory
  # name, which is exactly what we refuse to do with a dubious value.
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

# True if $1 is strictly lower than $2. `sort -V` (coreutils): versions do not compare as
# text, "2.10.0" comes after "2.9.0".
version_lt() {
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" = "$1" ]
}

# ── Purge ────────────────────────────────────────────────────────────────────
# Twenty runs are enough for the screen; a directory that grows forever on a studio's data
# pool is an outage that shows up months later, without warning.
purge_runs() {
  local keep=20
  ls -1d "$RUNS_DIR"/*/ 2>/dev/null | sort -r | tail -n "+$((keep + 1))" | while read -r dir; do
    rm -rf "$dir"
  done || true
}

# ── One run ──────────────────────────────────────────────────────────────────
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

  # The id becomes a DIRECTORY NAME, so it is the first thing to filter.
  case "$id" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *) log "order ignored: invalid id"; return 0 ;;
  esac
  RUN_KIND="$kind"

  # Every numeric field is filtered again HERE, whatever the backend says. `readyTimeoutSec`
  # ends up in an arithmetic expression in update.sh, where bash re-evaluates variable
  # contents: "x[$(command)]" would execute there.
  case "$ready_timeout" in ''|*[!0-9]*) reject "$id" BAD_TIMEOUT; return 0 ;; esac
  case "$max_runtime" in ''|*[!0-9]*) reject "$id" BAD_RUNTIME; return 0 ;; esac
  [ "$max_runtime" -le "$MAX_RUNTIME_CAP" ] || max_runtime="$MAX_RUNTIME_CAP"

  if [ "$ROOT_OK" -ne 1 ]; then reject "$id" ROOT_MISMATCH; return 0; fi

  # Closed vocabulary. No `eval`, no `source`, no path taken from the order: arguments are
  # built into an array, one by one, from values already filtered.
  local -a argv
  case "$kind" in
    update)
      [ "$OPS_ALLOW_UPDATE" -eq 1 ] || { reject "$id" NOT_ALLOWED; return 0; }
      case "$version" in
        v[0-9]*.[0-9]*.[0-9]*) ;;
        *) reject "$id" BAD_VERSION; return 0 ;;
      esac
      case "$version" in *[!0-9A-Za-z.v-]*) reject "$id" BAD_VERSION; return 0 ;; esac
      # Monotonicity: THIS check, not the backend's allow-list, is what stops a compromised
      # backend from downgrading the instance to a vulnerable version.
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
      # `verify` only: never `db`, never `all`. Restoring overwrites without confirmation and
      # without a terminal; it stays an operator's action, at a keyboard.
      argv=(bash "$ROOT/scripts/restore.sh" verify "backups/$stamp")
      ;;
    *) reject "$id" UNKNOWN_KIND; return 0 ;;
  esac

  # `mkdir` without -p: it FAILS if the directory exists. That is the replay guard — the
  # same order dropped twice does not run twice.
  local dir="$RUNS_DIR/$id"
  if ! mkdir "$dir" 2>/dev/null; then reject "$id" REPLAY; return 0; fi

  RUN_ID="$id"; RUN_KIND="$kind"; RUN_TARGET="${version:-$stamp}"
  RUN_STARTED="$(date -Iseconds)"; RUN_ACTOR="$actor"; RUN_BACKUP_ID=""
  printf '%s' "$order" > "$dir/order.json"
  : > "$dir/output.log"
  : > "$dir/phases"
  write_status "$dir" running queued "" "" ""
  log "running $id ($kind ${RUN_TARGET:-})"

  # `timeout`: a stuck converter or an unresponsive registry would otherwise keep the agent
  # busy forever — the screen would show "running" endlessly.
  #
  # `GIT_CONFIG_*`: in build mode, update.sh runs `git checkout`. The host repository is not
  # owned by the container user, and git then refuses to touch it.
  OPS_PHASE_FILE="$dir/phases" \
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0='*' \
    timeout -k 30 "$max_runtime" "${argv[@]}" >> "$dir/output.log" 2>&1 &
  local child=$!
  local cancelled=0 phase=queued

  while kill -0 "$child" 2>/dev/null; do
    phase="$(sed -n 's/^OPS_PHASE=//p' "$dir/phases" 2>/dev/null | tail -n 1)"
    [ -n "$phase" ] || phase="$kind"
    # Cancellation — refused once the switch has started: killing `docker compose up`
    # midway would leave the stack in a state nobody can describe, and the automatic
    # rollback would not have happened.
    if [ -e "$QUEUE_DIR/$id.cancel" ] && [ "$cancelled" -eq 0 ]; then
      rm -f "$QUEUE_DIR/$id.cancel"
      case "$phase" in
        switch|health|rollback)
          log "cancellation ignored ($id): the switch has already started"
          printf '\n[agent] cancellation requested too late: the switch has already started.\n' >> "$dir/output.log"
          ;;
        *)
          cancelled=1
          log "cancelling ($id)"
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

  # The verdict comes from the exit code and the last milestone — never from the log's
  # prose, which is written for humans and changes wording from one version to the next.
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
  log "finished $id: $state (exit code $rc, milestone $phase)"
  purge_runs
}

# ── Startup ──────────────────────────────────────────────────────────────────
mkdir -p "$QUEUE_DIR" "$RUNS_DIR"
[ -f "$ROOT/scripts/update.sh" ] || { log "repository not found under $ROOT"; exit 1; }

# `update.sh` is copied out of the repository before each run: in build mode it runs
# `git checkout`, which REWRITES the file bash is reading as it goes. The script honours
# `REVIEW_ROOT`, so it finds the repository from anywhere.
RUN_SCRIPT="/tmp/review-update.sh"

RUN_ID=""; RUN_KIND=""; RUN_TARGET=""; RUN_STARTED=""; RUN_ACTOR="null"; RUN_BACKUP_ID=""

log "agent $AGENT_VERSION (protocol $PROTOCOL) — repository $ROOT"
check_root_path
write_agent_state

while true; do
  next="$(ls -1 "$QUEUE_DIR"/*.json 2>/dev/null | sort | head -n 1 || true)"
  if [ -n "$next" ]; then
    if [ -L "$next" ]; then
      log "order ignored: symbolic link ($next)"
      rm -f "$next"
    elif [ ! -f "$next" ] || [ "$(wc -c < "$next")" -gt 8192 ]; then
      log "order ignored: not a regular file or implausible size ($next)"
      rm -f "$next"
    else
      # `cat` then `rm` — never `mv`, which would move a link's TARGET rather than the link.
      order="$(cat "$next")"
      rm -f "$next"
      if printf '%s' "$order" | jq -e . >/dev/null 2>&1; then
        cp -f "$ROOT/scripts/update.sh" "$RUN_SCRIPT"
        # An expired order is not run: between the click and this loop, the operator may
        # have restarted, fixed things, or changed their mind. An update that fires an hour
        # after the click is a surprise, not a service.
        # Compared in SECONDS, never as text: two ISO timestamps written in different time
        # zones do not sort alphabetically.
        expires="$(printf '%s' "$order" | jq -r '.expiresAt // empty')"
        expires_at="$(date -d "$expires" +%s 2>/dev/null || echo 0)"
        if [ "$expires_at" -gt 0 ] && [ "$(date +%s)" -gt "$expires_at" ]; then
          RUN_KIND=""
          reject "$(printf '%s' "$order" | jq -r '.id // empty')" EXPIRED
        else
          check_root_path
          run_order "$order" || log "run interrupted by an unexpected error"
        fi
      else
        log "order ignored: unreadable JSON"
      fi
    fi
  fi
  write_agent_state
  sleep "$POLL_SEC"
done
