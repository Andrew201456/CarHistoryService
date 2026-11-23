# CarHistoryService

A mobile-first service history app (Greek) built on Cloudflare Workers, Static Assets, Workers AI and Durable Objects.

## What is included
- Dashboard with the next service, annual costs and visit count.
- Search and filters for regular services vs repairs.
- Quick job presets in the existing editable service form.
- Recurring kilometre-based maintenance reminders (optional).
- Expense breakdown grouped by job and year.
- Automatically saved, device-local draft entries.
- Installable PWA (Android install prompt, Safari instructions) and offline-cached static shell.
- Authenticated server sync with revision checks and three-way merge of concurrent edits.
- Fifth bottom-tab "AI Μηχανικός" with a private service-history-aware diagnostic conversation.

## Storage / first deployment

`wrangler.jsonc` includes a new SQLite-backed Durable Object binding, `CAR_DATA`, and a migration for class `CarServiceStore`. Deploy with Wrangler so Cloudflare provisions the class.

Existing records are **not deleted**: on the first authenticated `/api/data` request, the Worker copies the previous `DATA` KV key (`data`) into Durable Object storage when the new store is empty. KV remains as a **read-only historical backup**. All subsequent writes use the Durable Object and increment a revision. Clients must submit their last-seen revision; stale writes return HTTP 409.

Keep the existing `DATA` KV binding, `PASSCODE` secret and `AI` binding. **Do not remove the KV binding on the first deployment.** Check existing records in the app after deployment. Because new writes are stored in the Durable Object, rolling back to the old Worker version alone would show the older KV snapshot; export a fresh backup before any rollback.

Existing, long-open browser tabs running an older app version should be reloaded after the deployment, as the old client does not send revisions and cannot write to the new API.

Client-side data and unsent changes are saved in localStorage; drafts are stored separately, not included in the official service history until the user presses Save.

## Development

```sh
npx wrangler dev
npx wrangler deploy
```

The static shell can load offline after a successful initial visit. The AI import and cross-device synchronization require a connection. The service worker intentionally does not cache authenticated API responses.


## AI Μηχανικός — νέο πέμπτο tab

Ο χρήστης ανοίγει την καρτέλα **AI** και περιγράφει συμπτώματα ή νέα βλάβη (π.χ. μεταλλικό θόρυβο, τρέμουλο στο φρενάρισμα). Η εφαρμογή στέλνει μέσω του **εξουσιοδοτημένου** endpoint `POST /api/diagnose` την ερώτηση μαζί με τα καταχωρημένα service/επισκευές (έως 80 πρόσφατες και 40 σχετικές παλαιότερες), τις υπενθυμίσεις, τα τωρινά χιλιόμετρα και προαιρετικά το μοντέλο/κινητήρα του αυτοκινήτου. Η καρτέλα διαβάζει τα **πραγματικά δεδομένα** της εφαρμογής (και τυχόν ακόμα μη συγχρονισμένες τοπικές εγγραφές), όχι στατικές υποθέσεις.

Το endpoint απαιτεί τον ίδιο `PASSCODE` που προστατεύει ήδη τον συγχρονισμό και τη λειτουργία εισαγωγής. Χρησιμοποιεί το **υπάρχον Cloudflare Workers AI binding** από το `wrangler.jsonc` και το μοντέλο `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Δεν απαιτείται νέο API key ή ρύθμιση provider εφόσον η υπάρχουσα υπηρεσία Workers AI λειτουργεί. Η εφαρμογή δεν αποθηκεύει τα αιτήματα/απαντήσεις στον server, αλλά το ιστορικό συνομιλίας κρατιέται τοπικά στο `localStorage` της συσκευής. Το μοντέλο επεξεργάζεται τις πληροφορίες που του στέλνονται όταν ο χρήστης πατήσει «Ρώτησε». Η σελίδα δεν αποστέλλει στοιχεία στο AI αυτόματα, ούτε τροποποιεί service.

Οι απαντήσεις είναι **υποθέσεις και πρακτικές κατευθύνσεις**, όχι εξ αποστάσεως επιβεβαιωμένη διάγνωση. Το system prompt απαιτεί αναφορές σε πραγματικές εγγραφές, διαχωρισμό βεβαιωμένων εργασιών από πιθανές αιτίες, σαφείς προειδοποιήσεις για κινδύνους (φρένα, τιμόνι, καύσιμα, υπερθέρμανση κ.λπ.) και παραπομπή σε συνεργείο όταν απαιτείται.

Η **καρτέλα AI απαιτεί internet**. Το ιστορικό, οι καταχωρήσεις και η offline-cached εφαρμογή συνεχίζουν να λειτουργούν χωρίς σύνδεση. Η πέμπτη καρτέλα είναι σε στενή διάταξη για οθόνες iPhone. Εάν δεν εμφανίζεται μετά το deployment, κλείσε/άνοιξε την εγκατεστημένη εφαρμογή ώστε να ανανεωθεί η PWA cache.
