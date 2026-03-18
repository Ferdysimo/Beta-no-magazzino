# Pastasciutta Roma - PRD

## Original Problem Statement
Clone and enhance the website `https://webapp.pastasciuttaroma.com/` - a multi-restaurant pasta order management system.

## Architecture
- **Frontend**: React.js + Tailwind CSS
- **Backend**: FastAPI (Python)
- **Database**: MongoDB
- **Real-time**: WebSocket (upgraded from polling on 2026-03-15)

## Core Requirements
### Authentication
- Multi-restaurant login (Flaminio, Grazie, Brazza)
- JWT-based auth, restaurant-scoped data

### Pages
1. **Cassa** - Order creation, modification, deletion with logs
2. **Tablet Generale** - All orders list view, blue highlight toggle, lock updates
3. **Tablet Bollitore** - Orders with cooking timers, color-coded
4. **Tablet Bollitore 2** (Flaminio only) - Orders ending with `-`
5. **Report di Cassa** - Daily report with timestamps
6. **Report per Excel** - CSV download
7. **Fatture** - Invoice management with shared suppliers
8. **Versamenti** - Deposit slips
9. **Chiusure** - Closing reports (Piatti/Report)

## What's Been Implemented (as of 2026-03-15)
- [x] Full authentication system with 3 restaurant accounts
- [x] Cassa page with order CRUD, logs, auto-numbering
- [x] Tablet Generale with highlight toggle (blue bg-blue-400), lock updates
- [x] Tablet Bollitore with smooth timers, color-coding
- [x] Tablet Bollitore 2 (Flaminio only, orders ending with `-`)
- [x] Report di Cassa with date filtering
- [x] Report per Excel with CSV export
- [x] Fatture with shared supplier management
- [x] Versamenti with image upload
- [x] Chiusure with categorization
- [x] WebSocket real-time updates (replaced polling)
- [x] Lock updates feature on tablet pages
- [x] Darker blue highlight on Tablet Generale (bg-blue-700 + white text)
- [x] Timer Play button race condition fix (single DOM node + WS buffering + optimistic guard)
- [x] Separation Bollitore/Cassa: kitchen_completed field + endpoint (orders stay in Cassa after kitchen completion)
- [x] Monitor Clienti page (Flaminio only): shows order numbers on dark display, camera toggle on Tablet Generale
- [x] Timer colors updated: <3min green, 3-4min red, >4min gray (Bollitore + Cassa synced)
- [x] Image storage optimization: moved from base64-in-DB to file-on-disk, DB size reduced ~98.7%
- [x] "Cancella > 5 minuti" button on both Bollitore pages
- [x] Monitor Clienti: order numbers >99 show only last 2 digits

## Prioritized Backlog
- **P1**: Populate supplier list (user will provide data)
- **P2**: Further WebSocket optimizations if needed

## Credentials
| Username | Password | Location |
|----------|----------|----------|
| Flaminio | Pastasciutt4! | Flaminio |
| Grazie | Pastasciutt4! | Grazie |
| Brazza | Pastasciutt4! | Largo di Brazzà |
