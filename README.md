# AdPages UTM Redirect Worker

Cloudflare Workers starter for campaign short links. It redirects known paths such as `/audit` or `/qr-checklist` to configured destination URLs while appending normalized UTM parameters.

It is designed to be publishable as a GitHub template or Cloudflare Workers starter:

- configured destinations only, so visitors cannot supply an open redirect target
- no cookies, hidden tracking pixels, analytics calls, or remote executable code
- no paid service dependency beyond a Cloudflare Workers project
- local dry-run mode for checking the final redirect URL before sharing a link

## Quick Start

```bash
npm install
npm run check
npm run dev
```

Open:

```text
http://localhost:8787/audit?utm_term=landing%20page&dry_run=1
```

Deploy after editing `wrangler.toml`:

```bash
npm run deploy
```

## Configure Routes

Routes live in the `ROUTES_JSON` variable in `wrangler.toml`.

```json
{
  "/audit": {
    "destination": "https://www.example.com/free-website-audit",
    "utm": {
      "utm_campaign": "website_audit"
    },
    "allowedPassthroughParams": ["utm_term", "utm_content"]
  }
}
```

Each route supports:

| Field | Purpose |
| --- | --- |
| `destination` | Required absolute `https://` or `http://` URL. |
| `utm` | Optional UTM values to apply to the destination. |
| `allowedPassthroughParams` | Optional allow-list of incoming query parameters to forward. Keep this narrow. |
| `status` | Optional redirect status: `301`, `302`, `307`, or `308`. Defaults to `302`. |

The worker also applies `DEFAULT_UTM_SOURCE` and `DEFAULT_UTM_MEDIUM` when the destination and route do not already provide those values.

## UTM Normalization

UTM values are normalized before redirecting:

- trimmed
- lowercased
- spaces and underscores converted to hyphens
- restricted to URL-safe campaign characters
- capped at 128 characters

For example, `Landing Page Audit` becomes `landing-page-audit`.

## Dry Run

Add `dry_run=1` to any configured route to inspect the redirect target as JSON:

```text
/audit?utm_term=Homepage%20QA&dry_run=1
```

The worker returns:

```json
{
  "route": "/audit",
  "status": 302,
  "redirectTo": "https://www.example.com/free-website-audit?utm_source=shortlink&utm_medium=redirect&utm_campaign=website-audit&utm_term=homepage-qa"
}
```

## Privacy Notes

This template does not store data, set cookies, call analytics services, or send visitor data to third parties. Cloudflare may still provide platform request logs depending on your account settings. If you publish a fork, document any analytics or logging you add.

## Publishing Checklist

- Replace example domains in `wrangler.toml`.
- Set a production Worker name.
- Decide whether each route should be temporary `302` or permanent `301`.
- Keep passthrough parameters limited to non-sensitive marketing fields.
- Add a short privacy note to the repository README if you publish this as a template.

## Publisher

Built by [AdPages from A1 Local](https://a1local.com.au/extensions/) as a free, dependency-light resource for local-service marketers, web designers, and small business site owners.
