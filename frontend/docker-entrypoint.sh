#!/bin/sh
# Picks the HTTP-only or TLS-terminating nginx conf based on HTTPS_ENABLED,
# generating a self-signed cert on first run if one isn't already mounted
# at /etc/nginx/certs. See docker-compose.https.yaml for the overlay that
# sets HTTPS_ENABLED and mounts the certs volume.
set -eu

if [ "${HTTPS_ENABLED:-false}" = "true" ]; then
  CERT=/etc/nginx/certs/cert.pem
  KEY=/etc/nginx/certs/key.pem
  if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
    echo "No TLS cert found at $CERT — generating a self-signed one"
    mkdir -p /etc/nginx/certs
    openssl req -x509 -newkey rsa:2048 -nodes \
      -keyout "$KEY" -out "$CERT" \
      -days 365 -subj "/CN=localhost" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
  fi
  cp /etc/nginx/templates/nginx.https.conf /etc/nginx/conf.d/default.conf
else
  cp /etc/nginx/templates/nginx.http.conf /etc/nginx/conf.d/default.conf
fi

exec nginx -g "daemon off;"
