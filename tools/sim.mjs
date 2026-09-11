const lat=20.998, lon=105.859;
function label(p){const h=[p.housenumber,p.street].filter(Boolean).join(' ')||p.name;return [h,p.district,p.city||p.county,p.state].filter(Boolean).join(', ');}
async function ps(q){const u=`https://photon.komoot.io/api/?lang=default&limit=8&lat=${lat}&lon=${lon}&q=${encodeURIComponent(q)}`;const j=await(await fetch(u)).json();return (j.features||[]).filter(f=>f.geometry&&f.properties&&f.properties.countrycode==='VN').map(f=>({lat:f.geometry.coordinates[1],lng:f.geometry.coordinates[0],name:label(f.properties||{})}));}
const [a,b]=await Promise.all([ps('8 tháng 3'), ps('8-3')]);
const seen=new Set(),out=[];const mx=Math.max(a.length,b.length);
for(let i=0;i<mx&&out.length<10;i++){for(const l of [a,b]){const it=l[i];if(!it)continue;const k=it.name;if(seen.has(k))continue;seen.add(k);out.push(it);if(out.length>=10)break;}}
console.log('KET QUA (chi VN):');out.forEach((x,i)=>console.log(` ${i+1}.`,x.name));
