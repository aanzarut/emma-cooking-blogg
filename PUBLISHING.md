# Putting the site online

The site is a folder of plain HTML files (`dist/`). Any static host will serve
it. Nothing here locks you to one.

The recommendation, given the plan is to stay private for a while and then go
public: **keep the repository private, build up twenty or thirty finished
recipes, then switch it on.** There is nothing to migrate when you do.

## Recommended: GitHub Pages

Free, no extra account, deploys automatically when you push.

**Once, when you're ready to go live:**

1. Make the repository public — *Settings → General → Danger Zone → Change
   visibility*. (Pages can serve from a private repo on paid plans; on the
   free plan it needs to be public.)
2. *Settings → Pages → Build and deployment → Source* → **GitHub Actions**.
3. Edit `.github/workflows/publish.yml` and uncomment the `push:` trigger near
   the top, so every push rebuilds the site.
4. Set the real address in `config/site.json` under `url` — it will be
   `https://<your-github-username>.github.io/emma-cooking-blogg`.
5. Commit and push. The Actions tab shows it building; a couple of minutes
   later the site is live.

**Every time after that:**

```
git add -A
git commit -m "New recipes"
git push
```

The workflow rebuilds and redeploys on its own. `dist/` is not committed —
it's rebuilt by the workflow from the library.

## A custom domain (optional)

Buy a domain anywhere (Namecheap, Cloudflare, Porkbun — roughly $12/year).

1. Put it in `config/site.json` as `"customDomain": "emmaskitchen.com"`. The
   build writes the `CNAME` file GitHub Pages needs.
2. At the domain registrar, add these DNS records:

   | Type | Name | Value |
   |---|---|---|
   | A | @ | 185.199.108.153 |
   | A | @ | 185.199.109.153 |
   | A | @ | 185.199.110.153 |
   | A | @ | 185.199.111.153 |
   | CNAME | www | `<username>.github.io` |

3. In *Settings → Pages*, enter the domain and tick **Enforce HTTPS** once the
   certificate is issued (can take an hour).

## Other hosts

The build output is static, so all of these work with no code changes:

- **Netlify / Vercel** — connect the repo, build command `npm run build`,
  publish directory `dist`. Free tier, nicer preview deploys.
- **Cloudflare Pages** — same settings, very fast, generous free tier.
- **Any web host** — run `npm run build` and upload the contents of `dist/`
  over FTP. No Node.js needed on the server.

## Keeping it private for longer

If you want family and friends to see it before it's public, Netlify and
Cloudflare Pages both offer password protection on their free or cheap tiers.
GitHub Pages does not.

## Backups

The recipes and photos live in `library/`, and photos are committed to git, so
pushing to GitHub *is* a backup. For a second copy, occasionally copy the
`library` folder to an external drive — that folder alone is the whole
archive.
