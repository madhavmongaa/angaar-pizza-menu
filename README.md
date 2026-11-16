# Angaar Pizza Co. demo menu

A Hindi + English pizza menu with table ordering for a made-up shop: photo menu, three sizes,
cart, a drag-and-drop "make your own pizza" builder with 30 toppings, hover zoom and full screen.
Customers scan the QR code on their table and send the order straight to the counter; they
see its status change live. Staff work from a separate login page.

## Live

- Menu: https://madhavmongaa.github.io/angaar-pizza-menu/ (add `?t=5` for table 5; the table QR codes do this)
- Staff: https://madhavmongaa.github.io/angaar-pizza-menu/staff.html
- Database and logins: Firebase project `angaar-pizza-orders` (Firestore in Mumbai, free Spark plan)

## Who can do what

| | Customer (no login) | Counter | Owner |
|---|---|---|---|
| Browse menu, build a pizza, order to their table | yes | | |
| See their own orders live, cancel before accepted | yes | | |
| See all of today's orders, accept, reject, mark ready / served / paid | | yes | yes |
| Bills by table, mark a whole table paid | | yes | yes |
| Open or close ordering, prices, sold-out items | | | yes |
| Number of tables, print table QR codes | | | yes |
| Add staff, change roles, switch logins off, send password resets | | | yes |
| Today's sales, best sellers, sales by table | | | yes |

The first visit to the staff page asks for the owner's name, email, password and number of
tables. That runs once; after that the page is a normal sign-in. The rules in `firestore.rules`
enforce all of the above on the server, so hiding a button is never the only protection.

- `05-site/index.html`: the finished menu. Open it in a browser or upload it to any static host.
- `05-site/artifact.html`: the same page without the outer page tags, for publishing as a Claude artifact.
- `05-site/staff.html`, `05-site/fb.js`, `05-site/menu.json`: the staff site, the shared Firebase set-up and the menu data it reads (copied from `src/` by the build).
- `src/index.html`, `src/staff.html`, `src/fb.js`: edit these, not the built files.
- `firestore.rules`: who may read and write what. `tests/rules.test.mjs` checks it (29 cases).
- `process.py`: cuts the photos in `03-images/` into transparent WebP pieces (`04-processed/`) and builds `05-site/`.
- `02-data/menu.json`: menu data (pizzas, sauces, toppings, prices) in English and Hindi.
- `03-images/PROMPTS.md`: the image prompts used to generate the photos.

## Rebuild

```bash
pip install pillow numpy scipy
python process.py          # cuts the photos again and rebuilds everything
python process.py --html   # only rebuilds the pages, reusing the photos (seconds)
```

## Test locally

On localhost the pages talk to the Firebase emulators, never the live database.

```bash
npx firebase-tools emulators:start --only auth,firestore
python -m http.server 8765 --directory 05-site
```

Open http://localhost:8765/staff.html and set up the shop with the made-up logins in
`tests/emulator-accounts.json`, then order from http://localhost:8765/?t=3.

## Deploy rules

```bash
npx firebase-tools deploy --only firestore,auth --project angaar-pizza-orders
```

## Before using it for a real shop

- Change the shop name in `src/index.html` and the Firebase config in `src/fb.js` to the shop's own project.
- Prices sent with an order come from the customer's phone; the counter should glance at the total before accepting.
- Set `"url"` in the shop data to the public address of the menu, so the QR code points to it.
- Have the owner check every price and a native speaker read the Hindi.
