# App_Scadenze

PWA per la gestione dei prodotti acquistati, delle scadenze e degli sprechi economici.
Scansiona, salva, consuma. Niente più cibo sprecato.

- **Frontend**: React 19 + TypeScript strict + Vite 6 + Tailwind CSS 4 (PWA)
- **Backend**: Supabase (PostgreSQL + RLS + Edge Functions + Cron)
- **Funzioni**: scansione barcode prodotto (fotocamera), riconoscimento prodotto
  multi-livello (catalogo locale → prodotti esistenti → Open Food Facts → manuale),
  import spesa da scontrino (barcode ricevuta → OCR locale Tesseract → schermata di
  conferma), quantità e lotti, notifiche Web Push, calcolo sprechi quantity-aware,
  dashboard.

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
L'accesso è riservato: solo le email in `src/lib/access.ts` e nel trigger
`0002_allowlist.sql` possono registrarsi.

### Migrazione 0005 (quantità, acquisti, import)

- `products`: nuove colonne `quantity_count`, `consumed_count`, `notes`,
  `import_method`, `purchase_id`; `expiration_date` diventa opzionale (i
  prodotti importati non hanno scadenza nota: non viene mai inventata).
- Nuove tabelle `purchases` e `purchase_items` (una spesa → N righe), con RLS.
- Il prezzo è il **prezzo unitario effettivamente pagato**: lo spreco vale
  `price × (quantity_count − consumed_count)`.

### Migrazione 0006 (decontaminazione S-Kaupat)

Il progetto target è **Unicoop Firenze / Coop.fi (Italia)**. La precedente
ricerca prezzi usava S-Kaupat (S-Group Finlandia): è stata rimossa
(edge function eliminata, tabella `price_cache` droppata, timezone del
database portata a `Europe/Rome`). Non esiste un'API pubblica del catalogo
Coop.fi: **i prezzi arrivano dallo scontrino (OCR) o vengono inseriti
dall'utente** — mai da cataloghi di terze parti.

## Note sul barcode dello scontrino Coop.fi

Il grande barcode in fondo alle ricevute Coop.fi (es. `99900107204021562908264`,
23 cifre, prefisso `999` non-GS1) è un **codice interno del punto vendita**:
non esiste un servizio pubblico o autorizzato per risalire ai prodotti
acquistati (l'archivio scontrini digitali è consultabile solo dentro l'app
ufficiale Coop.fi, con accesso personale, e non espone API). L'app quindi usa
l'**OCR locale** (Tesseract.js in italiano, i dati non lasciano il dispositivo)
come metodo di importazione, con schermata di conferma prima del salvataggio.
Il codice letto viene salvato come `receipt_identifier` della spesa.