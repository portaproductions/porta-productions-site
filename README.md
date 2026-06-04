# Porta Productions — Website

Live site: https://portaproductions.com

Static single-page site (HTML/CSS/JS in `index.html`) plus assets, SEO files,
security headers, and a 404 page. Hosted on Netlify.

## Edit & deploy
- Edit `index.html` (everything lives in this one file).
- When connected to Netlify via Git, any commit to the `main` branch
  auto-publishes to portaproductions.com.

## Files
- `index.html` — the whole site
- `assets/` — images, hero video, icons
- `_headers` — security headers + caching
- `robots.txt`, `sitemap.xml`, `llms.txt` — SEO / AI crawlers
- `site.webmanifest`, `favicon.ico` — icons / PWA
- `404.html` — custom not-found page
- `netlify.toml` — Netlify publish config
