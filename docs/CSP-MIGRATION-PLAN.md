# CSP Migration Plan — Remove `unsafe-inline`

## Status: PLANNED (S3B1-T3)

## Current State

- Helmet CSP active in `server.js`
- `scriptSrc` includes `'unsafe-inline'` — required for inline `<script>` blocks
- `styleSrc` includes `'unsafe-inline'` — required for inline styles
- `scriptSrcAttr` includes `'unsafe-inline'` — required for `onclick` handlers
- 3 CDN domains whitelisted (jsdelivr, cdnjs, unpkg)

## Inline Scripts Inventory

### index.html

1. **Fetch wrapper** (~10 lines) — Adds `X-Zeus-Request` header to all fetch calls
2. **LWC fallback** (~5 lines) — CDN fallback for Lightweight Charts
3. **Pull-to-refresh** (~20 lines) — Touch event handler
4. **300+ onclick/onchange attributes** — Event handlers on buttons/inputs

### login.html

1. **Fetch wrapper** (~10 lines) — Same as index.html
2. **Login logic** (~400 lines) — Form handling, 2FA, password validation
3. **100+ onclick/onchange attributes** — Event handlers

## Migration Steps (Ordered by Risk)

### Phase 1: Extract shared inline scripts → external files

- Move fetch wrapper to `public/js/core/fetchWrapper.js`
- Move LWC fallback to `public/js/core/lwcFallback.js`
- Move pull-to-refresh to `public/js/core/pullRefresh.js`
- Move login logic to `public/js/login.js`
- Load via `<script src="...">` instead of inline `<script>`

### Phase 2: Replace onclick/onchange with addEventListener

- Audit all inline event handlers in index.html and login.html
- Move to JS files using `document.getElementById().addEventListener()`
- Once cleared: remove `scriptSrcAttr: ['unsafe-inline']`

### Phase 3: Implement CSP Nonce for any remaining inline scripts

- Generate per-request nonce in Express middleware
- Inject nonce into HTML template: `<script nonce="xxx">`
- Update CSP: replace `'unsafe-inline'` with `'nonce-xxx'`
- Requires server-side HTML templating (EJS or string replace)

### Phase 4: Add SRI (Subresource Integrity) to CDN scripts

- Generate SHA-384 hashes for CDN resources
- Add `integrity="sha384-..."` and `crossorigin="anonymous"` attributes
- *Note: SRI is tracked separately in S3B2*

## Risk Assessment

- Phase 1: LOW — simple file extraction, no logic changes
- Phase 2: MEDIUM — 300+ handlers, must verify each works post-migration
- Phase 3: HIGH — requires server-side nonce injection, template changes
- Phase 4: LOW — static hash addition

## Recommended Timeline

- Phase 1+4 together (next sprint)
- Phase 2 after Phase 1 is stable
- Phase 3 as final hardening step
