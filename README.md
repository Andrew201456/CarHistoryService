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

## Προσωπικοί λογαριασμοί και απομόνωση ιστορικού (v10)

Η εφαρμογή προσφέρει «Σύνδεση» και **δύο επιλογές δημιουργίας λογαριασμού**: «Δημιουργία τυχαίου κωδικού» ή «Θέλω δικό μου κωδικό». Ο τυχαίος κωδικός έχει 20 χαρακτήρες με **100 bits κρυπτογραφικής τυχαιότητας** και **δεν χρειάζεται πρόθεμα** `CS-`. Ο χειροκίνητος κωδικός επιτρέπεται χωρίς πρόθεμα, με 12–64 λατινικούς χαρακτήρες/αριθμούς, `-` ή `_` και τουλάχιστον ένα γράμμα και έναν αριθμό. Σύντομοι τετραψήφιοι PIN όπως `1234` δεν γίνονται δεκτοί γιατί θα επέτρεπαν πρόσβαση σε ξένα service αν μαντεύονταν.

**Ο κωδικός παραμένει το μοναδικό κλειδί πρόσβασης** (χωρίς αυτόματη ανάκτηση), οπότε ο χρήστης πρέπει να τον φυλάει. Η δημιουργία λογαριασμού χρησιμοποιεί **ατομικό έλεγχο μοναδικότητας** σε Durable Object: εάν ο προσωπικός κωδικός χρησιμοποιείται ήδη, η εφαρμογή αρνείται τη δημιουργία με `409`, και **ποτέ δεν αποκαλύπτει τα δεδομένα του υπάρχοντος χρήστη** από το endpoint δημιουργίας. Οι κωδικοί τύπου `CS-<32 hex>` που είχαν δημιουργηθεί σε παλαιότερες εκδόσεις συνεχίζουν να λειτουργούν στη σύνδεση.

Κάθε κωδικός καταλήγει, μέσω **SHA-256**, στο δικό του `CAR_DATA` Durable Object (`car-service-user-<hash>`). **Κάθε GET/PUT και κάθε Workers AI endpoint επιβεβαιώνει το κλειδί στον server**, πριν επιτρέψει τη λειτουργία. Δεν αρκεί να αλλάξει ο χρήστης κάτι στον browser για να διαβάσει/αλλάξει τα service άλλου. Το παλιό κοινό `PASSCODE` **δεν αναγνωρίζεται πλέον** στα κανονικά endpoints δεδομένων.

Οι τοπικές καταχωρήσεις, ρυθμίσεις, reminders, συγχρονισμός revision/baseline, πρόχειρα service και AI chat αποθηκεύονται με **ξεχωριστά keys ανά scope**. Η εφαρμογή παραμένει κρυφή μέχρι να επαληθευτεί ο κωδικός. Η «Αποσύνδεση / αλλαγή λογαριασμού» διαγράφει από την τρέχουσα συσκευή το συγκεκριμένο λογαριασμό μαζί με την τοπική του cache, όχι από τον server. Δεν επιτρέπει logout αν υπάρχουν μη συγχρονισμένες αλλαγές. **Σε κοινόχρηστες συσκευές πρέπει να πατάς Αποσύνδεση**, αλλιώς η εφαρμογή διατηρεί τη σύνδεση όπως συνηθίζεται σε apps.


### Επιλογή κωδικού και ασφάλεια

Αν επιλέξεις προσωπικό κωδικό, μη χρησιμοποιείς προβλέψιμα στοιχεία αυτοκινήτου ή μικρό αριθμό ως μοναδικό μυστικό (π.χ. `12345678`). Το όριο χαρακτήρων αποτρέπει τους πολύ μικρούς PIN αλλά δεν εγγυάται ότι ένας χειροκίνητος κωδικός δεν μπορεί να μαντευτεί. Ο ασφαλέστερος τρόπος είναι ο τυχαίος κωδικός που παρέχει η εφαρμογή. Χρησιμοποίησε προσωπικό κωδικό μόνο όταν είναι αρκετά δύσκολος. Δεν χρειάζεται ξεχωριστή ρύθμιση στο Cloudflare.

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
