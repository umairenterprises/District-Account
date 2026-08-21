# MPK District Account Register — PWA

Offline-first, multi-device syncing donation/receipt register.

## Kya kya bana hai
- **Login/Signup** — har volunteer apne naam, email, password se account banata hai aur login karta hai
- **Entry** tab — receipt form (aapke original register jaisa hi), har entry par "kis ne add ki" (volunteer ka naam) save hota hai
- **Records** tab — search, edit, delete, CSV/Excel export, JSON backup/restore
- **Summary** tab — total, aaj ka total, book-wise aur city-wise totals
- **Settings** tab — dropdown lists edit karein, workspace code, account/logout
- Offline kaam karta hai (Firestore offline cache + service worker app shell)
- Installable PWA (phone home-screen par "Add to Home Screen")

## Login kaise kaam karta hai (Admin-controlled)
- Koi bhi khud se signup **nahi** kar sakta — sirf **Admin** naye volunteer accounts bana sakta hai
- **Default Admin account** aap khud Firebase console se banayenge (neeche Step 1.5 dekhein)
- Admin app mein login kar ke **Settings → Manage Volunteers** se naye volunteers ke liye naam + email + password set kar sakta hai — wo turant login kar sakte hain
- Sab ek hi **Workspace Code** use karein (Settings tab) taake sab ka data ek jagah sync ho

## Offline support (zaroori — already built-in)
- Ek dafa app kisi bhi device par **internet ke sath khul jaye aur login ho jaye**, uske baad wo device offline bhi kaam karega
- Offline mein bhi: naye receipts add ho sakte hain, edit/delete ho sakta hai, search/summary/export sab kaam karte hain — data phone mein hi mehfooz rehta hai
- Jaise hi internet wapas aaye, sara data khud-b-khud baaki devices ke sath sync ho jata hai (koi manual sync button dabane ki zaroorat nahi)
- **Ek shart:** pehli dafa har volunteer ko login internet ke sath karna hoga (taake unka account verify ho sake) — uske baad wo offline bhi app use kar sakte hain

## Duplicate receipt kabhi save nahi hoti
- Book No + Receipt No dobara likhte hi turant (foran) red error dikhta hai aur **Save button disable ho jata hai** — jab tak change na karein, entry save hi nahi ho sakti
- Ye check offline mein bhi kaam karta hai (device ke apne data se check hota hai)
- Bohot rare situation: agar do volunteers **bilkul same waqt, dono offline** ho kar same Book+Receipt likh dein, to jab dono online ho kar sync honge tab hi conflict pata chalega — is soorat mein Records tab mein wo dono entries laal border ke sath **"⚠ Duplicate"** flag ho jayengi taake admin unhe check kar ke ek delete kar sake

## Donor Name ab dropdown hai
- Donor field ab typing ki jagah **dropdown list** se select hota hai (Settings → Dropdown Lists → Donor Names mein pehle se list daali ja sakti hai, ya bulk import se bhi list ban jati hai)
- Agar koi bilkul naya donor ho jo list mein nahi, dropdown mein **"+ Naya Donor Add Karein"** select kar ke naam likhein — wo automatically list mein permanently add ho jayega taake agli dafa dropdown se select ho sake

## Purana data upload karna (bulk import)
Agar aapke paas pehle se koi purana register/Excel data hai, usko bhi app mein la sakte hain:
1. **Records** tab kholein → **📄 Template Download Karein** dabayein — ek Excel file milegi jisme sahi column headers pehle se banay hain (Date, Book No, Receipt No, Account Type, Department, Sub Head, City, Donor/Name/Account, Amount, Mobile Number, Email, Reference Name, Reference Mobile No)
2. Us file ki pehli example row delete kar dein, apna purana data usi format mein paste/type kar dein (Date hamesha `YYYY-MM-DD` format mein, e.g. `2026-01-15`)
3. File save karein → app mein wapas **⬆ Purana Data Import Karein** dabayein → wahi file select karein
4. App khud check karega ke koi Book No + Receipt No pehle se maujood to nahi (duplicate hui to wo row skip ho jayegi) aur naye Account Type/Department/City values ko dropdown list mein khud-b-khud add kar dega

Import CSV file (.csv) se bhi ho sakta hai, sirf headers same hone chahiyein.

## Setup — steps (10-15 minute)

### 1. Firebase project banayein (free)
1. https://console.firebase.google.com par jayein → **Add project**
2. Naam dein (e.g. `mpk-district`) → continue → project create karein
3. Left menu se **Build → Firestore Database** → **Create database** → **Start in production mode** → apni nearest region choose karein
4. Left menu se **Build → Authentication** → **Get started** → **Email/Password** provider ko **Enable** karein (Sign-in method tab mein)
5. **Default Admin account banayein**: Authentication → **Users** tab → **Add user** → apna email aur password dein → Add user dabayein. **Ye email/password yaad rakhein — isi se aap admin ke tor par login karenge.**
6. Left menu se **Project settings** (gear icon) → neeche scroll karein **Your apps** → **</> (Web app)** icon par click karein → app register karein → aapko `firebaseConfig` object milega, values copy kar lein

### 2. Config paste karein
`firebase-config.js` file kholein:
- `PASTE_YOUR_...` sab jagah apni actual Firebase values daal dein
- `ADMIN_EMAILS` array mein wahi email daalein jo aapne Step 1.5 mein Admin ke liye banayi thi (ek se zyada admin bhi ho sakte hain, comma se separate kar ke)

### 3. Firestore security rules
Firebase console → Firestore → **Rules** tab mein ye paste karein:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /workspaces/{workspace}/entries/{entryId} {
      allow read, write: if request.auth != null;
    }
    match /workspaces/{workspace}/config/{doc} {
      allow read, write: if request.auth != null;
    }
    match /workspaces/{workspace}/users/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```
**Publish** dabayein.

> **Note:** Ye admin panel UI level par restrict hai (sirf `ADMIN_EMAILS` wale user ko Settings mein "Manage Volunteers" dikhta hai). Chunke ye app bina backend server ke chalti hai, koi bhi jo `app.js` file dekh le wo technically account bana sakta hai agar wo koshish kare. Real-world strict security ke liye (jahan sirf server admin ko account banane ki ijazat ho), Firebase Cloud Functions + Admin SDK chahiye hoga — agar future mein chahiye to bata dein, wo bhi add kar sakte hain.

## Hosting (taake HTTPS mile aur install ho sake)
Service worker aur "Add to Home Screen" sirf HTTPS par kaam karte hain. Free options:
- **Firebase Hosting**: `firebase deploy` (agar Firebase CLI use karna chahen)
- **Netlify**: is poore folder ko netlify.com par drag-drop karein
- **GitHub Pages**: repo bana kar files push karein, Pages enable karein

Jo bhi use karein, sab files (`index.html`, `style.css`, `app.js`, `firebase-config.js`, `manifest.json`, `service-worker.js`, `icons/`) usi folder structure mein rehni chahiye.

## Install karna (phone par)
Hosted URL kholein → Chrome/Safari menu → **"Add to Home Screen"** / **"Install App"**. Ab ye ek normal app ki tarah open hogi, offline bhi.

## Abhi tak local demo mode
Agar `firebase-config.js` mein config paste nahi kiya, app "local demo mode" mein khulegi (sirf UI dikhega, data save nahi hoga) — save Firebase config lagane ke baad hi save/sync kaam karega.
