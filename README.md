# NexaXFam on Firebase

1. Firebase Console: create project > Authentication (enable Email/Password + Google) > Firestore (production mode) > upgrade to Blaze (needed for Functions).
2. Project settings > Web app > copy config into `public/firebase-config.js`.
3. Authentication > Settings > Authorized domains: add `gozovip.xyz`.
4. `npm i -g firebase-tools && firebase login && firebase init` (pick existing project; keep the files here) then:
   `npm i`
   `firebase functions:secrets:set INGEST_SECRET`
   `firebase deploy`
5. Hosting > Add custom domain `gozovip.xyz` and add the DNS records it shows.
6. First admin: sign up on the site, verify email, then Firestore > users > your doc > change `role` to `admin`. Open `/admin.html`.
