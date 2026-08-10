#!/bin/bash
# Starts the Cook-It web app over HTTPS on port 3000 (self-signed cert).
# HTTPS is required for the microphone to work from a phone too (browsers
# block getUserMedia over plain HTTP except on localhost).
#   - From this PC:    https://localhost:3000
#   - From your phone: https://<this-PC's-LAN-IP>:3000  (same WiFi)
# The browser will warn "not secure" the first time, since it's self-signed
# -- that's expected, click through "advanced > proceed".
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "No .venv found -- run ./setup.sh first." >&2
  exit 1
fi
source .venv/bin/activate

[ -f ../.env ] && set -a && source ../.env && set +a

if [ ! -f certs/cert.pem ] || [ ! -f certs/key.pem ]; then
  echo "Generating a self-signed TLS cert (certs/)..."
  mkdir -p certs
  LAN_IP=$(hostname -I | awk '{print $1}')
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout certs/key.pem -out certs/cert.pem -days 365 \
    -subj "/CN=cookit.local" \
    -addext "subjectAltName=DNS:localhost,IP:${LAN_IP},IP:127.0.0.1"
fi

uvicorn api:app --host 0.0.0.0 --port 3000 \
  --ssl-keyfile certs/key.pem --ssl-certfile certs/cert.pem
