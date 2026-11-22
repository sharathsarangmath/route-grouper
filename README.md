# Route Grouper (installable web app)

Groups your Amazon Flex stops into parking stops you can walk from, so you get in and out of the van less. Works on iPhone from the home screen, no App Store or Mac needed.

## 1. Put it online (pick one)

### Option A: GitHub Pages (free, permanent, you already have an account)
1. Go to https://github.com/new and create a **public** repository called `route-grouper`.
2. On the new repo page, click **uploading an existing file**. Drag in everything from this folder: `index.html`, `app.js`, `core.js`, `sw.js`, `manifest.webmanifest`, `README.md` and the `icons` folder. Click **Commit changes**.
3. Go to **Settings > Pages**. Under **Branch**, pick `main` and `/ (root)`, then **Save**.
4. After a minute or two, your app is at **https://sharathsarangmath.github.io/route-grouper/**

### Option B: Netlify Drop (fastest)
1. On your Mac, open https://app.netlify.com/drop
2. Drag this whole folder onto the page. You get a web address straight away.
3. Sign up for a free account when it asks, or the site is deleted after an hour.

## 2. Install it on your iPhone
1. Open the address in **Safari**.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open Route Grouper from the home screen icon. It opens full screen like a normal app.

## 3. Add two free keys (once)

**Mapbox token** (finds addresses, draws the map)
1. Sign up at https://account.mapbox.com/
2. Copy your **Default public token** (starts with `pk.`).
3. Tip: under the token's settings, add your app's web address in **URL restrictions** so nobody else can use it.

**OpenRouteService key** (road distances between doors)
1. Sign up at https://openrouteservice.org/dev/#/signup
2. In the Dashboard, request a free **Standard** token and copy it.
3. It's free and can't charge you. If you ever go over its daily limits it just stops working until the next day.

In the app, tap the gear icon, paste both, and tap **Save**. Without the OpenRouteService key the app still works, using rough straight-line estimates, and tells you so.

## What it costs
Nothing, for one route a day:
- Mapbox: about 90 address lookups per route, against 100,000 free a month. The map stays well inside its free allowance too.
- OpenRouteService: about 3 requests per route, against 500 free a day.

## Using it
1. In Flex, open **Itinerary List** and screenshot from stop 1 to the end. Overlaps are fine.
2. In Route Grouper, tap **+** and pick the screenshots.
3. The first time, the text reader downloads once (about 10 MB). After that it's quicker.
4. You get "Park X times instead of Y". Follow **P1, P2…**, tap a door to tick it off, and use **Go** to open Google Maps to the next parking spot.

## Privacy
- Screenshots are read on your phone and never uploaded.
- Addresses are sent to Mapbox to find them on the map and work out road distances.
- Your token and route are stored only on your phone.
