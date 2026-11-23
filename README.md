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
- Per-account authenticated server sync with revision checks and three-way merge of concurrent edits.
- Fifth bottom-tab "AI Μηχανικός": streamlined chat with a structured, editable vehicle profile, service-history-aware diagnosis and local chat history.

## Προσωπικοί λογαριασμοί και απομόνωση ιστορικού (v13)

Η πρώτη οθόνη είναι πλέον **μόνο σύνδεση**: ένα πεδίο κωδικού και ένα κουμπί «Σύνδεση». Η μικρή επιλογή «Δημιουργία λογαριασμού» οδηγεί σε ξεχωριστή οθόνη με το πεδίο για δικό σου κωδικό, τυχαίο 4ψήφιο και κουμπί επιστροφής. Όταν δημιουργηθεί λογαριασμός, οι επιλογές κρύβονται μέχρι ο χρήστης να αποθηκεύσει τον νέο κωδικό. Δεν άλλαξε κανένα API, δικαίωμα πρόσβασης ή ιστορικό.

Η **δημιουργία προσωπικού κωδικού δεν απαιτεί συγκεκριμένο μήκος ή πρόθεμα**. Ο χρήστης μπορεί να βάλει `1234`, `5678`, `12345678ςς`, ελληνικά/λατινικά γράμματα, αριθμούς, σημεία στίξης και συνδυασμούς αυτών. Υπάρχει μόνο τεχνικό όριο 64 εμφανών χαρακτήρων και αποκλείονται κρυφοί/ελεγκτικοί χαρακτήρες. Το σύστημα αφαιρεί κενά στην αρχή και στο τέλος και κανονικοποιεί πεζά/κεφαλαία (Unicode NFKC). Δεύτερη εγγραφή με τον ίδιο κανονικοποιημένο κωδικό επιστρέφει **409** και δεν εκθέτει ποτέ τα δεδομένα του υπάρχοντος λογαριασμού. Η **αυτόματη δημιουργία** εξακολουθεί να παράγει τυχαίο 4ψήφιο.

**Προσοχή:** σύντομοι ή προβλέψιμοι κωδικοί όπως `1234` παραμένουν ευάλωτοι σε μαντέματα. Το να επιτρέπεται ο κωδικός δεν τον κάνει ασφαλή. Για ιδιωτικό ιστορικό χρησιμοποίησε μακρύτερο, μη προβλέψιμο κωδικό ή επιπλέον ταυτοποίηση.

Η σύνδεση εφαρμόζει **όριο αποπειρών για όλα τα είδη κωδικών** ανά IP και ανά hash κωδικού (μία ώρα). Κατόπιν δίνει τυχαία συνεδρία που λήγει σε 30 ημέρες. Όλοι οι **νέοι** λογαριασμοί απαιτούν συνεδρία για ανάγνωση/αποθήκευση service, λειτουργίες AI και μεταφορά ιστορικού — ο ίδιος ο κωδικός δεν γίνεται δεκτός σε κανονικά API. Διατηρείται η συμβατότητα raw bearer μόνο για **προϋπάρχοντες μεγάλους** κωδικούς (CS- ή παλιά μακρά αλφαριθμητικά), όχι για παλαιότερους τετραψήφιους. Το νέο Durable Object δημιουργεί και δείκτη `sessionRequired` για κάθε νέο account.

Η εφαρμογή αποθηκεύει ανά λογαριασμό διαφορετικά τοπικά δεδομένα, συγχρονισμό, πρόχειρα, συνομιλία AI και settings. Η αποσύνδεση καθαρίζει την τοπική cache αφού ελεγχθούν οι μη συγχρονισμένες αλλαγές. Το παλιό `PASSCODE` χρησιμοποιείται μόνο για την εφάπαξ μεταφορά παλιού κοινού ιστορικού.

### Μεταφορά του παλιού σου ιστορικού — ΜΙΑ φορά

Η προηγούμενη έκδοση χρησιμοποιούσε κοινό κωδικό `PASSCODE` και ένα κοινό Durable Object (`car-service-primary`). **Το παλιό ιστορικό δεν διαγράφεται**.

1. Πριν από την αλλαγή, εξήγαγε για ασφάλεια ένα αντίγραφο από την καρτέλα «Αντίγραφο».
2. Μετά το deployment δημιούργησε **νέο, άδειο λογαριασμό** και φύλαξε τον κωδικό που θα παραχθεί.
3. Στην καρτέλα «Αντίγραφο» υπάρχει ενότητα «Έχεις παλιό ιστορικό;». Συμπλήρωσε τον **προηγούμενο Cloudflare PASSCODE** και πάτα «Μεταφορά παλιού ιστορικού». Η μεταφορά δουλεύει μόνο σε άδειο νέο λογαριασμό, προστατεύεται από rate limit, απομονώνει τη βάση και *κλειδώνει το παλιό ιστορικό* ώστε να μη μεταφερθεί σε δεύτερο λογαριασμό.
4. Επαλήθευσε το ιστορικό και τα τωρινά χιλιόμετρα μετά την επαναφόρτωση. Εάν η συσκευή κρατούσε μη συγχρονισμένες παλιές εγγραφές, η νέα έκδοση μεταφέρει και την τοπική cache/baseline ώστε να συγχωνευτούν χωρίς σιωπηλή διαγραφή.

ΠΡΟΣΟΧΗ: Πριν από το deployment βεβαιώσου ότι έχεις **backup** και τον παλιό κωδικό. Τα παλιά tabs/PWA πρέπει να ανανεωθούν: το παλιό client δεν μπορεί πλέον να διαβάσει το κοινό dataset με το PASSCODE. Αν ο παλιός κωδικός είναι γνωστός σε άλλους ή είναι αδύναμος, άλλαξέ τον σε ισχυρό **Cloudflare secret PASSCODE πριν τη μεταφορά** και χρησιμοποίησε τη νέα τιμή αποκλειστικά για τη μεταφορά. Κανείς δεν πρέπει να αποκτήσει τον παλιό κωδικό όσο η μεταφορά παραμένει ανοιχτή.

Η διαδικασία απαιτεί το **υπάρχον** Cloudflare Worker, το KV DATA (μόνο για backup/legacy migration), το AI binding και το Durable Object `CAR_DATA`. Δεν χρειάζεται δημιουργία ενός Worker ή ενός χειροκίνητου λογαριασμού ανά χρήστη, ούτε νέο binding. Ενδέχεται να υπάρχουν χρεώσεις χρήσης Cloudflare, ανάλογα με το πρόγραμμα. Τρέξε τις δοκιμές `node tests/account-isolation.mjs` πριν από production deployment.

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
