// Original low-frequency atmosphere. All motion is a function of absolute time.
export function atmosphere(){
 const c=document.createElement('canvas');c.width=960;c.height=540;
 const gl=c.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
 if(!gl)return {draw:()=>null,gpu:'Canvas fallback'};
 const vs=`attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
 const fs=`precision highp float;uniform float time;uniform vec3 tint;uniform vec2 res;
 float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
 float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1)),f.x),f.y);}
 float fb(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p=mat2(1.64,1.18,-1.18,1.64)*p+3.7;a*=.5;}return v;}
 void main(){vec2 uv=gl_FragCoord.xy/res, p=(uv-.5)*vec2(1.78,1.);float t=time*.018;vec2 q=vec2(fb(p*2.+t),fb(p*2.+vec2(6.3,4.5)-t));float v=fb(p*2.5+q*2.5);float ribbons=pow(.5+.5*sin(p.x*5.+p.y*2.+v*8.-t),7.);float a=exp(-dot(p-vec2(.25,.02),p-vec2(.25,.02))*2.);vec3 col=vec3(.017,.028,.05)+tint*(.065*v+.052*ribbons)*a;col*=.60+.40*pow(16.*uv.x*uv.y*(1.-uv.x)*(1.-uv.y),.4);col+=(h(gl_FragCoord.xy+floor(time*24.))-.5)*.006;gl_FragColor=vec4(col,1.);}`;
 const comp=(type,s)=>{const sh=gl.createShader(type);gl.shaderSource(sh,s);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(sh));return sh};
 const p=gl.createProgram();gl.attachShader(p,comp(gl.VERTEX_SHADER,vs));gl.attachShader(p,comp(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
 const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
 const u={time:gl.getUniformLocation(p,'time'),tint:gl.getUniformLocation(p,'tint'),res:gl.getUniformLocation(p,'res')};gl.uniform2f(u.res,960,540);
 const d=gl.getExtension('WEBGL_debug_renderer_info');
 return {gpu:d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):'WebGL',draw(t,tint){gl.uniform1f(u.time,t);gl.uniform3fv(u.tint,tint);gl.drawArrays(gl.TRIANGLES,0,3);return c}};
}
