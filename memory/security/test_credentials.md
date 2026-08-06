# Credenziali di test

Le credenziali non devono essere salvate nel repository, neppure per ambienti di test condivisi.

- Conservare le password operative nel password manager concordato.
- Passare le credenziali ai test live tramite variabili d'ambiente locali non versionate.
- Per un database locale isolato creare account dedicati con `backend/scripts/manage_account.py`.
- Non riutilizzare mai in produzione password create per test automatici.

Endpoint di login: `POST /api/auth/login` con body `{"username": "...", "password": "..."}`.
