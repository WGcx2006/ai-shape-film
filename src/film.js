import {atmosphere} from './atmosphere.js';
import {rng,trainDemo,surface,gradient,descent} from './data.js';

// The entire film is evaluated from an absolute time. Seeking and export share
// this renderer; no random or accumulated animation state is used per frame.
const canvas=document.getElementById('screen'),c=canvas.getContext('2d',{alpha:false});
const W=1920,H=1080,TAU=Math.PI*2,PI=Math.PI;
const C={white:'#f6f1e6',gold:'#e9bd72',cyan:'#73dcdf',blue:'#839ef5',coral:'#ee8b73',dim:'#8da4b7',deep:'#07101c',ink:'#142737'};
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x)),mix=(a,b,t)=>a+(b-a)*t;
const ease=x=>{x=clamp(x);return x*x*(3-2*x)},ramp=(a,b,t)=>ease((t-a)/(b-a));
const windowAt=(t,a,b,d=.5)=>ramp(a,a+d,t)*(1-ramp(b-d,b,t));
const rand=rng(9137),stars=Array.from({length:230},()=>[rand()*W,rand()*H,rand(),rand()*TAU]);
const atmos=atmosphere();let boxes=[],captions=[];
const scenes=[
 {start:0,end:16,name:'序 · 一个问题',en:'A QUESTION',color:C.gold},
 {start:16,end:24,name:'智能的形状',en:'THE SHAPE OF INTELLIGENCE',color:C.gold},
 {start:24,end:52,name:'从样本中学习',en:'LEARNING FROM EXAMPLES',color:C.cyan},
 {start:52,end:80,name:'沿误差的坡度',en:'THE GEOMETRY OF LEARNING',color:C.gold},
 {start:80,end:104,name:'语言的坐标',en:'A SPACE FOR MEANING',color:C.blue},
 {start:104,end:136,name:'让上下文相遇',en:'ATTENTION IS CONNECTION',color:C.cyan},
 {start:136,end:164,name:'下一个，是什么',en:'ONE TOKEN AT A TIME',color:C.gold},
 {start:164,end:192,name:'从噪声中成形',en:'ORDER FROM NOISE',color:C.blue},
 {start:192,end:220,name:'流畅之后，求真',en:'BEYOND A FLUENT ANSWER',color:C.coral},
 {start:220,end:240,name:'理解，才能用好',en:'UNDERSTANDING OPENS POSSIBILITIES',color:C.gold},
];
const glowCache=new Map();
function glow(x,y,r,col=C.cyan,a=1){if(a<=0)return;let im=glowCache.get(col);if(!im){im=document.createElement('canvas');im.width=im.height=128;const q=im.getContext('2d'),g=q.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,col);g.addColorStop(.08,col+'ee');g.addColorStop(.30,col+'44');g.addColorStop(1,col+'00');q.fillStyle=g;q.fillRect(0,0,128,128);glowCache.set(col,im)}c.save();c.globalAlpha*=a;c.globalCompositeOperation='lighter';c.drawImage(im,x-r,y-r,r*2,r*2);c.restore()}
function text(s,x,y,size=40,col=C.white,o={}){if((o.a??1)<=0)return;c.save();c.globalAlpha*=o.a??1;c.font=`${o.weight||400} ${size}px ${o.mono?'Code':'Film'},sans-serif`;c.textAlign=o.align||'center';c.textBaseline='middle';c.fillStyle=col;if(o.glow){c.shadowColor=col;c.shadowBlur=o.glow}c.fillText(s,x,y);const m=c.measureText(s);if(o.track!==false&&c.globalAlpha>.08)boxes.push({text:s,x:x-(c.textAlign==='center'?m.width/2:c.textAlign==='right'?m.width:0),y:y-size*.63,w:m.width,h:size*1.26,opacity:c.globalAlpha});c.restore()}
function line(points,col=C.cyan,w=1,a=1){if(a<=0||points.length<2)return;c.save();c.globalAlpha*=a;c.strokeStyle=col;c.lineWidth=w;c.beginPath();points.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));c.stroke();c.restore()}
function circle(x,y,r,col,w=1,a=1,fill=false){if(r<=0||a<=0)return;c.save();c.globalAlpha*=a;c.beginPath();c.arc(x,y,r,0,TAU);c[fill?'fillStyle':'strokeStyle']=col;fill?c.fill():((c.lineWidth=w),c.stroke());c.restore()}
function round(x,y,w,h,r=12,fill='#0d1b2b',stroke=null,a=1){c.save();c.globalAlpha*=a;c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill()}if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke()}c.restore()}
function bez(a,b,height,col,alpha=1,w=1){c.save();c.globalAlpha*=alpha;c.strokeStyle=col;c.lineWidth=w;c.beginPath();c.moveTo(a[0],a[1]);c.bezierCurveTo(a[0],a[1]-height,b[0],b[1]-height,b[0],b[1]);c.stroke();c.restore()}
function arrow(a,b,col,w=2,alpha=1){line([a,b],col,w,alpha);const v=Math.atan2(b[1]-a[1],b[0]-a[0]);line([[b[0]-12*Math.cos(v-.45),b[1]-12*Math.sin(v-.45)],b,[b[0]-12*Math.cos(v+.45),b[1]-12*Math.sin(v+.45)]],col,w,alpha)}
function label(s,x,y,col=C.dim,size=20){text(s,x,y,size,col,{mono:/^[\x00-\x7f]+$/.test(s),align:'left'})}
function projection(x,y,z,cx,cy,scale,yaw=.2,pitch=.3){const xx=x*Math.cos(yaw)+z*Math.sin(yaw),zz=-x*Math.sin(yaw)+z*Math.cos(yaw),yy=y*Math.cos(pitch)-zz*Math.sin(pitch),depth=y*Math.sin(pitch)+zz*Math.cos(pitch),k=5/(5+depth);return[cx+xx*scale*k,cy+yy*scale*k,k,depth]}
function backdrop(t,accent){const tint=accent===C.coral?[.85,.28,.20]:accent===C.gold?[.45,.55,.60]:accent===C.blue?[.35,.40,1]:[.1,.8,.85];const bg=atmos.draw(t,tint);if(bg)c.drawImage(bg,0,0,W,H);else{c.fillStyle='#07101c';c.fillRect(0,0,W,H)}
 for(const[x,y,z,p]of stars){const xx=(x+t*(2+z*4))%W;circle(xx,y+Math.sin(t*.09+p)*9,.6+z*1.5,C.white,1,(.11+.17*z)*(.7+.3*Math.sin(t*.6+p)),true)}
 const g=c.createRadialGradient(W*.5,H*.5,300,W*.5,H*.5,1050);g.addColorStop(0,'#00000000');g.addColorStop(1,'#00050cad');c.fillStyle=g;c.fillRect(0,0,W,H);
}
function grid(x,y,w,h,step=50,col=C.dim,alpha=.12){for(let i=0;i<=w;i+=step)line([[x+i,y],[x+i,y+h]],col,1,alpha);for(let j=0;j<=h;j+=step)line([[x,y+j],[x+w,y+j]],col,1,alpha)}
function chapter(i,t){if(i<2||i===9)return;const sc=scenes[i],a=ramp(0,.8,t);line([[100,95],[140,95]],sc.color,2,a);text(String(i-1).padStart(2,'0'),164,95,23,sc.color,{mono:true,a});text(sc.name,205,92,38,C.white,{align:'left',weight:500,a});text(sc.en,205,135,17,C.dim,{align:'left',mono:true,a});text('THE SHAPE OF INTELLIGENCE',1815,100,15,C.dim,{align:'right',mono:true,a});}
function foot(s,col=C.dim){text(s,1812,865,19,col,{align:'right'})}
// Fibonacci sphere: a recurring motif, with visible connections and moving pulses.
const sphere=Array.from({length:310},(_,i)=>{const y=1-2*(i+.5)/310,r=Math.sqrt(1-y*y),a=i*PI*(3-Math.sqrt(5));return[r*Math.cos(a),y,r*Math.sin(a)]});
const sphereEdges=[];for(let i=0;i<sphere.length;i++)for(let j=i+1;j<sphere.length;j++){const a=sphere[i],b=sphere[j],d=a.reduce((v,x,k)=>v+(x-b[k])**2,0);if(d<.065)sphereEdges.push([i,j])}
function globe(t,x,y,r,build=1,col=C.cyan,morph=0){const p=sphere.map(([xx,yy,zz],i)=>{const a=i/310*TAU*7,rad=.45+.48*Math.sin(i/310*PI);const fx=Math.cos(a)*rad,fy=Math.sin(a)*rad,fz=.2*Math.sin(a*2);return projection(mix(xx,fx,morph),mix(yy,fy,morph),mix(zz,fz,morph),x,y,r,t*.10,.18*Math.sin(t*.11))});const n=Math.floor(p.length*build);
 for(const[a,b]of sphereEdges){if(a>=n||b>=n)continue;line([p[a],p[b]],col,.8,(.10+.18*p[a][2])*build)}
 for(let i=0;i<n;i++){const q=p[i];circle(q[0],q[1],1.2+q[2],col,1,.45+.3*Math.sin(t*1.3+i),true);if(i%19===0)glow(q[0],q[1],15,col,.2)}
 for(let j=0;j<9;j++){const e=sphereEdges[(Math.floor(t*.8)+j*71)%sphereEdges.length],a=p[e[0]],b=p[e[1]],f=(t*.6+j*.137)%1;if(e[0]<n&&e[1]<n)glow(mix(a[0],b[0],f),mix(a[1],b[1],f),22,C.white,.55)}return p;
}
function flower(ctx,x,y,r,t=0,alpha=1){ctx.save();ctx.globalAlpha*=alpha;ctx.translate(x,y);ctx.rotate(t*.04);for(let k=0;k<18;k++){ctx.rotate(TAU/18);const grad=ctx.createLinearGradient(0,0,r,0);grad.addColorStop(0,'#fff3c766');grad.addColorStop(.42,'#e5ba7666');grad.addColorStop(1,'#7cdfe022');ctx.fillStyle=grad;ctx.strokeStyle=k%2?'#eac27b99':'#8cdddf99';ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(0,0);ctx.bezierCurveTo(r*.35,-r*.34,r*.94,-r*.22,r,0);ctx.bezierCurveTo(r*.77,r*.18,r*.25,r*.18,0,0);ctx.fill();ctx.stroke();for(let j=1;j<4;j++){ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(r*.4,r*.10*j,r*(.62+.09*j),0);ctx.strokeStyle='#d8bd7b24';ctx.stroke()}}ctx.restore();}

function intro(t){const grow=ramp(0,6,t);globe(t,1200,475,310*mix(.06,1,grow),grow,C.cyan,ramp(10,16,t)*.6);glow(1200,475,280,C.cyan,.13);const words=['语言','图像','预测'];for(let i=0;i<3;i++){const a=windowAt(t,i*1.6+.3,9,.8);text(words[i],290,330+i*105,64,i===1?C.gold:C.white,{align:'left',a,weight:300})}
 const a=ramp(8.2,10,t);text('机器，如何学会？',960,470,92,C.white,{a,weight:500,glow:12});text('PATTERNS. PREDICTIONS. POSSIBILITIES.',960,595,22,C.gold,{a,mono:true});
 if(t<8){for(let i=0;i<16;i++){const f=(t*.14+i/16)%1,xx=mix(550,1180,f),yy=mix(260+i*30,475,f);line([[xx-18,yy],[xx,yy]],i%3?C.cyan:C.gold,2,.35*grow);glow(xx,yy,13,C.cyan,.4*grow)}}
}
function title(t){const a=ramp(0,1.1,t);flower(c,1320,480,330,t+20,a*.65);globe(t+16,1320,480,290,a,C.gold,.82);text('智能的',360,370,140,C.white,{align:'left',weight:600,a});text('形状',360,540,164,C.gold,{align:'left',weight:600,a});line([[368,665],[902,665]],C.gold,1,.45*a);text('THE SHAPE OF INTELLIGENCE',368,717,27,C.white,{align:'left',mono:true,a});text('一场关于人工智能的视觉旅程',370,786,25,C.dim,{align:'left',a});text('AN ORIGINAL SCIENCE FILM',1420,798,16,C.dim,{mono:true,a});}

// A small genuine neural network is trained once. Frames use stored weights.
const model=trainDemo(),mapCache=new Map();
function decisionMap(index){if(mapCache.has(index))return mapCache.get(index);const s=model.states[index],im=document.createElement('canvas');im.width=150;im.height=105;const q=im.getContext('2d'),image=q.createImageData(150,105);for(let y=0;y<105;y++)for(let x=0;x<150;x++){const p=model.predict({x:(x/149-.5)*3.5,y:(.5-y/104)*2.5},s.w,s.bias),idx=(y*150+x)*4;const boundary=Math.exp(-(((p-.5)*26)**2));image.data[idx]=mix(18,78,p)+boundary*85;image.data[idx+1]=mix(49,41,p)+boundary*90;image.data[idx+2]=mix(65,31,p)+boundary*60;image.data[idx+3]=255}q.putImageData(image,0,0);mapCache.set(index,im);return im}
function learning(t){const k=Math.floor(ramp(6,22,t)*(model.states.length-1)),s=model.states[k],x0=175,y0=240,w=1015,h=580,px=p=>x0+(p.x/3.5+.5)*w,py=p=>y0+(.5-p.y/2.5)*h;
 round(x0-1,y0-1,w+2,h+2,8,'#091521','#253749');c.save();c.globalAlpha*=ramp(3,9,t)*.92;c.drawImage(decisionMap(k),x0,y0,w,h);c.restore();grid(x0,y0,w,h,58,C.cyan,.065);
 for(let i=0;i<model.train.length;i++){const p=model.train[i],a=ramp(i*.035,i*.035+1,t),xx=mix(155+Math.sin(i)*75,px(p),ramp(0,4,t)),yy=mix(500+Math.cos(i)*160,py(p),ramp(0,4,t));circle(xx,yy,5.5,p.c?C.gold:C.cyan,1,a,true);if(i%7===0)glow(xx,yy,21,p.c?C.gold:C.cyan,.25*a)}
 const unseen=ramp(20.5,22,t);for(const p of model.test){const q=model.predict(p,s.w,s.bias),col=p.c?C.gold:C.cyan;circle(px(p),py(p),8,col,2,unseen);if(unseen&&((q>.5)==p.c)){line([[px(p)-3,py(p)],[px(p),py(p)+3],[px(p)+5,py(p)-4]],C.white,1.2,unseen)}}
 text('样本空间',x0+20,205,24,C.white,{align:'left'});text('二维合成数据 · 实际训练演示',x0+w,205,18,C.dim,{align:'right'});
 const layers=[{x:1300,n:2},{x:1480,n:10},{x:1690,n:1}],nodes=layers.map(l=>Array.from({length:l.n},(_,j)=>[l.x,530+(j-(l.n-1)/2)*(l.n===10?38:65)]));
 for(let l=0;l<2;l++)for(let i=0;i<nodes[l].length;i++)for(let j=0;j<nodes[l+1].length;j++){const a=nodes[l][i],b=nodes[l+1][j],weight=l===0?s.w[j][i]:s.w[i][3];line([a,b],weight>0?C.cyan:C.gold,1.2,.14+.30*clamp(Math.abs(weight)/3));const f=(t*.55+i*.21+j*.17)%1;glow(mix(a[0],b[0],f),mix(a[1],b[1],f),11,C.cyan,.35*ramp(4,7,t))}
 for(const layer of nodes)for(const [x,y]of layer){circle(x,y,14,C.cyan,1.2,.65);glow(x,y,34,C.cyan,.23)}
 text('2 → 10 → 1',1498,205,20,C.dim);text('参数在变化',1498,263,29,C.white);text(`STEP ${String(s.epoch).padStart(4,'0')}`,1498,318,23,C.gold,{mono:true});text('训练损失',1498,735,21,C.dim);text(s.loss.toFixed(3),1498,780,42,C.white,{mono:true});
 if(unseen>.1){text('空心点 = 未见测试样本',x0+20,850,20,C.white,{align:'left',a:unseen});text(`测试准确率 ${(s.accuracy*100).toFixed(0)}%`,1498,845,23,C.gold,{a:unseen})}else{text('实心点 = 已标注训练样本',x0+20,850,20,C.dim,{align:'left'})}
}
function terrain(t){const yaw=-.68+t*.014,project=(x,y,z)=>{const xx=x*Math.cos(yaw)+z*Math.sin(yaw),zz=-x*Math.sin(yaw)+z*Math.cos(yaw);return[1180+xx*110,660+((-.78*y+.55)*Math.cos(.57)-zz*Math.sin(.57))*110]},n=28;c.save();c.beginPath();c.rect(550,180,1280,665);c.clip();for(let j=0;j<=n;j++){const z=-3.5+j*7/n,p=[];for(let i=0;i<=n;i++){const x=-3.5+i*7/n;p.push(project(x,surface(x,z),z))}line(p,C.cyan,1,.17+Math.sin(j/n*PI)*.22)}for(let j=0;j<=n;j++){const x=-3.5+j*7/n,p=[];for(let i=0;i<=n;i++){const z=-3.5+i*7/n;p.push(project(x,surface(x,z),z))}line(p,C.blue,1,.20)}
 const f=ramp(7,23,t)*(descent.length-1),idx=Math.floor(f),q=descent[idx],next=descent[Math.min(idx+1,descent.length-1)],v=q.map((a,i)=>mix(a,next[i],f-idx)),point=project(...v);const path=descent.slice(0,idx+1).map(p=>project(...p));path.push(point);line(path,C.gold,3.5,ramp(4,6,t));glow(point[0],point[1],45,C.gold,.8);circle(point[0],point[1],6,C.white,1,1,true);
 if(t>7&&t<15){const g=gradient(v[0],v[2]),up=project(v[0]+g[0]*1.5,surface(v[0]+g[0]*1.5,v[2]+g[1]*1.5),v[2]+g[1]*1.5),down=project(v[0]-g[0]*1.5,surface(v[0]-g[0]*1.5,v[2]-g[1]*1.5),v[2]-g[1]*1.5);arrow(point,up,C.coral,2,.9);arrow(point,down,C.gold,3,.9)}
 c.restore();text('每一步，',165,325,47,C.white,{align:'left',weight:300});text('都在修正。',165,390,47,C.gold,{align:'left',weight:500});text('θ ← θ − η∇L',165,495,44,C.white,{align:'left'});label('参数      步长   梯度',170,554,C.dim,20);
 line([[165,650],[445,650]],C.dim,1,.2);text('当前损失',165,692,20,C.dim,{align:'left'});text((v[1]+.15).toFixed(3),165,746,48,C.white,{align:'left',mono:true});
 const cx=1410,cy=245;round(cx,cy,295,144,9,'#08121cbd','#304252');label('LOSS / STEPS',cx+20,cy+25,C.dim,16);const lossPath=descent.slice(0,idx+1).map((p,i)=>[cx+23+i*3.1,cy+120-(p[1]+.15)*27]);line(lossPath,C.gold,2.2,.9);foot('低维损失地形示意 · 局部下降不保证全局最优');
}
const groups=[{col:C.cyan,name:'生命',words:['猫','狗','鸟','鱼','动物'],center:[-.95,-.20,.2]},{col:C.gold,name:'城市',words:['北京','上海','城市','街道','建筑'],center:[.65,-.55,-.2]},{col:C.blue,name:'自然',words:['星光','月亮','夜空','山川','海洋'],center:[.10,.63,.2]}];
const cloudRng=rng(221);const semanticPoints=Array.from({length:360},(_,i)=>{const g=groups[i%3];return{pos:g.center.map(v=>v+(cloudRng()-.5)*.8),g:i%3,r:cloudRng()}});
function embeddings(t){const a=ramp(7,10,t),yaw=.12+Math.sin(t*.08)*.16;const project=p=>projection(...p,1110,520,350,yaw,.10);
 if(t<7){const p=1-ramp(5,7,t);round(200,355,270,115,10,'#122639',C.cyan,p);text('语言',335,412,55,C.white,{a:p});arrow([495,413],[640,413],C.gold,2,p);for(let i=0;i<8;i++){const v=Math.sin(i*2.3+.7);round(690+i*38,355,24,115,4,'#162a3c',null,p);round(690+i*38,412-Math.max(0,v)*50,24,Math.abs(v)*50+1,2,v>0?C.cyan:C.gold,null,p)}text('[ 0.31, −0.72, … ]',845,515,25,C.dim,{mono:true,a:p})}
 for(const p of semanticPoints){const q=project(p.pos),g=groups[p.g];circle(q[0],q[1],1.5+p.r*2,g.col,1,a*(.3+.45*p.r),true);if(p.r>.94)glow(q[0],q[1],26,g.col,a*.2)}
 for(let j=0;j<3;j++){const g=groups[j];for(let i=0;i<g.words.length;i++){const pos=g.center.map((v,k)=>v+(k===0?Math.cos(i*1.9)*.37:k===1?Math.sin(i*1.9)*.30:0)),q=project(pos);circle(q[0],q[1],5,g.col,1,a,true);glow(q[0],q[1],29,g.col,a*.4);text(g.words[i],q[0],q[1]-26,25,i<2?C.white:g.col,{a})}}
 if(t>7){const p0=project([-.95-.25,-.2+.04,.2]),p1=project([-.95+.3,-.2-.12,.2]);line([p0,p1],C.cyan,2,ramp(7,10,t));const f=(t*.25)%1;glow(mix(p0[0],p1[0],f),mix(p0[1],p1[1],f),30,C.white,.8)}
 const side=ramp(6,8,t);text('意义，',175,365,58,C.white,{align:'left',a:side});text('有了坐标。',175,440,58,C.gold,{align:'left',a:side});text('EMBEDDING',180,540,25,C.dim,{align:'left',mono:true,a:side});for(let j=0;j<3;j++){line([[180,610+j*55],[210,610+j*55]],groups[j].col,3,side);text(groups[j].name,230,610+j*55,23,C.white,{align:'left',a:side})}foot('向量空间艺术示意 · 并非某个模型的实测投影');
}
const tokens=['小猫','跳上','桌子','，','它','望向','窗外'];
function attention(t){const selected=4,xs=tokens.map((_,i)=>260+i*232),y=310;const reveal=ramp(0,2,t);
 for(let i=0;i<tokens.length;i++){const active=i===selected,a=ramp(i*.17,i*.17+.7,t);round(xs[i]-83,y-43,166,86,9,active?'#21454d':'#102335',active?C.cyan:'#2a4152',a);text(tokens[i],xs[i],y,active?43:36,active?C.white:C.dim,{a})}
 const weights=[.48,.10,.18,.04,.20,0,0];for(let i=0;i<=selected;i++){const a=ramp(3+i*.22,4+i*.22,t),height=90+(selected-i)*22;bez([xs[i],y-47],[xs[selected],y-47],height,C.cyan,a*.6,1+weights[i]*5);const f=(t*.38+i*.11)%1;const x=mix(xs[i],xs[selected],f),yy=y-47-height*3*f*(1-f);glow(x,yy,20,C.cyan,a*.55)}
 const mx=300,my=490,cell=43,a=ramp(8,10,t);text('因果注意力',mx+130,my-56,26,C.white,{a});
 for(let row=0;row<7;row++)for(let col=0;col<7;col++){const xx=mx+col*cell,yy=my+row*cell,masked=col>row;let val=masked?0:(row===4?weights[col]:1/(row+1));round(xx,yy,cell-4,cell-4,3,masked?'#0e1721':`rgba(115,220,223,${.12+val*.85})`,row===4&&col<=4?'#73dcdf77':null,a);if(masked){line([[xx+12,yy+12],[xx+24,yy+24]],C.dim,1,a*.25);line([[xx+24,yy+12],[xx+12,yy+24]],C.dim,1,a*.25)}}
 text('键 / 已有上下文',mx+150,my+335,18,C.dim,{a});text('未来位置被遮蔽',mx+505,my+84,23,C.gold,{a});arrow([mx+430,my+105],[mx+250,my+70],C.gold,1.5,a*.6);
 const bx=1100,by=535;round(bx,by,530,235,14,'#0a1825','#2b4758',a);text('加权汇聚',bx+265,by+43,32,C.white,{a});for(let i=0;i<5;i++){const yy=by+92+i*24;round(bx+55,yy,340,8,4,'#172f3e',null,a);round(bx+55,yy,340*weights[i],8,4,i===0?C.gold:C.cyan,null,a);text(tokens[i],bx+27,yy+4,16,C.dim,{align:'right',a})}arrow([850,650],[1060,650],C.cyan,2,a);text('＋ 前馈变换 ＋ 残差连接',1370,825,21,C.dim,{a});foot('权重为教学示意 · 注意力不等同于完整因果解释');
}
function generation(t){const a=ramp(0,1,t);text('夜空中最亮的',185,335,68,C.white,{align:'left',weight:400,a});const choice=ramp(14,17,t);round(698,282,98,110,9,'#21333c',C.gold,a);text(choice>.5?'星':'?',747,337,65,C.gold,{a});text('已有上下文',185,435,24,C.dim,{align:'left',a});
 const candidates=[['星',.52],['光',.26],['点',.14],['其他',.08]];text('下一个词元',1300,263,29,C.white);text('示意概率 · 总和 = 1',1300,311,18,C.dim);
 for(let i=0;i<4;i++){const x=1010+i*164,b=715,height=330*candidates[i][1]/.52,progress=ramp(5+i*.2,9+i*.2,t);round(x,b-330,95,330,7,'#14232f');const col=i===0?C.gold:C.cyan;round(x,b-height*progress,95,height*progress,7,col,null,i===0?.9:.55);text(candidates[i][0],x+47,b+46,29,col);text(`${Math.round(candidates[i][1]*100)}%`,x+47,b-height*progress-30,24,C.white,{mono:true});if(i===0&&t>14){circle(x+47,b-height-72,17,C.gold,2,choice);text('✓',x+47,b-height-72,24,C.gold,{a:choice})}}
 bez([820,345],[1057,365],150,C.gold,.5*ramp(9,12,t),2);for(let i=0;i<4;i++){const f=(t*.3+i*.25)%1;glow(mix(835,1040,f),380-100*Math.sin(f*PI),17,C.gold,.3*ramp(9,12,t))}
 const tail='，照亮了远行的路。',n=Math.floor(ramp(17,25,t)*tail.length);if(n){text('夜空中最亮的星',185,600,40,C.white,{align:'left'});text(tail.slice(0,n),185,668,40,C.gold,{align:'left'});const bw=40*n;line([[185+bw,643],[185+bw,690]],C.gold,2,Math.sin(t*5)>0?.8:.2)}
 text('预测 → 选择 → 加入上下文 → 再预测',185,817,25,C.dim,{align:'left'});foot('词元切分与概率均为机制示意');
}

// The image is an original procedural drawing; noisy tiles illustrate DDPM
// forward/reverse directions. No trained diffusion model is being run here.
const art=document.createElement('canvas');art.width=840;art.height=550;const ac=art.getContext('2d');
{const g=ac.createLinearGradient(0,0,840,550);g.addColorStop(0,'#10283d');g.addColorStop(.5,'#173846');g.addColorStop(1,'#060d20');ac.fillStyle=g;ac.fillRect(0,0,840,550);const ar=rng(971);for(let i=0;i<180;i++){ac.fillStyle=i%4?'#b2dbe855':'#f5dab599';ac.fillRect(ar()*840,ar()*550,1+ar()*2,1+ar()*2)}flower(ac,420,275,215,0,1);const gg=ac.createRadialGradient(420,275,0,420,275,90);gg.addColorStop(0,'#fff0cb');gg.addColorStop(.08,'#edcd8799');gg.addColorStop(1,'#edcd8700');ac.fillStyle=gg;ac.fillRect(310,165,220,220)}
const noiseCanvas=document.createElement('canvas');noiseCanvas.width=168;noiseCanvas.height=110;const nc=noiseCanvas.getContext('2d'),noiseBase=Array.from({length:168*110*3},()=>rand()),small=document.createElement('canvas');small.width=168;small.height=110;const sm=small.getContext('2d');sm.drawImage(art,0,0,168,110);const original=sm.getImageData(0,0,168,110).data,noiseImage=nc.createImageData(168,110);
function noiseFrame(strength,t){for(let i=0;i<168*110;i++){for(let k=0;k<3;k++){const noise=noiseBase[i*3+k]*210+15+Math.sin(t*2+i*.01)*5;noiseImage.data[i*4+k]=mix(original[i*4+k],noise,strength)}noiseImage.data[i*4+3]=255}nc.putImageData(noiseImage,0,0);return noiseCanvas}
function diffusion(t){const forward=t<15,strength=forward?ramp(1,8,t):1-ramp(15,25,t),x=780,y=235,w=840,h=550;round(x-3,y-3,w+6,h+6,12,'#163344',C.blue);c.save();c.imageSmoothingEnabled=strength<.3;c.drawImage(noiseFrame(strength,t),x,y,w,h);if(strength<.28){c.globalAlpha*=(1-strength/.28)*.9;c.drawImage(art,x,y,w,h)}c.restore();
 text(forward?'学习噪声':'逐步去噪',180,310,56,C.white,{align:'left'});text(forward?'图像 → 带噪样本':'随机噪声 → 图像',180,402,30,C.gold,{align:'left'});text('一朵发光的花',180,520,34,C.white,{align:'left'});label('PROCEDURAL IMAGE',183,575,C.dim,18);
 const step=Math.round(strength*1000);text(`t = ${String(step).padStart(4,'0')}`,180,681,38,C.cyan,{align:'left',mono:true});text(forward?'训练方向示意':'生成方向示意',180,741,23,C.dim,{align:'left'});
 const barY=826;line([[800,barY],[1600,barY]],C.dim,3,.3);const dot=800+(1-strength)*800;line([[800,barY],[dot,barY]],C.gold,3,.8);glow(dot,barY,22,C.gold,.7);text('噪声',800,866,18,C.dim);text('结构',1600,866,18,C.gold);text('去噪过程示意 · 非真实模型推理输出',1620,204,18,C.dim,{align:'right'});
}
function reliability(t){const p=ramp(0,2,t),left=170,top=245;round(left,top,720,430,18,'#142030','#415265',p);text('一个听起来很确定的回答',left+45,top+58,29,C.white,{align:'left',a:p});line([[left+45,top+108],[left+675,top+108]],C.dim,1,.3*p);
 const lines=['这项结论来自一篇研究。','数据很完整，推导很漂亮。','所以，它一定是正确的。'];for(let i=0;i<3;i++){text(lines[i],left+45,top+168+i*70,31,i===2?C.coral:C.dim,{align:'left',a:ramp(i*.7+1,i*.7+2,t)})}
 const suspect=ramp(5,7,t);line([[left+45,top+338],[left+515,top+338]],C.coral,3,suspect);glow(left+680,top+340,45,C.coral,suspect*.4);text('?',left+680,top+340,52,C.coral,{a:suspect});text('语气的确定 ≠ 事实的确定',left+360,top+485,30,C.coral,{a:suspect});
 const bx=1120,yy=[330,500,670],names=['来源是否存在','证据是否支持','结果能否复核'],en=['SOURCE','EVIDENCE','VERIFICATION'];for(let i=0;i<3;i++){const a=ramp(10+i*3,11+i*3,t);circle(bx,yy[i],28,C.cyan,1.5,a);text('✓',bx,yy[i],29,C.cyan,{a});text(names[i],bx+65,yy[i]-7,32,C.white,{align:'left',a});text(en[i],bx+66,yy[i]+40,17,C.dim,{align:'left',mono:true,a});if(i)line([[bx,yy[i-1]+40],[bx,yy[i]-40]],C.cyan,1,a*.4)}
 arrow([930,460],[1040,460],C.gold,2,ramp(8,10,t));text('让证据，接住答案。',1120,817,30,C.gold,{align:'left',a:ramp(21,23,t)});
}
function finale(t){const a=ramp(0,2,t),m=ramp(0,13,t);flower(c,1290,490,325,t,a*.65);globe(t+90,1290,490,280,a,C.gold,m);glow(1290,490,230,C.gold,.10);text('从数据',210,355,87,C.white,{align:'left',weight:300,a});text('到创造',210,470,87,C.gold,{align:'left',weight:500,a});text('理解机制，才能用好力量。',215,650,38,C.white,{align:'left',a:ramp(8,11,t)});line([[215,725],[900,725]],C.gold,1,a*.45);text('THE SHAPE OF INTELLIGENCE',215,772,23,C.dim,{align:'left',mono:true,a});text('智能的形状',1290,830,25,C.gold,{a:ramp(13,16,t)});}
const drawScenes=[intro,title,learning,terrain,embeddings,attention,generation,diffusion,reliability,finale];

function subtitle(t){const s=captions.find(s=>t>=s.start&&t<s.end);if(!s)return;const a=windowAt(t,s.start,s.end,.35);const g=c.createLinearGradient(0,886,0,1080);g.addColorStop(0,'#050a1300');g.addColorStop(.35,'#050a13b8');g.addColorStop(1,'#050a13ee');c.fillStyle=g;c.fillRect(0,886,W,194);text(s.zh,960,949,39,C.white,{a,weight:500});text(s.en,960,1004,25,'#bdcbd5',{a});}
function render(T){const t=clamp(T,0,239.99999);boxes=[];let i=scenes.findIndex(s=>t>=s.start&&t<s.end);if(i<0)i=9;const sc=scenes[i],lt=t-sc.start;c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.globalCompositeOperation='source-over';backdrop(t,sc.color);
 c.save();c.globalAlpha=windowAt(lt,0,sc.end-sc.start,.48);drawScenes[i](lt);chapter(i,lt);c.restore();subtitle(t);
 if(t<1.2||t>238.5){c.fillStyle=`rgba(2,6,12,${t<1.2?1-ramp(0,1.2,t):ramp(238.5,240,t)})`;c.fillRect(0,0,W,H)}
 return{scene:i,boxes};
}
window.__render=render;window.__duration=240;window.__ready=false;window.__gpu=atmos.gpu;window.__scenes=scenes;window.__modelReport={trainingSamples:model.train.length,testSamples:model.test.length,initialLoss:model.states[0].loss,finalLoss:model.states.at(-1).loss,testAccuracy:model.states.at(-1).accuracy};
async function boot(){captions=await(await fetch('./src/captions.json')).json();await Promise.all([document.fonts.load('400 40px Film'),document.fonts.load('600 40px Film'),document.fonts.load('400 20px Code')]);await document.fonts.ready;render(0);window.__ready=true;const exportMode=new URLSearchParams(location.search).has('export');if(exportMode){document.body.classList.add('export');return}
 const au=document.getElementById('audio'),go=document.getElementById('go'),toggle=document.getElementById('toggle'),seek=document.getElementById('seek'),tm=document.getElementById('time');let playing=false,raf=0;go.disabled=false;go.textContent='▶ 播放影片';
 const stamp=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
 const frame=()=>{render(au.currentTime);seek.value=au.currentTime;tm.textContent=`${stamp(au.currentTime)} / 4:00`;if(playing)raf=requestAnimationFrame(frame)};
 async function play(){if(au.currentTime>=239.8)au.currentTime=0;try{await au.play();playing=true;toggle.textContent='❚❚';cancelAnimationFrame(raf);frame()}catch(e){document.getElementById('status').textContent='音轨尚未就绪；请在工程生成配乐后重试。';console.error(e)}}
 function pause(){playing=false;au.pause();cancelAnimationFrame(raf);toggle.textContent='▶'}go.onclick=async()=>{document.getElementById('start').style.display='none';await play()};toggle.onclick=()=>playing?pause():play();seek.oninput=()=>{au.currentTime=Number(seek.value);render(au.currentTime);tm.textContent=`${stamp(au.currentTime)} / 4:00`};au.onended=pause;document.getElementById('full').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();document.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();if(document.getElementById('start').style.display!=='none')go.click();else playing?pause():play()}if(e.code==='KeyF')document.getElementById('full').click()});
}
boot().catch(e=>{console.error(e);document.getElementById('status').textContent=e.message});

