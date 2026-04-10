// Zeus Terminal — Trade Journal Frontend
'use strict';

var _allTrades = [];
var _filtered = [];
var _mode = 'all';
var _page = 0;
var _perPage = 50;
var _annotations = {}; // seq → { notes, tags, rating }

// ── Init ──
(function init() {
    fetchJournal();
    _fetchAnnotations();
})();

function _fetchAnnotations() {
    fetch('/api/journal/annotations/all', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.ok && data.annotations) _annotations = data.annotations;
        })
        .catch(function() {});
}

function fetchJournal() {
    var params = '?limit=500';
    if (_mode !== 'all') params += '&mode=' + _mode;

    fetch('/api/journal' + params, { credentials: 'include' })
        .then(function (r) {
            if (r.status === 401) { window.location.href = '/'; return null; }
            return r.json();
        })
        .then(function (data) {
            if (!data || !data.ok) { showEmpty(); return; }
            _allTrades = data.trades || [];
            _filtered = _allTrades.slice();
            applyFilters();
            renderStats(data.stats);
            renderChart(_filtered);
        })
        .catch(function (err) {
            console.error('[Journal] Fetch error:', err);
            showEmpty();
        });
}

// ── Mode Tabs ──
function setMode(mode) {
    _mode = mode;
    _page = 0;
    document.querySelectorAll('.j-tab').forEach(function (t) {
        t.classList.toggle('active', t.dataset.mode === mode);
    });
    fetchJournal();
}

// ── Filters ──
function applyFilters() {
    var side = document.getElementById('fSide').value;
    var from = document.getElementById('fFrom').value;
    var to = document.getElementById('fTo').value;
    var reason = document.getElementById('fReason').value;

    _filtered = _allTrades.filter(function (t) {
        if (side && t.side !== side) return false;
        if (reason && t.exitReason !== reason) return false;
        if (from && t.openTs < new Date(from).getTime()) return false;
        if (to && t.openTs > new Date(to).getTime() + 86400000) return false;
        return true;
    });

    _page = 0;
    renderTable(_filtered);
    renderLocalStats(_filtered);
    renderChart(_filtered);
}

function clearFilters() {
    document.getElementById('fSide').value = '';
    document.getElementById('fFrom').value = '';
    document.getElementById('fTo').value = '';
    document.getElementById('fReason').value = '';
    applyFilters();
}

// ── Stats ──
function renderStats(stats) {
    if (!stats) return;
    _setText('sTrades', stats.count);
    _setText('sWinRate', stats.winRate + '%');
    _setColor('sWinRate', stats.winRate >= 50);
    _setText('sPnl', _fmtPnl(stats.totalPnl));
    _setColor('sPnl', stats.totalPnl >= 0);
    _setText('sAvgPnl', _fmtPnl(stats.avgPnl));
    _setColor('sAvgPnl', stats.avgPnl >= 0);
    _setText('sBest', _fmtPnl(stats.bestTrade));
    _setColor('sBest', true);
    _setText('sWorst', _fmtPnl(stats.worstTrade));
    _setColor('sWorst', false);
    _setText('sHold', stats.avgHoldStr || '—');
    _setText('sVolume', '$' + _fmtNum(stats.totalVolume));
}

function renderLocalStats(trades) {
    var wins = trades.filter(function (t) { return t.pnl > 0; });
    var losses = trades.filter(function (t) { return t.pnl < 0; });
    var total = trades.reduce(function (s, t) { return s + t.pnl; }, 0);
    var avg = trades.length > 0 ? total / trades.length : 0;
    var best = trades.length > 0 ? Math.max.apply(null, trades.map(function (t) { return t.pnl; })) : 0;
    var worst = trades.length > 0 ? Math.min.apply(null, trades.map(function (t) { return t.pnl; })) : 0;
    var avgHold = trades.length > 0 ? trades.reduce(function (s, t) { return s + t.holdMs; }, 0) / trades.length : 0;
    var vol = trades.reduce(function (s, t) { return s + (t.size || 0); }, 0);

    _setText('sTrades', trades.length);
    _setText('sWinRate', (trades.length > 0 ? (wins.length / trades.length * 100).toFixed(1) : '0') + '%');
    _setColor('sWinRate', wins.length >= losses.length);
    _setText('sPnl', _fmtPnl(total));
    _setColor('sPnl', total >= 0);
    _setText('sAvgPnl', _fmtPnl(avg));
    _setColor('sAvgPnl', avg >= 0);
    _setText('sBest', _fmtPnl(best));
    _setColor('sBest', true);
    _setText('sWorst', _fmtPnl(worst));
    _setColor('sWorst', false);
    _setText('sHold', _msToStr(avgHold));
    _setText('sVolume', '$' + _fmtNum(vol));
}

// ── Table ──
function renderTable(trades) {
    var body = document.getElementById('tableBody');
    var empty = document.getElementById('emptyState');
    if (!trades.length) {
        body.innerHTML = '';
        empty.style.display = 'block';
        document.getElementById('pagination').innerHTML = '';
        return;
    }
    empty.style.display = 'none';

    var start = _page * _perPage;
    var page = trades.slice(start, start + _perPage);

    body.innerHTML = page.map(function (t, i) {
        var pnlCls = t.pnl > 0 ? 'win bold' : t.pnl < 0 ? 'loss bold' : 'dim';
        var sideCls = t.side === 'LONG' ? 'side-long' : 'side-short';
        var _jEnv = (t.mode === 'live' && window._resolvedEnv === 'TESTNET') ? 'testnet' : t.mode;
        var modeCls = _jEnv === 'testnet' ? 'mode-testnet' : (t.mode === 'live' ? 'mode-live' : 'mode-demo');
        var ann = _annotations[t.seq] || {};
        var stars = ann.rating ? '★'.repeat(ann.rating) + '☆'.repeat(5 - ann.rating) : '';
        var tags = (ann.tags || []).map(function(tg) { return '<span class="j-tag">' + tg + '</span>'; }).join('');
        var notePreview = ann.notes ? ann.notes.substring(0, 30) + (ann.notes.length > 30 ? '...' : '') : '';
        var annCell = '<span class="j-ann-stars">' + stars + '</span>' + tags +
            (notePreview ? '<span class="j-ann-note">' + notePreview + '</span>' : '') +
            '<button class="j-ann-btn" onclick="_openAnnotation(' + t.seq + ')" title="Edit notes">✎</button>';
        return '<tr>' +
            '<td class="dim">' + (start + i + 1) + '</td>' +
            '<td>' + _fmtDate(t.openTs) + '</td>' +
            '<td>' + (t.symbol || '').replace('USDT', '') + '</td>' +
            '<td class="' + sideCls + '">' + t.side + '</td>' +
            '<td class="' + modeCls + '">' + (_jEnv === 'testnet' ? 'TESTNET' : (t.mode || 'demo').toUpperCase()) + '</td>' +
            '<td>$' + _fmtPrice(t.entryPrice) + '</td>' +
            '<td>' + (t.exitPrice ? '$' + _fmtPrice(t.exitPrice) : '—') + '</td>' +
            '<td>$' + _fmtNum(t.size) + '</td>' +
            '<td>' + (t.leverage || '—') + 'x</td>' +
            '<td class="' + pnlCls + '">' + _fmtPnl(t.pnl) + '</td>' +
            '<td class="dim">' + _fmtReason(t.exitReason) + '</td>' +
            '<td class="dim">' + _msToStr(t.holdMs) + '</td>' +
            '<td class="dim">$' + _fmtPrice(t.sl) + '</td>' +
            '<td class="dim">$' + _fmtPrice(t.tp) + '</td>' +
            '<td class="j-ann-cell">' + annCell + '</td>' +
            '</tr>';
    }).join('');

    renderPagination(trades.length);
}

function renderPagination(total) {
    var pages = Math.ceil(total / _perPage);
    if (pages <= 1) { document.getElementById('pagination').innerHTML = ''; return; }
    var html = '';
    for (var p = 0; p < pages; p++) {
        html += '<button class="j-btn' + (p === _page ? '' : '--dim') + ' j-btn" onclick="goPage(' + p + ')">' + (p + 1) + '</button>';
    }
    document.getElementById('pagination').innerHTML = html;
}

function goPage(p) { _page = p; renderTable(_filtered); }

// ── Chart (Canvas) ──
function renderChart(trades) {
    var canvas = document.getElementById('pnlChart');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var w = canvas.parentElement.clientWidth - 32;
    var h = 170;
    canvas.width = w * (window.devicePixelRatio || 1);
    canvas.height = h * (window.devicePixelRatio || 1);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

    if (!trades.length) {
        ctx.fillStyle = '#3a5068';
        ctx.font = '12px Share Tech Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('No data', w / 2, h / 2);
        return;
    }

    // Build cumulative PnL (chronological = reversed since trades are newest-first)
    var sorted = trades.slice().reverse();
    var cumPnl = [];
    var running = 0;
    for (var i = 0; i < sorted.length; i++) {
        running += sorted[i].pnl;
        cumPnl.push(running);
    }

    var maxY = Math.max.apply(null, cumPnl);
    var minY = Math.min.apply(null, cumPnl);
    var range = maxY - minY || 1;
    var padY = range * 0.1;
    minY -= padY; maxY += padY; range = maxY - minY;

    var stepX = (w - 60) / Math.max(cumPnl.length - 1, 1);
    var oX = 50, oY = 10;

    ctx.clearRect(0, 0, w, h);

    // Zero line
    var zeroY = oY + (h - 20) * (1 - (0 - minY) / range);
    ctx.strokeStyle = '#1e2530';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(oX, zeroY); ctx.lineTo(w, zeroY); ctx.stroke();
    ctx.setLineDash([]);

    // Y axis labels
    ctx.fillStyle = '#3a5068';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('$' + maxY.toFixed(0), oX - 6, oY + 10);
    ctx.fillText('$' + minY.toFixed(0), oX - 6, h - 10);
    ctx.fillText('$0', oX - 6, zeroY + 4);

    // PnL line
    ctx.strokeStyle = running >= 0 ? '#00d97a' : '#ff3355';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var j = 0; j < cumPnl.length; j++) {
        var x = oX + j * stepX;
        var y = oY + (h - 20) * (1 - (cumPnl[j] - minY) / range);
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Gradient fill
    var lastX = oX + (cumPnl.length - 1) * stepX;
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    if (running >= 0) {
        grad.addColorStop(0, 'rgba(0, 217, 122, 0.15)');
        grad.addColorStop(1, 'rgba(0, 217, 122, 0)');
    } else {
        grad.addColorStop(0, 'rgba(255, 51, 85, 0)');
        grad.addColorStop(1, 'rgba(255, 51, 85, 0.15)');
    }
    ctx.lineTo(lastX, zeroY);
    ctx.lineTo(oX, zeroY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Trade count label
    ctx.fillStyle = '#3a5068';
    ctx.textAlign = 'center';
    ctx.fillText(cumPnl.length + ' trades', w / 2, h - 2);
}

// ── CSV Export ──
function exportCSV() {
    if (!_filtered.length) return;
    var headers = ['#', 'Date', 'Symbol', 'Side', 'Mode', 'Entry', 'Exit', 'Size', 'Leverage', 'PnL', 'Exit Reason', 'Hold Time', 'SL', 'TP'];
    var rows = _filtered.map(function (t, i) {
        return [
            i + 1,
            _fmtDateFull(t.openTs),
            (t.symbol || '').replace('USDT', ''),
            t.side,
            (t.mode || 'demo').toUpperCase(),
            t.entryPrice,
            t.exitPrice || '',
            t.size,
            t.leverage,
            t.pnl.toFixed(2),
            t.exitReason,
            _msToStr(t.holdMs),
            t.sl,
            t.tp,
        ].join(',');
    });
    var csv = headers.join(',') + '\n' + rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'zeus-journal-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
}

// ── Helpers ──
function _setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
}
function _setColor(id, positive) {
    var el = document.getElementById(id);
    if (!el) return;
    el.className = 'j-stat-value ' + (positive ? 'pos' : 'neg');
}
function _fmtPnl(v) {
    if (v == null || isNaN(v)) return '—';
    var n = +v;
    return (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2);
}
function _fmtPrice(v) {
    if (v == null || isNaN(v)) return '—';
    var n = +v;
    if (n >= 1000) return n.toFixed(0);
    if (n >= 1) return n.toFixed(2);
    return n.toFixed(4);
}
function _fmtNum(v) {
    if (v == null || isNaN(v)) return '0';
    return (+v).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
function _fmtDate(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
        d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function _fmtDateFull(ts) {
    if (!ts) return '';
    return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}
function _fmtReason(r) {
    if (!r) return '—';
    return r.replace(/_/g, ' ').replace(/^(HIT|DSL) /i, function (m) { return m; });
}
function _msToStr(ms) {
    if (!ms || ms <= 0) return '—';
    if (ms < 60000) return Math.round(ms / 1000) + 's';
    if (ms < 3600000) return Math.round(ms / 60000) + 'm';
    if (ms < 86400000) return (ms / 3600000).toFixed(1) + 'h';
    return (ms / 86400000).toFixed(1) + 'd';
}
function showEmpty() {
    document.getElementById('tableBody').innerHTML = '';
    document.getElementById('emptyState').style.display = 'block';
}

// ═══ Trade Annotations ═══
var _annSeq = null;

function _openAnnotation(seq) {
    _annSeq = seq;
    var ann = _annotations[seq] || { notes: '', tags: [], rating: 0 };
    var overlay = document.getElementById('annOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'annOverlay';
        overlay.className = 'ann-overlay';
        overlay.innerHTML =
            '<div class="ann-panel">' +
            '<div class="ann-hdr"><span>TRADE NOTES</span><span class="ann-seq" id="annSeqLabel"></span><button class="ann-close" onclick="_closeAnnotation()">&times;</button></div>' +
            '<div class="ann-body">' +
            '<div class="ann-field"><label>Rating</label><div id="annStars" class="ann-stars"></div></div>' +
            '<div class="ann-field"><label>Tags</label><input id="annTags" type="text" placeholder="scalp, setup-A, mistake..." class="ann-input"></div>' +
            '<div class="ann-field"><label>Notes</label><textarea id="annNotes" rows="4" placeholder="What happened? What did you learn?" class="ann-input ann-textarea"></textarea></div>' +
            '<button class="ann-save" onclick="_saveAnnotation()">SAVE</button>' +
            '</div></div>';
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
    document.getElementById('annSeqLabel').textContent = '#' + seq;
    document.getElementById('annNotes').value = ann.notes || '';
    document.getElementById('annTags').value = (ann.tags || []).join(', ');
    _renderStars(ann.rating || 0);
}

function _closeAnnotation() {
    var overlay = document.getElementById('annOverlay');
    if (overlay) overlay.style.display = 'none';
    _annSeq = null;
}

function _renderStars(rating) {
    var el = document.getElementById('annStars');
    if (!el) return;
    var html = '';
    for (var i = 1; i <= 5; i++) {
        html += '<span class="ann-star' + (i <= rating ? ' ann-star-on' : '') + '" onclick="_setRating(' + i + ')">' + (i <= rating ? '★' : '☆') + '</span>';
    }
    el.innerHTML = html;
    el.dataset.rating = rating;
}

function _setRating(r) {
    var current = parseInt(document.getElementById('annStars').dataset.rating || '0', 10);
    _renderStars(r === current ? 0 : r);
}

function _saveAnnotation() {
    if (!_annSeq) return;
    var notes = document.getElementById('annNotes').value.trim();
    var tagsRaw = document.getElementById('annTags').value;
    var tags = tagsRaw.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    var rating = parseInt(document.getElementById('annStars').dataset.rating || '0', 10);

    fetch('/api/journal/' + _annSeq + '/annotate', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ notes: notes, tags: tags, rating: rating })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.ok) {
            _annotations[_annSeq] = { notes: notes, tags: tags, rating: rating };
            _closeAnnotation();
            renderTable(_filtered);
        } else {
            alert('Save failed: ' + (data.error || 'unknown'));
        }
    })
    .catch(function(err) { alert('Save error: ' + err.message); });
}
