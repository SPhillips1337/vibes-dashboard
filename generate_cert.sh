#!/usr/bin/env bash
# Generate a self-signed SSL certificate for local HTTPS development.
# This enables getUserMedia and SpeechRecognition on LAN devices.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="$SCRIPT_DIR/certs"

mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/cert.pem" ] && [ -f "$CERT_DIR/key.pem" ]; then
    echo "[INFO] Certificates already exist in $CERT_DIR"
    echo "[INFO] Delete them and re-run this script to regenerate."
    exit 0
fi

echo "[INFO] Generating self-signed SSL certificate..."

# Get the machine's local IP for the SAN field
LOCAL_IP=$(hostname -I | awk '{print $1}')
echo "[INFO] Detected local IP: $LOCAL_IP"

openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$CERT_DIR/key.pem" \
    -out "$CERT_DIR/cert.pem" \
    -days 365 \
    -subj "/CN=Motion Aware Voice Chat Bot" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:$LOCAL_IP"

echo ""
echo "[OK] Certificate generated:"
echo "     $CERT_DIR/cert.pem"
echo "     $CERT_DIR/key.pem"
echo ""
echo "[NOTE] Your browser will show a security warning because it's self-signed."
echo "       Click 'Advanced' -> 'Proceed' to accept it."
