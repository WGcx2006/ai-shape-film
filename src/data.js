export function rng(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
export function trainDemo(){
 const r=rng(68271),H=10;
 const make=(n)=>Array.from({length:n},(_,i)=>{const c=i%2,a=r()*Math.PI;return{x:(c?1-Math.cos(a):Math.cos(a))-.5+(r()-.5)*.17,y:(c?.45-Math.sin(a):Math.sin(a))-.25+(r()-.5)*.17,c}});
 const train=make(72),test=make(36),w=Array.from({length:H},()=>[(r()-.5)*2,(r()-.5)*2,(r()-.5)*.3,(r()-.5)]);let bias=0;
 const sigmoid=x=>1/(1+Math.exp(-Math.max(-25,Math.min(25,x))));
 function predict(p,ww=w,bb=bias){let z=bb;for(let j=0;j<H;j++)z+=ww[j][3]*Math.tanh(ww[j][0]*p.x+ww[j][1]*p.y+ww[j][2]);return sigmoid(z)}
 const states=[];
 for(let k=0;k<=1800;k++){
  if(k%20===0){let loss=0;for(const p of train){const q=predict(p);loss-=p.c*Math.log(q+1e-8)+(1-p.c)*Math.log(1-q+1e-8)}states.push({epoch:k,w:w.map(a=>[...a]),bias,loss:loss/train.length,accuracy:test.filter(p=>(predict(p)>.5)==p.c).length/test.length})}
  const dw=Array.from({length:H},()=>[0,0,0,0]);let db=0;
  for(const p of train){const a=w.map(v=>Math.tanh(v[0]*p.x+v[1]*p.y+v[2])),e=predict(p)-p.c;db+=e;for(let j=0;j<H;j++){const d=e*w[j][3]*(1-a[j]*a[j]);dw[j][0]+=d*p.x;dw[j][1]+=d*p.y;dw[j][2]+=d;dw[j][3]+=e*a[j]}}
  const lr=.24/train.length;bias-=lr*db;for(let j=0;j<H;j++)for(let i=0;i<4;i++)w[j][i]-=lr*dw[j][i];
 }
 return{train,test,states,predict};
}
export function surface(x,z){return .13*(x*x+z*z)+.42*Math.sin(x*1.2)*Math.sin(z*1.1)+.09*x}
export function gradient(x,z){return[.26*x+.504*Math.cos(x*1.2)*Math.sin(z*1.1)+.09,.26*z+.462*Math.sin(x*1.2)*Math.cos(z*1.1)]}
export const descent=(()=>{const p=[];let x=3.4,z=2.9;for(let i=0;i<80;i++){p.push([x,surface(x,z),z]);const g=gradient(x,z);x-=.15*g[0];z-=.15*g[1]}return p})();
