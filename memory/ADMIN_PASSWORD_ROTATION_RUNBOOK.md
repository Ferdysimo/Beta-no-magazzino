# Rotazione password e revoca mirata Admin

Questo runbook prepara il cambio password dell'account `Admin` senza
disconnettere Simone, Federico, Magazziniere o i locali.

## Stato

- La modifica codice puo essere preparata e testata in anticipo.
- Nessuna operazione su password, `.env` o servizi VPS va eseguita finche
  l'utente non autorizza esplicitamente la finestra di aggiornamento.
- La nuova password non deve comparire in Git, nei comandi salvati, nei log o
  in questo documento.

## Meccanismo

Il JWT contiene `username` e `token_version`. Il backend accetta i token Admin
solo quando la loro versione e almeno `ADMIN_MIN_TOKEN_VERSION`.

Il comando offline di cambio password:

1. salva il nuovo hash bcrypt;
2. incrementa `token_version` nel documento account;
3. stampa la nuova versione, senza stampare la password.

Impostando la stessa versione in `ADMIN_MIN_TOKEN_VERSION`, tutti i JWT Admin
precedenti vengono rifiutati con `401`; gli altri account non vengono toccati.

## Procedura VPS futura

Eseguire soltanto durante una finestra autorizzata e dalla directory
`/opt/pastasciutta/backend`.

1. Verificare che il codice pubblicato includa il supporto a
   `ADMIN_MIN_TOKEN_VERSION` e che il worktree VPS sia pulito.
2. Eseguire il backup Mongo previsto dal runbook di sicurezza.
3. Avviare il comando offline:

   ```bash
   sudo venv/bin/python scripts/manage_account.py set-password --username Admin
   ```

   Inserire la password soltanto nei due prompt nascosti. Annotare il valore
   `token_version=N` stampato al termine.
4. Inserire o aggiornare nel file protetto `backend/.env`:

   ```dotenv
   ADMIN_MIN_TOKEN_VERSION=N
   ```

5. Verificare proprietario `root:root` e permessi `0600` del file `.env`.
6. Riavviare soltanto il backend con `systemctl`.
7. Verificare nell'ordine:
   - un vecchio token Admin riceve `401`;
   - la vecchia password Admin non effettua il login;
   - la nuova password effettua il login;
   - il nuovo token Admin accede a `/api/auth/me`;
   - un token gia attivo di un locale continua a funzionare.

## Note operative

- Il logout frontend avviene alla prima richiesta che riceve `401`.
- Un WebSocket gia aperto puo restare tecnicamente connesso fino alla sua
  chiusura naturale, ma il vecchio JWT non puo piu autorizzare chiamate HTTP o
  ottenere nuovi ticket WebSocket.
- Non abbassare `ADMIN_MIN_TOKEN_VERSION` dopo la rotazione: renderebbe di
  nuovo accettabili vecchi token non ancora scaduti.
- La futura revoca generale P1 basata sulla versione salvata in Mongo potra
  sostituire questa soglia dedicata senza cambiare il formato dei token.
