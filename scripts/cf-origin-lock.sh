#!/usr/bin/env bash
# [2026-11-27] Serverul primeste trafic web (80/443) DOAR de la Cloudflare.
#
# Gasit la auditul de dupa atacul cu boti: ufw lasa 80/443 deschise oricui, iar nginx raspundea
# si pe IP-ul direct (HTTP 200) → oricine afla IP-ul ocolea Cloudflare (Bot Fight Mode, regulile
# de pe login/resetare). SSH (22) NU e atins de script.
#
# Idempotent: adauga intai regulile pentru intervalele Cloudflare (luate de pe cloudflare.com/ips),
# abia APOI scoate regulile „80/443 de la oricine" — site-ul nu ramane nicio clipa blocat. Intervalele
# care nu mai apar in lista oficiala se scot. Daca lista nu se poate descarca sau pare gresita,
# NU schimba nimic (fail-safe). Rulat saptamanal din crontab-ul root.
set -euo pipefail
LOG="${LOG:-/opt/zeus-terminal/data/logs/cf-origin-lock.log}"
ts() { date -u +'%Y-%m-%d %H:%M:%S'; }
log() { echo "$(ts) $*" >> "$LOG"; }

v4=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4 || true)
v6=$(curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6 || true)
n4=$(printf '%s\n' "$v4" | grep -cE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/[0-9]+$' || true)
n6=$(printf '%s\n' "$v6" | grep -cE '^[0-9a-f:]+/[0-9]+$' || true)
if [ "${n4:-0}" -lt 10 ] || [ "${n6:-0}" -lt 5 ]; then
    log "ABORT: lista Cloudflare nu arata bine (v4=$n4 v6=$n6) — nu schimb nimic"
    exit 1
fi
ranges=$(printf '%s\n%s\n' "$v4" "$v6" | grep -E '/[0-9]+$')

added=0
for r in $ranges; do
    if ! ufw status | grep -qE "^80,443/tcp +ALLOW +${r//./\\.}( |$)"; then
        ufw allow proto tcp from "$r" to any port 80,443 comment 'cloudflare' >/dev/null
        added=$((added+1))
    fi
done

# intervale Cloudflare vechi, care nu mai sunt in lista oficiala
removed=0
while read -r num; do
    [ -n "$num" ] && ufw --force delete "$num" >/dev/null && removed=$((removed+1))
done < <(ufw status numbered | grep "# cloudflare" | while read -r line; do
    src=$(echo "$line" | awk '{for(i=1;i<=NF;i++) if ($i=="IN") {print $(i+1); exit}}')
    if ! printf '%s\n' $ranges | grep -qxF "$src"; then echo "$line" | sed -E 's/^\[ *([0-9]+)\].*/\1/'; fi
done | sort -rn)

# regulile vechi „80/443 de la oricine" (si v6) — abia acum, dupa ce Cloudflare are acces
closed=0
for rule in '80/tcp' '443/tcp'; do
    while ufw status numbered | grep -qE "\] ${rule//\//\\/}(\s+\(v6\))? +ALLOW IN +Anywhere"; do
        n=$(ufw status numbered | grep -E "\] ${rule//\//\\/}(\s+\(v6\))? +ALLOW IN +Anywhere" | head -1 | sed -E 's/^\[ *([0-9]+)\].*/\1/')
        ufw --force delete "$n" >/dev/null; closed=$((closed+1))
    done
done
log "OK: cloudflare v4=$n4 v6=$n6 | adaugate=$added scoase_vechi=$removed inchise_pentru_toti=$closed"
