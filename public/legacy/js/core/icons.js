/**
 * Zeus Terminal — Global Icon Constants (_ZI)
 *
 * Extracted from public/index.html inline <script> (line 4477)
 * so the legacy bridge can load it as a regular .js file.
 *
 * MUST load BEFORE any other JS module (config.js, deepdive.js, aub.js, bootstrap.js all use _ZI).
 */
var _ZI = (function () {
  var s = '<svg class="z-i" viewBox="0 0 16 16">';
  var se = '</svg>';
  function i(d) { return s + '<path d="' + d + '"/>' + se; }
  function iF(d) { return s + '<path d="' + d + '" fill="currentColor" stroke="none"/>' + se; }
  return {
    // status
    w: i('M8 2L1 14h14L8 2zM8 6v4m0 2h.01'),           // warning triangle
    x: i('M4 4l8 8m0-8l-8 8'),                          // cross / error
    ok: i('M3 8l4 4 6-8'),                                // checkmark
    ld: '<svg class="z-i z-spin" viewBox="0 0 16 16"><path d="M8 2a6 6 0 105.3 3"/></svg>',
    inf: '<svg class="z-i" viewBox="0 0 16 16"><circle cx="8" cy="4" r="1" fill="currentColor" stroke="none"/><path d="M7 7h2v6H7z" fill="currentColor" stroke="none"/></svg>',
    // action
    bolt: i('M9 1L4 9h4l-1 6 5-8H8l1-6'),                 // lightning
    sh: i('M8 1L2 4v4c0 4 3 7 6 8 3-1 6-4 6-8V4L8 1z'), // shield
    lock: i('M5 7V5a3 3 0 016 0v2m-8 0h10v7H3V7z'),       // lock
    unlk: i('M5 7V5a3 3 0 016 0m-8 2h10v7H3V7z'),         // unlock
    skull: i('M5 6h.01M11 6h.01M4 3a5 5 0 018 0c1 2 1 4-1 6H5c-2-2-2-4-1-6M6 12v2m4-2v2'),
    siren: i('M8 1v2m5 2l-1.4 1.4M3 5l1.4 1.4M2 10h2m8 0h2M5 13h6M6 10a2 2 0 014 0'),
    tgt: i('M8 1a7 7 0 100 14A7 7 0 008 1zm0 3a4 4 0 100 8 4 4 0 000-8zm0 3a1 1 0 100 2 1 1 0 000-2z'), // target
    // trading
    chart: i('M3 13V7l3-3 3 4 4-6v11'),                     // chart bars
    tup: i('M3 13l4-6 3 3 4-8m-2 0h2v2'),                 // trend up
    dia: iF('M8 1l6 7-6 7-6-7z'),                         // diamond
    robot: i('M5 5h6v7H5zM8 2v3M3 7h2m6 0h2M6 9h.01M10 9h.01'), // robot
    pad: i('M4 5h8v7H4zM6 3h4v2H6zM6 8v2m4-2v2m-5 3h6'),      // gamepad
    whale: i('M2 8c0-3 3-5 6-5s4 1 5 3c1-1 2 0 2 1s-1 2-3 2H5c-2 0-3-1-3-1'),
    fire: i('M8 1c0 3-3 4-3 7a3 3 0 006 0c0-2-1-3-2-4-1 2-2 4-2 6a5 5 0 0010 0C13 5 8 1 8 1z'),
    drop: i('M8 2L4 9a4 4 0 008 0L8 2z'),                  // droplet
    boom: i('M8 1l2 4 4-1-3 3 4 2-4 1 1 4-4-2-4 2 1-4-4-1 4-2-3-3 4 1z'), // explosion
    // navigation
    scope: i('M11 8A3 3 0 115 8a3 3 0 016 0m-3-5v2m0 6v2M3 8h2m6 0h2'), // telescope/search
    mag: i('M3 4l5-3 5 3v7l-5 3-5-3V4z'),                 // magnet hexagon
    brain: i('M8 2C5 2 4 4 4 5c0 1 .5 2 1 2.5-.5.5-1 1.5-1 2.5 0 2 2 4 4 4s4-2 4-4c0-1-.5-2-1-2.5.5-.5 1-1.5 1-2.5 0-1-1-3-4-3zM8 2v12'),
    crown: i('M2 12h12L12 5l-2 3-2-4-2 4-2-3L2 12z'),      // crown
    hand: i('M8 14c-3 0-5-2-5-5V5l2 1V3l2 1V2l2 1v2l2-1v3c0 3-1 5-3 7'),
    rfsh: i('M2 8a6 6 0 0110-4m4 4a6 6 0 01-10 4M12 2v4h-4M4 14v-4h4'), // refresh
    broom: i('M10 2l4 4-6 6-4-4 6-6zM6 10l-3 4 4-3'),      // cleanup
    // UI
    bell: i('M8 2a4 4 0 00-4 4c0 4-2 5-2 6h12s-2-2-2-6a4 4 0 00-4-4zm-1 12h2'),
    bellX: i('M8 2a4 4 0 00-4 4c0 4-2 5-2 6h12s-2-2-2-6a4 4 0 00-4-4zM4 4l8 8'),
    vol: i('M2 6v4h3l4 4V2L5 6H2zm9-1v6m2-8v10'),        // volume on
    mute: i('M2 6v4h3l4 4V2L5 6H2zm9 0l4 4m-4 0l4-4'),    // mute
    clip: i('M4 2h8v12H4V2zm2 3h4m-4 2h4m-4 2h2'),        // clipboard
    cal: i('M4 2v2m8-2v2M2 6h12M2 4h12v10H2V4z'),        // calendar
    fold: i('M2 4h12M2 4l2-2h8l2 2v10H2V4zm4 3h4m-4 3h2'), // folder
    mail: i('M2 4h12v9H2V4zm0 0l6 5 6-5'),                 // envelope
    cloud: i('M5 14a4 4 0 01-.5-8A5 5 0 0114 8a3 3 0 01-1 6H5z'),
    lbulb: i('M8 1a4 4 0 00-4 4c0 2 1 3 2 4h4c1-1 2-2 2-4a4 4 0 00-4-4zM6 11h4v2H6z'),
    money: i('M8 2v12M5 4c0-1 1-2 3-2s3 1 3 2-1 2-3 2m0 0c-2 0-3 1-3 2s1 2 3 2 3-1 3-2'),
    pen: i('M11 2l3 3-8 8H3v-3l8-8z'),                    // pencil
    trash: i('M5 3V2h6v1m-8 0h10M4 3v10h8V3'),
    dl: i('M8 2v8m-3-3l3 3 3-3M3 13h10'),               // download arrow
    plug: i('M6 2v4m4-4v4M4 6h8v3a4 4 0 01-8 0V6zm4 7v3'), // plug
    // shapes
    pause: i('M5 3v10m6-10v10'),
    stop: i('M3 3h10v10H3z'),
    clock: i('M8 2a6 6 0 100 12A6 6 0 008 2zm0 3v3l2 2'),
    timer: i('M8 1v2m0 0a5 5 0 100 10A5 5 0 008 3zm0 2v3l2 1'),
    play: i('M4 2l10 6-10 6V2z'),
    spider: i('M8 3a2 2 0 100 4 2 2 0 000-4zM5 5L2 3m3 4L1 8m4 1l-3 3m10-9l3-2m-3 4l4 1m-4 1l3 3'), // spider
    wave: i('M1 8c1-2 3-2 4 0s3 2 4 0 3-2 4 0 3 2 4 0'),  // waves
    noent: i('M8 2a6 6 0 100 12A6 6 0 008 2zM4 8h8'),       // no-entry circle
    moon: i('M10 2a6 6 0 100 12A6 6 0 0010 2z'),           // sleep/quiet
    eye: i('M2 8s3-5 6-5 6 5 6 5-3 5-6 5-6-5zm4 0a2 2 0 104 0 2 2 0 00-4 0'), // eye/scope
    ruler: i('M3 3h10v10H3V3zm2 2v2m3-2v3m3-3v2'),          // ruler/ATR
    hex: iF('M8 1l6 3.5v7L8 15l-6-3.5v-7L8 1z'),          // hexagon (DSL/brain)
    // dots (filled circles)
    dRed: '<span class="z-dot z-dot--red"></span>',
    dGrn: '<span class="z-dot z-dot--grn"></span>',
    dYlw: '<span class="z-dot z-dot--ylw"></span>',
    dPur: '<span class="z-dot z-dot--pur"></span>'
  };
})();
