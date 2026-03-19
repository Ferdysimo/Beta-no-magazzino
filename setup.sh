#!/bin/bash
# ============================================
# Pastasciutta Roma — Setup Automatico
# Esegui: chmod +x setup.sh && sudo ./setup.sh
# ============================================

set -e

APP_DIR="/opt/pastasciutta"
REPO_URL="INSERISCI_QUI_URL_GITHUB"  # <-- Cambia con il tuo repo
DB_NAME="pastasciutta"
JWT_SECRET=$(openssl rand -hex 32)
SERVER_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "=========================================="
echo "  Pastasciutta Roma — Installazione"
echo "=========================================="
echo ""

# 1. Aggiornamenti sistema
echo "[1/8] Aggiornamento sistema..."
apt update && apt upgrade -y

# 2. Installa dipendenze base
echo "[2/8] Installazione dipendenze..."
apt install -y curl git build-essential python3 python3-pip python3-venv nginx certbot

# 3. Installa Node.js 18
echo "[3/8] Installazione Node.js 18..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt install -y nodejs
fi
npm install -g yarn

# 4. Installa MongoDB 8
echo "[4/8] Installazione MongoDB..."
if ! command -v mongod &> /dev/null; then
    curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
    echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/8.0 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-8.0.list
    apt update
    apt install -y mongodb-org
fi
systemctl enable mongod
systemctl start mongod

# 5. Clona il repo
echo "[5/8] Download codice..."
if [ -d "$APP_DIR" ]; then
    echo "  Cartella $APP_DIR già esistente, aggiorno..."
    cd "$APP_DIR" && git pull
else
    git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# 6. Setup Backend
echo "[6/8] Configurazione backend..."
cd "$APP_DIR/backend"
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

cat > .env << EOF
MONGO_URL=mongodb://localhost:27017
DB_NAME=$DB_NAME
JWT_SECRET=$JWT_SECRET
EOF

deactivate

# 7. Setup Frontend
echo "[7/8] Configurazione frontend..."
cd "$APP_DIR/frontend"
yarn install

cat > .env << EOF
REACT_APP_BACKEND_URL=http://$SERVER_IP:8001
EOF

echo "  Build produzione..."
yarn build

# 8. Crea servizi systemd
echo "[8/8] Configurazione avvio automatico..."

# Backend service
cat > /etc/systemd/system/pastasciutta-backend.service << EOF
[Unit]
Description=Pastasciutta Backend
After=network.target mongod.service

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR/backend
Environment=PATH=$APP_DIR/backend/venv/bin:/usr/bin
ExecStart=$APP_DIR/backend/venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# Nginx config (serve frontend + proxy backend)
cat > /etc/nginx/sites-available/pastasciutta << EOF
server {
    listen 80;
    server_name _;

    # Frontend (build statico)
    root $APP_DIR/frontend/build;
    index index.html;

    # Backend API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:8001/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 86400;
        client_max_body_size 20M;
    }

    # React SPA fallback
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

ln -sf /etc/nginx/sites-available/pastasciutta /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Abilita e avvia
systemctl daemon-reload
systemctl enable pastasciutta-backend
systemctl start pastasciutta-backend
systemctl restart nginx

# Seed database
echo ""
echo "Creazione account..."
sleep 2
curl -s -X POST http://localhost:8001/api/seed | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps(d,indent=2))" 2>/dev/null || echo "Seed fallito, riprova: curl -X POST http://localhost:8001/api/seed"

# Crea cartella uploads
mkdir -p "$APP_DIR/uploads"

echo ""
echo "=========================================="
echo "  INSTALLAZIONE COMPLETATA!"
echo "=========================================="
echo ""
echo "  Apri dal browser: http://$SERVER_IP"
echo ""
echo "  Account:"
echo "    Flaminio    / Pastasciutt4!"
echo "    Grazie      / Pastasciutt4!"
echo "    Brazza      / Pastasciutt4!"
echo "    Magazziniere/ Pastasciutt4!"
echo ""
echo "  Comandi utili:"
echo "    Stato:    systemctl status pastasciutta-backend"
echo "    Log:      journalctl -u pastasciutta-backend -f"
echo "    Riavvia:  systemctl restart pastasciutta-backend"
echo "    MongoDB:  systemctl status mongod"
echo ""
echo "  IMPORTANTE: Modifica REPO_URL nello script"
echo "  con il link del tuo repository GitHub!"
echo "=========================================="
