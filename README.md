# App_Scadenze

PWA per la gestione dei prodotti acquistati, delle scadenze e degli sprechi economici.
Scansiona, salva, consuma. Niente più cibo sprecato.

- **Frontend**: React 19 + TypeScript strict + Vite 6 + Tailwind CSS 4 (PWA)
- **Backend**: Supabase (PostgreSQL + RLS + Edge Functions + Cron)
- **Funzioni**: scansione barcode, riconoscimento prodotto (Open Food Facts),
  prezzo automatico Coop.fi, notifiche Web Push 7 giorni prima della scadenza,
  calcolo sprechi, dashboard.

## Setup

```bash
npm install
cp .env.example .env   # inserisci le variabili Supabase
npm run dev            # sviluppo su http://localhost:5173
npm run build          # produzione (dist/)
npm test               # test unitari
```

## Database

Applica le migrazioni con `supabase db push` (vedi `supabase/migrations/`).
L'accesso è riservato: solo l'email in `src/lib/access.ts` e nel trigger
`0002_allowlist.sql` può registrarsi.