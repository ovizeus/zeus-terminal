// Build index.html from zeus-v122-final.html
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join('c:\\Users\\ZeuS\\Desktop\\Zeus-Terminal AI', 'zeus-v122-final.html'),
  'utf-8'
).split('\n');

function lines(a, b) { return src.slice(a - 1, b).join('\n'); }

// HTML body content block 1: L4073 to L5217
const bodyHtml1 = lines(4073, 5217);
// HTML body content block 2: L5339 to L6808 (after inline style, before mega script)
const bodyHtml2 = lines(5339, 6808);

// Head meta from L3872-3878 (manifest, icons, theme-color, apple meta)
const headMeta = lines(3872, 3878);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="ZeuS">
<meta name="theme-color" content="#0a0a0a">
<title>ZeuS Trading Terminal</title>
${headMeta}
<link rel="stylesheet" href="css/main.css">
<link rel="stylesheet" href="css/components.css">
<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js" onerror="loadLWC2()"></script>
</head>
<body>
${bodyHtml1}

<!-- brain ext styles loaded from components.css -->

${bodyHtml2}

<!-- ═══ JS MODULES — dependency order ═══ -->

<!-- 1. Utils (no deps) -->
<script src="js/utils/helpers.js"></script>
<script src="js/utils/formatters.js"></script>
<script src="js/utils/math.js"></script>

<!-- 2. Core state & config (depends on utils) -->
<script src="js/core/state.js"></script>
<script src="js/core/config.js"></script>
<script src="js/core/constants.js"></script>
<script src="js/core/events.js"></script>

<!-- 3. Utils that depend on core -->
<script src="js/utils/guards.js"></script>
<script src="js/utils/dev.js"></script>

<!-- 4. Data layer -->
<script src="js/data/storage.js"></script>
<script src="js/data/symbols.js"></script>
<script src="js/data/marketData.js"></script>
<script src="js/data/klines.js"></script>

<!-- 5. Brain — deep dive (PM, ARES, ARES_MIND IIFEs) -->
<script src="js/brain/deepdive.js"></script>
<script src="js/brain/signals.js"></script>
<script src="js/brain/confluence.js"></script>
<script src="js/brain/forecast.js"></script>
<script src="js/brain/brain.js"></script>

<!-- 6. Trading -->
<script src="js/trading/dsl.js"></script>
<script src="js/trading/risk.js"></script>
<script src="js/trading/positions.js"></script>
<script src="js/trading/orders.js"></script>
<script src="js/trading/autotrade.js"></script>

<!-- 7. UI -->
<script src="js/ui/dom.js"></script>
<script src="js/ui/panels.js"></script>
<script src="js/ui/modals.js"></script>
<script src="js/ui/notifications.js"></script>
<script src="js/ui/render.js"></script>

<!-- 8. Late-load brain modules -->
<script src="js/brain/aub.js"></script>
<script src="js/brain/arianova.js"></script>

<!-- 9. Orderflow (standalone, large) -->
<script src="js/data/orderflow.js"></script>

<!-- 10. Patch layer -->
<script src="js/core/patch.js"></script>

<!-- 11. Bootstrap (MUST be last — calls startApp) -->
<script src="js/core/bootstrap.js"></script>

</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'public', 'index.html'), html, 'utf-8');
console.log(`✓ index.html created (${html.length} bytes)`);
