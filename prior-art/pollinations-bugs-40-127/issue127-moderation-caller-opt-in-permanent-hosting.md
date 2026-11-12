# Issue 127 — Moderation is caller-opt-in only; the platform permanently hosts every generation

**Severity: critical — platform-funded unmoderated content distribution with no takedown path.**

## Summary

The only content filter (`safe=`) **defaults to off** — a caller simply omits it and the
safety middleware passes the bytes through untouched (empty feature set = no scan). Every
generation is stored to R2 and served publicly at `media.pollinations.ai` with
`cache-control: public, max-age=31536000, immutable`, world-readable by URL; anonymous
generation works with **no key at all**; and stored run outputs have no catalog row — so
`DELETE /media/:id` returns 404 and **no owner or admin takedown path exists in the repo**.
The platform pays storage and bandwidth for unmoderated content, permanently, and has no way
to remove it once reported.

## Fix direction

Default-on moderation for stored outputs (at minimum for anonymous/public storage),
retention/TTL for run outputs, catalog rows + a working takedown path.

## PoC

Benign-marker Colab notebook — delivered separately; not included in this archive.
