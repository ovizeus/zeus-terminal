const path='/opt/zeus-terminal/server/services';
for (const m of ['logger','audit']) {
  const p=require.resolve(path+'/'+m);
  require.cache[p]={id:p,filename:p,loaded:true,exports:new Proxy({},{get:()=>()=>{}})};
}
const dsl=require(path+'/serverDSL');
const { buildGeomRows }=require(path+'/dslGeomShadow');
const meta={ side:'LONG', entry:100, originalSL:97.5 };
// urma care URCA apoi se RETRAGE 1,2% — ar trebui sa prinda urmaririle strânse, nu pe cele largi
const up=[]; for(let p=100;p<=103;p+=0.05) up.push(+p.toFixed(4));
const down=[]; for(let p=103;p>=101.7;p-=0.05) down.push(+p.toFixed(4));
const prices=[...up,...down];
console.log('urma: urca 100->103 (+3%), apoi retrage la 101,7 (-1,26% din varf),',prices.length,'eşantioane\n');
const rows=buildGeomRows({ presets: dsl.DSL_PRESETS, meta, prices, realizedPnlPct: 1.7, simulate: dsl.simulate });
for (const r of rows) {
  const p=dsl.DSL_PRESETS[r.arm];
  console.log(`  ${r.arm.padEnd(6)} open=${p.openDslPct} PL=${p.pivotLeftPct}  ->  simulat ${r.simPnlPct.toFixed(4)}%  avantaj ${r.advantage.toFixed(4)}`);
}
const uniq=new Set(rows.map(r=>r.simPnlPct.toFixed(6)));
console.log(`\nrezultate DISTINCTE: ${uniq.size} din ${rows.length}`);
console.log(uniq.size>1 ? '=> presetele SE DIFERENTIAZA: masuratoarea poate masura.'
                        : '=> toate identice: masuratoarea NU poate distinge geometriile — DEFECT.');
