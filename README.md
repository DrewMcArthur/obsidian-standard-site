# Standard.site Publisher for Obsidian

Publish your Obsidian vault notes to the [AT Protocol](https://atproto.com/) as [Standard.site](https://standard.site) documents. Write in Obsidian, publish to the open social web — no static site generator, no deploy step, no hosting required.

Notes become `site.standard.document` records on your Personal Data Server (PDS), immediately discoverable by readers that support Standard.site lexicons.

## Features

- **Publish notes** from your vault to ATProto with a single command
- **Pull notes** back from ATProto into your vault
- **Sync diff** — detects creates, updates, and orphaned records
- **Multi-publication support** — manage multiple blogs/sites from one vault
- **Markdown transform** — converts Obsidian-flavored markdown (wikilinks, callouts, highlights, comments) to standard GFM
- **Cover images** — attach a vault image to any note via frontmatter; uploaded as an ATProto blob
- **Document references** — cross-document `at://` URIs are stored in records so ATProto indexers can discover backlinks
- **Frontmatter template** — command to scaffold publish frontmatter on any note
- **Static viewer** — included single-file HTML viewer that renders your publication directly from ATProto
- **ATProto OAuth** — authenticates with ATProto OAuth, PKCE, PAR, DPoP, and refresh tokens instead of app passwords

## Installation

### Via BRAT (Beta Reviewers Auto-update Tester)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
2. In Obsidian, open Settings → BRAT
3. Click "Add Beta plugin"
4. Enter `SootyOwl/obsidian-standard-site` as the repository
5. Enable the plugin in Obsidian → Settings → Community Plugins

### Manual Installation

1. Clone this repo into your vault's `.obsidian/plugins/standard-site-publisher/` directory
2. `npm install`
3. `npm run build`
4. Enable the plugin in Obsidian → Settings → Community Plugins

## Configuration

Open the plugin settings in Obsidian and configure:

| Setting | Description |
|---|---|
| **Handle** | Your ATProto handle (e.g. `alice.bsky.social`) |
| **OAuth account** | Connect your account from the settings panel. The plugin opens the ATProto authorization flow in your browser and listens on a temporary loopback callback URL. |
| **Base URL** | Your site URL (e.g. `https://myblog.example.com`); synced to the publication record |
| **Publish Root** | Vault folder containing notes to publish (empty = entire vault) |
| **Pull Folder** | Where to save pulled notes (defaults to publish root) |

After connecting OAuth, select an existing publication or create a new one from the settings panel.

By default the desktop plugin uses the ATProto loopback client pattern with `http://localhost` client metadata and a `http://127.0.0.1:45231/standard-site-oauth-callback` redirect URI. It requests `atproto repo:site.standard.publication repo:site.standard.document blob:image/*` so it can manage Standard.site records and upload cover images. Advanced settings allow changing the callback port or supplying hosted client metadata if needed.

## Usage

### Publishing

Add `publish: true` to a note's frontmatter:

```yaml
---
title: My Post
publish: true
tags: [blog, tech]
description: A short summary
slug: custom-slug        # optional path override
coverImage: images/hero.png  # optional vault image path
---

Your content here...
```

Use the **Add publish frontmatter** command to scaffold these fields on any note automatically.

Run the **Publish to Standard.site** command from the command palette. After first publish, the plugin writes an `rkey` field back to your frontmatter for fast syncing on subsequent updates.

Wikilinks to other published notes (e.g. `[[My Other Post]]`) are resolved to standard markdown links and stored as `at://` references in the document record, enabling backlink discovery across ATProto.

### Pulling

Run the **Pull from Standard.site** command to import published documents back into your vault as markdown files.

## Viewer

The `viewer/` directory contains a zero-dependency static HTML site that renders your publication directly from ATProto.

### Setup

```bash
mkdir my-site && cd my-site
curl -fsSL https://raw.githubusercontent.com/SootyOwl/obsidian-standard-site/refs/heads/main/viewer/setup.sh | bash
```

The script downloads the viewer files, prompts for your handle, resolves your DID, lists your publications, and configures everything automatically.

Host the resulting directory on any static host (GitHub Pages, Cloudflare Pages, Netlify, etc.).

### Features

- Client-side rendering with clean URL routing (History API)
- Open Graph and Twitter Card meta tags for social sharing
- Light/dark mode
- Post list with dates, descriptions, tags, and cover image thumbnails
- Cover images displayed as hero images on individual posts
- Backlinks section showing documents that reference the current post
- Inter-note link resolution
- Custom theming via `custom.css`
- 5-minute session cache with manual refresh
- Optional Cloudflare Pages Function for per-post social cards

### Deployment

The viewer works on any static host. For enhanced social sharing (per-post cards when links are shared on Twitter, Discord, etc.), deploy to Cloudflare Pages — the included Pages Function automatically injects Open Graph meta tags by fetching your content from ATProto at the edge.

| Host | Social cards | Clean URLs |
|------|-------------|------------|
| GitHub Pages | Homepage only | Yes (via 404.html) |
| Cloudflare Pages | Per-post | Yes (native) |
| Other static hosts | Homepage only | Yes (via 404.html) |

## Network and data disclosure

This section is provided per Obsidian's developer policies to disclose how the plugin uses network requests and handles credentials.

**Network requests.** The plugin resolves your handle and OAuth server using ATProto identity and OAuth discovery, including your PDS, authorization server metadata, and the PLC directory as needed. It opens the authorization page in your browser, listens for the OAuth callback on a local loopback HTTP server, and then connects to your PDS to publish, update, unpublish, and sync notes. Write traffic goes to your PDS.

**Authentication.** The plugin uses ATProto OAuth rather than app passwords. The OAuth SDK performs the authorization-code flow with PKCE, PAR, DPoP-bound access tokens, and refresh-token handling.

**Credential storage.** Your handle, authorized DID, OAuth session data, refresh token, pending OAuth state, and DPoP private key material are stored in the plugin's `data.json` file within your vault's `.obsidian/plugins/standard-site-publisher/` directory. This is Obsidian's standard local plugin storage mechanism. OAuth sessions can be revoked from the plugin settings or from your ATProto account provider.

**No telemetry.** The plugin does not collect analytics, telemetry, or tracking data of any kind.

## Development

```bash
npm run dev          # watch mode
npm run build        # type-check + production build
npm test             # run tests
npm run test:watch   # watch mode for tests
```

## ATProto Lexicons

| Lexicon | Usage |
|---|---|
| `site.standard.publication` | Blog/site identity |
| `site.standard.document` | Individual published note |
| `at.markpub.markdown` | Markdown content block within documents |

## License

MIT
