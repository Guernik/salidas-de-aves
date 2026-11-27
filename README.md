# Salidas de aves

Upcoming (and past) birdwatching outings announced by clubs and groups on Instagram, in one static page, with a calendar feed people can subscribe to.

**Site:** https://guernik.github.io/salidas-de-aves/

The data is produced by [ig_monitor](https://github.com/Guernik/ig_monitor), a set of n8n workflows that fetch the clubs' posts, classify them with Claude and push the outings here. This repo only holds the page and the published data.

## How it works

```mermaid
flowchart LR
    IG[(Instagram)] --> M["ig_monitor<br>(n8n on k3s)"]
    M -- "git push data/<br>(deploy key)" --> R[this repo, main]
    DEV[You] -- "edit the page" --> R
    R -- "every push" --> A["GitHub Actions<br>pages.yml"]
    A --> P[GitHub Pages]
    P --> B[Browser: index.html + app.js]
    P --> C[Calendar apps: data/salidas.ics]
```

```mermaid
sequenceDiagram
    participant N as ig_monitor publish workflow
    participant G as this repo (main)
    participant A as GitHub Actions
    participant S as GitHub Pages
    participant V as Visitor

    N->>G: commit data/ when outings change (every 30 min at most)
    G->>A: push
    A->>S: deploy the whole repo
    V->>S: GET /
    S-->>V: index.html, app.js, style.css
    V->>S: GET data/outings.json
    S-->>V: outings
    Note over V: app.js renders, groups and filters in the browser
```

There is no build step and no server: the page is plain HTML, CSS and JavaScript, and `app.js` reads `data/outings.json` at load time.

## Files

| Path | Owner | What |
|---|---|---|
| `index.html`, `app.js`, `style.css` | edited here | the page |
| `data/outings.json` | ig_monitor | every outing ever found, upcoming and past |
| `data/salidas.ics` | ig_monitor | iCalendar feed, one event per outing date |
| `data/images/` | ig_monitor | the first image of each outing's post |
| `.github/workflows/pages.yml` | edited here | deploys to Pages on every push to `main` |

Don't edit `data/` by hand: ig_monitor regenerates it from its database on every run and would overwrite the change.

### `data/outings.json`

```json
{
  "outings": [
    {
      "key": "coapalermo|2026-12-06",
      "title": "Salida de observación de aves",
      "dates": ["2026-12-06"],
      "start_time": "08:00",
      "location": "Reserva Ecológica Costanera Sur",
      "details": "Inscripción por mensaje directo",
      "expires_on": "2026-12-06",
      "username": "coapalermo",
      "full_name": "COA Palermo",
      "post_url": "https://www.instagram.com/p/...",
      "published_at": "2026-11-27T13:00:00.000Z",
      "caption": "First 600 characters of the post...",
      "image": "images/<post_id>.jpg"
    }
  ]
}
```

An outing is upcoming while `expires_on` (its last date, or 14 days after the post when it has no date) is today or later in Buenos Aires time; otherwise it shows under "Anteriores".

## The page

```mermaid
flowchart TD
    L[load data/outings.json] --> T{Tab}
    T -- Próximas --> U["expires_on >= today<br>sorted by next date"]
    T -- Anteriores --> PA["expires_on < today<br>newest first"]
    U --> F[filters: text, club, when]
    PA --> F2[filters: text, club]
    F --> GU["groups: Este fin de semana,<br>Próximos días, Más adelante,<br>Fecha a confirmar"]
    F2 --> GP[groups: by month]
```

- **Buscar:** free text over title, location, details and account.
- **Club:** one Instagram account.
- **Cuándo** (upcoming only): this weekend, next 7 days, next 30 days.
- **Suscribirse al calendario:** a `webcal://` link to `data/salidas.ics`, so phones and calendar apps subscribe instead of downloading once.

Dates are always computed in `America/Argentina/Buenos_Aires`, whatever the visitor's timezone.

## Working on the page

```fish
python3 -m http.server 8000
```

Then open http://localhost:8000. Pushing to `main` deploys.
