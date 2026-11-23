#!/usr/bin/env bash
set -e

echo "============================================================"
echo "  Infourqui Mercado — Configurando GitHub Codespace"
echo "============================================================"

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp .env.example .env
  echo "[Codespace] Archivo .env inicializado desde .env.example."
fi

echo "[Codespace] Instalando dependencias de Node.js..."
npm install --no-audit --no-fund || npm install --legacy-peer-deps --no-audit --no-fund

echo ""
echo "============================================================"
echo "  Entorno listo. Iniciá el servidor con: npm run dev"
echo "  (o abrí la tarea automática en el puerto 3000)"
echo "============================================================"
