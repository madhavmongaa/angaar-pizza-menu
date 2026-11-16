# Angaar Pizza Co. demo menu

A demo Hindi + English pizza menu for a made-up shop: photo menu, three sizes, cart,
WhatsApp order message, QR code, a drag-and-drop "make your own pizza" builder with
30 toppings, hover zoom and full screen. Everything ships as one HTML file.

- `05-site/index.html`: the finished menu. Open it in a browser or upload it to any static host.
- `05-site/artifact.html`: the same page without the outer page tags, for publishing as a Claude artifact.
- `src/index.html`: the page without photos. Edit this, not the built files.
- `process.py`: cuts the photos in `03-images/` into transparent WebP pieces (`04-processed/`) and builds `05-site/`.
- `02-data/menu.json`: menu data (pizzas, sauces, toppings, prices) in English and Hindi.
- `03-images/PROMPTS.md`: the image prompts used to generate the photos.

## Rebuild

```bash
pip install pillow numpy scipy
python process.py
```

## Before using it for a real shop

- Change the WhatsApp number (`"wa"`, country code 91 plus 10 digits) and the shop name in `src/index.html`.
- Set `"url"` in the shop data to the public address of the menu, so the QR code points to it.
- Have the owner check every price and a native speaker read the Hindi.
