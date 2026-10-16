import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {dependency,browserPath,root,out,settings} from './runtime.mjs';
const {chromium}=dependency('playwright'),sharp=dependency('sharp');
const browser=await chromium.launch({executablePath:browserPath(),headless:true,args:['--mute-audio']});
const results=[];
try{
 for(const target of [`http://127.0.0.1:${settings.port}/`,pathToFileURL(path.join(out,'智能的形状_离线播放器.html')).href]){
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],remote=[],cancelledMediaRanges=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>{
   // Seeking may cancel the old HTTP audio range. This is expected only if
   // the new range decodes and playback resumes, which is checked below.
   if(r.url().endsWith('/out/score.m4a')&&r.failure()?.errorText==='net::ERR_ABORTED')cancelledMediaRanges.push(r.url());
   else errors.push(r.url()+': '+r.failure()?.errorText);
  });
  page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(`http://127.0.0.1:${settings.port}/`))remote.push(r.url())});
  await page.goto(target,{waitUntil:'load'});await page.waitForFunction(()=>window.__ready===true);
  await page.click('#go');await page.waitForFunction(()=>document.getElementById('audio').currentTime>.7);
  const started=await page.evaluate(()=>({time:document.getElementById('audio').currentTime,paused:document.getElementById('audio').paused}));
  await page.click('#toggle');const pausedAt=await page.evaluate(()=>document.getElementById('audio').currentTime);
  await page.waitForTimeout(350);const pausedAfter=await page.evaluate(()=>document.getElementById('audio').currentTime);
  await page.evaluate(()=>{const s=document.getElementById('seek');s.value='175.25';s.dispatchEvent(new Event('input',{bubbles:true}))});
  await page.waitForFunction(()=>Math.abs(document.getElementById('audio').currentTime-175.25)<.05&&document.getElementById('audio').readyState>=2);
  await page.click('#toggle');await page.waitForFunction(()=>document.getElementById('audio').currentTime>175.6);await page.click('#toggle');
  const info=await page.evaluate(()=>({fonts:document.fonts.status,ready:window.__ready,seconds:document.getElementById('audio').duration,scene:window.__render(175.25).scene,gpu:window.__gpu,mediaError:document.getElementById('audio').error?.message||null,resumedAfterSeek:document.getElementById('audio').currentTime>175.6}));
  const png=await page.evaluate(()=>{window.__render(20);return document.getElementById('screen').toDataURL('image/png').split(',')[1]});
  const raw=await sharp(Buffer.from(png,'base64')).removeAlpha().raw().toBuffer();
  const result={target,started,pausedAt,pausedAfter,seek:175.25,...info,pageErrors:errors,cancelledMediaRanges,remoteRequests:remote,passed:!started.paused&&Math.abs(pausedAt-pausedAfter)<.05&&info.scene===7&&Math.abs(info.seconds-240)<.1&&info.resumedAfterSeek&&!info.mediaError&&errors.length===0&&remote.length===0};
  results.push({...result,raw});await page.close();
 }
 let sum=0;for(let i=0;i<results[0].raw.length;i++)sum+=Math.abs(results[0].raw[i]-results[1].raw[i]);const diff=sum/results[0].raw.length;
 const report={passed:results.every(r=>r.passed)&&diff<.01,offlineToSourceMeanPixelDifference:diff,players:results.map(({raw,...r})=>r)};
 fs.writeFileSync(path.join(out,'player-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}finally{await browser.close()}
