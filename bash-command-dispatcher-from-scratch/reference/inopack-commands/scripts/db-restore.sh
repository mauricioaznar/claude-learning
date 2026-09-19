#!/usr/bin/env bash
# db-restore.sh — drop, recreate and repopulate the LOCAL inopack database from the
# `inopack.sql` dump.
#
# This is the one destructive command in the set: it runs DROP DATABASE. It is
# deliberately not part of any other command's flow — nothing calls it, and it
# prompts before doing anything unless -y is passed.
#
# What it discovers instead of hardcoding:
#   - the MySQL client: `mysql` on PATH, else every `C:\Program Files\MySQL\MySQL
#     Server <ver>\bin\mysql.exe` install found. Machines run different versions
#     (8.1 here, 8.3/8.4/9.x elsewhere), so candidates are probed newest-first and
#     the first that actually CONNECTS wins — then, if a client matching the running
#     server's major.minor is installed, that one is preferred to avoid version-skew
#     warnings. Override with INOPACK_MYSQL=/path/to/mysql.
#   - connection details: parsed from MYSQL_URL in nestjs-inopack-graphql/.env, so
#     the credentials live in one place and are never duplicated here.
#
# Safety: refuses any host that is not localhost/127.0.0.1/::1. "Restore the local
# database" must never be able to drop a server one, so there is no override flag.
#
# The dump carries no CREATE DATABASE / USE statement (it is a single-database
# mysqldump), so the database is created here with utf8mb4 / utf8mb4_unicode_ci and
# the dump is piped into it.
#
# Usage:
#   scripts/db-restore.sh                 # prompts, then restores from ./inopack.sql
#   scripts/db-restore.sh -y              # no prompt (automated / non-interactive)
#   scripts/db-restore.sh --dump path.sql # restore from another dump
#   scripts/db-restore.sh --db other_db   # target another database name
#   scripts/db-restore.sh --dry-run       # report what it would do, change nothing
#
# The dump is a snapshot in time: tables added by later migrations are absent from
# it, so the migration runner is the second half of a restore (reported at the end).

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/nestjs-inopack-graphql/.env"
DUMP="$ROOT/inopack.sql"
DB_OVERRIDE=""
assume_yes=0
dry_run=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    -y|--yes)   assume_yes=1; shift ;;
    --dry-run)  dry_run=1; shift ;;
    --dump)     DUMP="${2:-}"; shift 2 ;;
    --db)       DB_OVERRIDE="${2:-}"; shift 2 ;;
    --env)      ENV_FILE="${2:-}"; shift 2 ;;
    -h|--help)  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1"; echo "usage: scripts/db-restore.sh [-y] [--dry-run] [--dump <file>] [--db <name>] [--env <file>]"; exit 2 ;;
  esac
done

fail() { echo "$*" >&2; exit 1; }

# ---------------------------------------------------------------- connection ----
# MYSQL_URL=mysql://user:pass@host:port/dbname?params — the single source of truth
# for credentials on this machine.
[ -f "$ENV_FILE" ] || fail "no env file at $ENV_FILE — cannot read MYSQL_URL."
raw_url="$(grep -m1 '^MYSQL_URL=' "$ENV_FILE" | cut -d= -f2-)"
[ -n "$raw_url" ] || fail "MYSQL_URL not found in $ENV_FILE."

# Percent-decoding matters: a password with @ or : in it is URL-encoded in MYSQL_URL
# and would otherwise be split on the wrong character.
urldecode() { local s="${1//+/ }"; printf '%b' "${s//%/\\x}"; }

url="${raw_url#mysql://}"
creds="${url%%@*}"
rest="${url#*@}"
hostport="${rest%%/*}"
dbpart="${rest#*/}"
db_user="$(urldecode "${creds%%:*}")"
db_pass="$(urldecode "${creds#*:}")"
db_host="${hostport%%:*}"
db_port="${hostport##*:}"
[ "$db_port" = "$db_host" ] && db_port=3306
db_name="${DB_OVERRIDE:-${dbpart%%\?*}}"

case "$db_host" in
  localhost|127.0.0.1|::1|"") ;;
  *) fail "refusing to run: MYSQL_URL points at '$db_host', not a local server.
This command drops a database; it only ever targets localhost." ;;
esac
[ -n "$db_name" ] || fail "could not determine a database name from MYSQL_URL."

# ------------------------------------------------------------------- client ----
# Version of a mysql binary. Modern clients print "Ver 8.1.0 for Win64"; older ones
# print "Ver 14.14 Distrib 5.7.44", where the Distrib number is the real one.
client_version() {
  local out; out="$("$1" --version 2>/dev/null)" || return 1
  local v; v="$(printf '%s' "$out" | sed -nE 's/.*Distrib ([0-9]+(\.[0-9]+)*).*/\1/p')"
  [ -z "$v" ] && v="$(printf '%s' "$out" | sed -nE 's/.*Ver ([0-9]+(\.[0-9]+)*).*/\1/p')"
  [ -n "$v" ] && printf '%s' "$v"
}

candidates=()
add_candidate() { [ -n "${1:-}" ] && [ -x "$1" ] && candidates+=("$1"); }

if [ -n "${INOPACK_MYSQL:-}" ]; then
  [ -x "$INOPACK_MYSQL" ] || fail "INOPACK_MYSQL is set to '$INOPACK_MYSQL', which is not executable."
  candidates+=("$INOPACK_MYSQL")
else
  command -v mysql >/dev/null 2>&1 && candidates+=("$(command -v mysql)")
  # Windows installs, one directory per version, side by side.
  for base in "/c/Program Files/MySQL" "/c/Program Files (x86)/MySQL" "${PROGRAMFILES:-}/MySQL"; do
    [ -d "$base" ] || continue
    for bin in "$base"/MySQL\ Server\ */bin/mysql.exe; do add_candidate "$bin"; done
  done
fi
[ "${#candidates[@]}" -gt 0 ] || fail "no mysql client found. Install MySQL, put mysql on PATH, or set INOPACK_MYSQL=/path/to/mysql."

# Newest first — a newer client talks to an older server, not the reverse.
ordered=()
while IFS=$'\t' read -r _ path; do ordered+=("$path"); done < <(
  for c in "${candidates[@]}"; do printf '%s\t%s\n' "$(client_version "$c")" "$c"; done | sort -Vr -u
)

# MYSQL_PWD keeps the password out of the process list and silences the
# "password on the command line is insecure" warning.
run_sql() { MYSQL_PWD="$db_pass" "$client" --protocol=TCP -h "$db_host" -P "$db_port" -u "$db_user" -N -B -e "$1" 2>&1; }
probe() { MYSQL_PWD="$db_pass" "$1" --protocol=TCP -h "$db_host" -P "$db_port" -u "$db_user" -N -B -e "SELECT VERSION();" 2>/dev/null; }

client=""; server_version=""
for c in "${ordered[@]}"; do
  v="$(probe "$c")" || true
  if [ -n "$v" ]; then client="$c"; server_version="$v"; break; fi
done
[ -n "$client" ] || fail "found $(printf '%s' "${#ordered[@]}") mysql client(s), but none could connect to $db_host:$db_port as '$db_user'.
Is the MySQL service running, and are the MYSQL_URL credentials right?"

# Prefer a client whose major.minor matches the running server, when one is installed.
# The match is usually OLDER than the client picked above (newest-that-connects), so
# this scans the whole list rather than stopping at the current pick.
server_mm="$(printf '%s' "$server_version" | cut -d. -f1,2)"
if [ "$(client_version "$client" | cut -d. -f1,2)" != "$server_mm" ]; then
  for c in "${ordered[@]}"; do
    [ "$c" = "$client" ] && continue
    [ "$(client_version "$c" | cut -d. -f1,2)" = "$server_mm" ] || continue
    if [ -n "$(probe "$c")" ]; then client="$c"; break; fi
  done
fi

# --------------------------------------------------------------------- dump ----
[ -f "$DUMP" ] || fail "dump not found: $DUMP
It is gitignored, so it has to be copied onto this machine (or pass --dump <file>)."
dump_size="$(du -h "$DUMP" | cut -f1)"

existing_tables="$(run_sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$db_name';" | tr -d '\r')"
[ -n "$existing_tables" ] || existing_tables=0

echo "== INOPACK db-restore =="
printf '  %-18s %s\n' "client"   "$client ($(client_version "$client"))"
printf '  %-18s %s\n' "server"   "$server_version at $db_host:$db_port as '$db_user'"
printf '  %-18s %s\n' "database" "$db_name ($existing_tables table(s) today)"
printf '  %-18s %s\n' "dump"     "$DUMP ($dump_size)"

if [ "$dry_run" = 1 ]; then
  echo
  echo "--dry-run: nothing was changed. It would DROP and recreate '$db_name', then load the dump."
  exit 0
fi

if [ "$assume_yes" != 1 ]; then
  echo
  echo "⚠  This DROPS the '$db_name' database on $db_host and replaces it with the dump."
  [ "$existing_tables" -gt 0 ] && echo "   Everything currently in those $existing_tables table(s) is lost."
  if [ -r /dev/tty ]; then
    printf "   Type the database name to continue: "
    read -r reply < /dev/tty
    [ "$reply" = "$db_name" ] || { echo "Aborted."; exit 1; }
  else
    echo "   No terminal to confirm on. Re-run with -y to proceed: scripts/db-restore.sh -y"
    exit 1
  fi
fi

echo
echo "### drop + create $db_name ###"
out="$(run_sql "DROP DATABASE IF EXISTS \`$db_name\`; CREATE DATABASE \`$db_name\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;")"
[ -n "$out" ] && echo "$out"
printf '%s' "$out" | grep -qi 'error' && fail "drop/create failed — nothing was loaded."

echo "### load $(basename "$DUMP") (this takes a while) ###"
start=$SECONDS
if ! MYSQL_PWD="$db_pass" "$client" --protocol=TCP -h "$db_host" -P "$db_port" -u "$db_user" "$db_name" < "$DUMP"; then
  fail "the dump failed to load. '$db_name' exists but is incomplete — fix the cause and re-run."
fi
elapsed=$(( SECONDS - start ))

tables="$(run_sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$db_name';" | tr -d '\r')"
migrations="$(run_sql "SELECT COUNT(*) FROM \`$db_name\`.migrations;" 2>/dev/null | tr -d '\r')"
echo
echo "Restored '$db_name' in ${elapsed}s — $tables table(s)."
case "$migrations" in ''|*[!0-9]*) ;; *) echo "  migrations table: $migrations applied row(s) recorded in the dump." ;; esac
echo
echo "The dump predates this branch's migrations. To finish, in nestjs-inopack-graphql:"
echo "  npm run build && npm run migration:run"
