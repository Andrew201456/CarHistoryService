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
- Fifth bottom-tab "AI Μηχανικός": streamlined chat with a structured, editable vehicle profile, service-history-aware diagnosis and local chat history.

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


## AI Μηχανικός — ανανεωμένο chat και προφίλ αυτοκινήτου

Η **πέμπτη καρτέλα «AI»** έχει καθαρό περιβάλλον συνομιλίας, σύντομες προτεινόμενες ερωτήσεις και πεδίο ερώτησης στο κάτω μέρος. Στην κορυφή υπάρχει γραμμή **«Το αυτοκίνητό μου»**: ανοίγει ξεχωριστή φόρμα για μάρκα, μοντέλο, έτος, καύσιμο, κινητήρα, κυβικά, ίππους, κιβώτιο, έκδοση/αμάξωμα και πρόσθετες σημειώσεις. Δεν χρειάζεται να συμπληρωθούν όλα τα πεδία.

Το προφίλ αποθηκεύεται ως `settings.vehicleProfile` με τον **υπάρχοντα συγχρονισμό Durable Object**. Συνεπώς παραμένει στη συσκευή και συγχρονίζεται ανάμεσα στις συσκευές που χρησιμοποιούν τον ίδιο λογαριασμό/κωδικό. Το schema της βάσης **δεν αλλάζει**. Αν υπήρχε προηγουμένως ένα γενικό `settings.vehicleInfo`, εμφανίζεται ως προαιρετική σημείωση στην πρώτη επεξεργασία, χωρίς να χαθεί. Το AI endpoint δέχεται είτε αυτή την παλιά περιγραφή είτε το νέο, περιορισμένο αντικείμενο στοιχείων οχήματος.

Κατά την υποβολή ερώτησης, ο browser στέλνει στο εξουσιοδοτημένο `POST /api/diagnose` τα στοιχεία που έχει επιλέξει να συμπληρώσει ο χρήστης, τωρινά χιλιόμετρα, service interval, υπενθυμίσεις και έως 80 πρόσφατες + 40 σχετικές παλαιότερες καταχωρήσεις. Το API **χρησιμοποιεί το ήδη υπάρχον Cloudflare Workers AI binding** από το `wrangler.jsonc`. Δεν χρειάζεται νέο API key. Τα δεδομένα αποστέλλονται **μόνο μετά το «Ρώτησε»** και δεν αποθηκεύονται ως chat στον server. Η συζήτηση παραμένει τοπικά σε `localStorage`.

Το AI καλείται να ξεχωρίζει τεκμηριωμένες εγγραφές από υποθέσεις και να προτείνει ασφαλείς ελέγχους/παραπομπή σε συνεργείο. Δεν αποτελεί διαγνωστική βεβαιότητα. Η προβολή κειμένου χρησιμοποιεί `textContent` χωρίς HTML από το μοντέλο.

Το **chat απαιτεί internet**, ενώ το υπόλοιπο ιστορικό συνεχίζει να λειτουργεί offline. Η PWA cache έκδοσης **v8** απαιτεί επαναφόρτωση της εγκατεστημένης εφαρμογής μετά τη δημοσίευση.
