#!/usr/bin/env bash
set -euo pipefail

# Render provides $PORT; default to 8080 for local runs
: "${PORT:=8080}"

# Render nginx.conf from template
envsubst '$PORT' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# Start supervisord (manages node, ctfd, nginx, seeder)
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
