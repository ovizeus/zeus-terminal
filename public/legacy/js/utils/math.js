// Zeus v122 — utils/math.js
// Math utility functions
'use strict';

function _clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

// clamp variants for fusion
function _clampFB01(x){ x=+x; return !Number.isFinite(x)?0:Math.max(0,Math.min(1,x)); }
function _clampFB(x,a,b){ x=+x; return !Number.isFinite(x)?a:Math.max(a,Math.min(b,x)); }

// RSI calculation
function calcRSIArr(prices, p){
  p = p || 14;
  var out = new Array(prices.length).fill(null);
  if(prices.length < p+1) return out;
  var g=0, l=0;
  for(var i=1;i<=p;i++){var d=prices[i]-prices[i-1];if(d>0)g+=d;else l+=Math.abs(d);}
  var ag=g/p, al=l/p;
  out[p] = al===0?100:100-(100/(1+(ag/al)));
  for(var i=p+1;i<prices.length;i++){
    var d=prices[i]-prices[i-1];
    if(d>0){ag=(ag*(p-1)+d)/p;al=al*(p-1)/p;}
    else{ag=ag*(p-1)/p;al=(al*(p-1)+Math.abs(d))/p;}
    out[i]=al===0?100:100-(100/(1+(ag/al)));
  }
  return out;
}
