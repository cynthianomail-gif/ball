import { buildTrack, STEP } from '../src/track.js';
const t = buildTrack();
let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9,minY=1e9,maxY=-1e9;
for (const p of t.P){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
console.log('N',t.N,'len',t.total.toFixed(0),'x',minX.toFixed(0),maxX.toFixed(0),'z',minZ.toFixed(0),maxZ.toFixed(0),'y',minY.toFixed(1),maxY.toFixed(1));
// crossings
let worst=1e9, where=null;
for (let i=0;i<t.N;i+=4) for (let j=i+80;j<t.N;j+=4){
  const a=t.P[i], b=t.P[j];
  const d=Math.hypot(a.x-b.x,a.z-b.z);
  if (d < t.half[i]+t.half[j]+3){ const dy=Math.abs(a.y-b.y); if(dy<worst){worst=dy;where=[i*STEP,j*STEP,d.toFixed(1)];}}
}
console.log('min vertical clearance at crossing', worst.toFixed(1), where);
console.log('checkpoints', t.checkpoints.map(i=>(i*STEP).toFixed(0)), 'gaps', t.gaps.map(g=>g.map(i=>i*STEP)), 'sweepers', t.sweepers.map(s=>s.i*STEP), 'obst', t.obstacles.length);
