#!/usr/bin/env bash
# [2026-11-27] Authenticated Origin Pulls (securitate extra 7): nginx accepta HTTPS doar de la Cloudflare,
# dovedit cu certificat (mai solid decat lista de IP-uri din cf-origin-lock.sh — o completeaza).
#
# ORDINEA (altfel site-ul cade): 1) operatorul porneste in Cloudflare → SSL/TLS → Origin Server →
# „Authenticated Origin Pulls" (global); 2) abia apoi:  sudo /opt/zeus-terminal/scripts/origin-pulls.sh enable
# `enable` verifica singur site-ul PRIN Cloudflare dupa schimbare; daca nu raspunde 200, revine automat.
#   status | enable | disable
set -euo pipefail
SITE=$(readlink -f /etc/nginx/sites-enabled/zeus-terminal)
CA_SRC=/opt/zeus-terminal/scripts/nginx/cloudflare-origin-pull-ca.pem
CA=/etc/ssl/zeus/cloudflare-origin-pull-ca.pem
MARK='zt-origin-pulls'   # cuvant simplu, cautat LITERAL (grep -F): fara caractere speciale de regex
LOG=/var/log/nginx/access.log
# Prin Cloudflare, o cerere de pe server ia 403 de la Bot Fight Mode INAINTE de server — nu dovedeste nimic.
# Dovada = TRAFICUL REAL de dupa schimbare: in 120 s trebuie sa apara cereri 2xx/3xx; 400 (certificat lipsa)
# sau nicio cerere → revenire. Prudent: cand nu se poate confirma, nu ramane pornit.
check_traffic() {
    local start=$1 end=$(( $(date +%s) + 120 )) ok=0 bad=0
    while [ "$(date +%s)" -lt "$end" ]; do
        local new; new=$(tail -n +"$((start+1))" "$LOG" 2>/dev/null | awk '{print $9}')
        ok=$(printf '%s\n' "$new" | grep -cE '^[23][0-9][0-9]$' || true)
        bad=$(printf '%s\n' "$new" | grep -cE '^(400|495|496)$' || true)
        [ "$ok" -ge 3 ] && { echo "ok=$ok bad=$bad"; return 0; }
        [ "$bad" -ge 3 ] && { echo "ok=$ok bad=$bad"; return 1; }
        sleep 5
    done
    echo "ok=$ok bad=$bad (not enough real traffic to confirm)"; return 1
}

case "${1:-status}" in
  status)
    if grep -qF "$MARK" "$SITE"; then echo "Authenticated Origin Pulls: ON"; else echo "Authenticated Origin Pulls: OFF"; fi ;;
  enable)
    grep -qF "$MARK" "$SITE" && { echo "already ON"; exit 0; }
    install -m 0644 "$CA_SRC" "$CA"
    cp "$SITE" "$SITE.bak-origin-pulls"
    # dupa fiecare ssl_certificate_key din blocurile site-ului
    sed -i "/ssl_certificate_key /a\\    ssl_client_certificate $CA; ssl_verify_client on; # $MARK" "$SITE"
    if ! nginx -t 2>/dev/null; then cp "$SITE.bak-origin-pulls" "$SITE"; echo "nginx -t FAILED — reverted"; exit 1; fi
    start=$(wc -l < "$LOG")
    systemctl reload nginx
    if ! res=$(check_traffic "$start"); then
        cp "$SITE.bak-origin-pulls" "$SITE"; nginx -t >/dev/null 2>&1 && systemctl reload nginx
        echo "real traffic after the change: $res — REVERTED (is the Cloudflare switch ON?)"; exit 1
    fi
    echo "ON — real traffic after the change: $res" ;;
  disable)
    grep -qF "$MARK" "$SITE" || { echo "already OFF"; exit 0; }
    cp "$SITE" "$SITE.bak-origin-pulls-off"
    sed -i "/$MARK/d" "$SITE"
    nginx -t && systemctl reload nginx && echo "OFF" ;;
  *) echo "usage: $0 status|enable|disable"; exit 2 ;;
esac
