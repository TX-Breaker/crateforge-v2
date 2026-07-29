#!/usr/bin/env bash
# Build del sidecar per macOS/Linux con PyInstaller.
# --onedir e NON --onefile: i binari onefile hanno molti più falsi positivi
# antivirus su Windows e avvii più lenti (unpack in temp a ogni run).
set -euo pipefail
cd "$(dirname "$0")"

PY=${PYTHON:-python3}

if [ ! -d .venv ]; then
  "$PY" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

pip install --upgrade pip
# --prefer-binary: wheel prebuilt dove esistono (sqlcipher3, numpy…);
# le sdist pure-Python (es. blowfish, dipendenza di pyrekordbox) sono ok
# perché non richiedono compilatori.
pip install --prefer-binary -r requirements.txt

# Build dallo .spec (raccoglie pyrekordbox + numpy + sqlcipher3 + sqlalchemy:
# senza numpy esplicito il binario frozen fallirebbe con
# "No module named 'numpy._core._exceptions'" e ingest-masterdb/read-history
# morirebbero all'import — bug trovato sul pacchetto Windows, stesso rischio qui).
pyinstaller --noconfirm --clean crateforge-sidecar.spec

# fpcalc (Chromaprint) incluso nel pacchetto: l'utente non deve installarlo.
FPCALC_VERSION=1.5.1
DIST_DIR="$(pwd)/dist/crateforge-sidecar"
if [ ! -f "$DIST_DIR/fpcalc" ]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) FP_PKG="chromaprint-fpcalc-${FPCALC_VERSION}-macos-arm64.tar.gz" ;;
    Darwin-*)     FP_PKG="chromaprint-fpcalc-${FPCALC_VERSION}-macos-x86_64.tar.gz" ;;
    Linux-*)      FP_PKG="chromaprint-fpcalc-${FPCALC_VERSION}-linux-x86_64.tar.gz" ;;
    *)            FP_PKG="" ;;
  esac
  if [ -n "$FP_PKG" ]; then
    URL="https://github.com/acoustid/chromaprint/releases/download/v${FPCALC_VERSION}/${FP_PKG}"
    TMP=$(mktemp -d)
    if curl -fsSL "$URL" -o "$TMP/fp.tar.gz"; then
      tar -xzf "$TMP/fp.tar.gz" -C "$TMP"
      FP_BIN=$(find "$TMP" -name fpcalc -type f | head -n 1)
      cp "$FP_BIN" "$DIST_DIR/fpcalc" && chmod +x "$DIST_DIR/fpcalc"
      echo "fpcalc incluso: $DIST_DIR/fpcalc"
    else
      echo "AVVISO: download fpcalc fallito; il fingerprint userà fpcalc dal PATH se presente." >&2
    fi
    rm -rf "$TMP"
  fi
fi

echo
echo "Sidecar pronto in: $DIST_DIR"
echo "electron-builder lo impacchetta da python-sidecar/dist/crateforge-sidecar (vedi electron-builder.yml)."
