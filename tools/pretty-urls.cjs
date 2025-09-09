'use strict';
/**
 * tools/pretty-urls.cjs
 * Sitewide switch to pretty URLs for ADUPlanet.
 * - Rewrites internal links *.html -> pretty
 * - Fixes canonical / og:url / twitter:url per page
 * - Updates JSON-LD @id/url/Breadcrumb item values
 * - Converts sitemap <loc> entries to pretty URLs
 * Skips: /assets, /functions, node_modules, .git
 */
const fs = require('fs').promises;
const path = require('path');
const ROOT = process.cwd();
const SITE = 'https://aduplanet.com';
const EXCLUDE = new Set(['assets', 'functions', 'node_modules', '.git', 'partials']);

async function walk(dir){const out=[];const entries=await fs.readdir(dir,{withFileTypes:true});
  for(const e of entries){ if(EXCLUDE.has(e.name)) continue;
    const p=path.join(dir,e.name);
    if(e.isDirectory()) out.push(...(await walk(p)));
    else if(e.isFile()){const low=e.name.toLowerCase(); if(low.endsWith('.html')||low==='sitemap.xml') out.push(p);}
  } return out; }

function toWebPath(fsPath){const rel=fsPath.replace(ROOT+path.sep,'').split(path.sep).join('/');return rel.startsWith('/')?rel:'/'+rel;}
function prettyFromFile(fsPath){const web=toWebPath(fsPath);
  if(!/\.html$/i.test(web)) return web;
  if(/\/index\.html$/i.test(web)){const base=web.slice(0,-('/index.html'.length)); return base===''?'/':base+'/';}
  return web.replace(/\.html$/i,'');}

function splitURL(u){const m=String(u).match(/^([^?#]*)(\?[^#]*)?(#.*)?$/); return {path:m[1]||'',query:m[2]||'',hash:m[3]||''};}
function prettifyPath(p){if(/\/index\.html$/i.test(p)) return p.replace(/\/index\.html$/i,'/'); if(/\.html$/i.test(p)) return p.replace(/\.html$/i,''); return p;}
function prettifyHref(href){
  const s=href.trim();
  if(!s||s.startsWith('#')||s.startsWith('mailto:')||s.startsWith('tel:')) return href;
  if(s.toLowerCase().startsWith(SITE)){const after=s.slice(SITE.length);const parts=splitURL(after); return SITE+prettifyPath(parts.path)+parts.query+parts.hash;}
  if(s.startsWith('/')){const parts=splitURL(s); return prettifyPath(parts.path)+parts.query+parts.hash;}
  return href;
}

function replaceCanonicals(html,filePretty){
  const full=SITE+filePretty;
  const hadCanon=/<link\s+rel=["']canonical["']\s+href=/i.test(html);
  const hadOg=/<meta\s+property=["']og:url["']/i.test(html);
  const hadTw=/<meta\s+name=["']twitter:url["']/i.test(html);
  html=html.replace(/<link\s+rel=["']canonical["']\s+href=["'][^"']+["']\s*\/?>/i, `<link rel="canonical" href="${full}" />`);
  html=html.replace(/<meta\s+property=["']og:url["']\s+content=["'][^"']+["']\s*\/?>/i, `<meta property="og:url" content="${full}" />`);
  html=html.replace(/<meta\s+name=["']twitter:url["']\s+content=["'][^"']+["']\s*\/?>/i, `<meta name="twitter:url" content="${full}" />`);
  return html.replace(/<head([^>]*)>/i,(m,attrs)=>{let inj=''; if(!hadCanon) inj+=`\n<link rel="canonical" href="${full}" />`;
    if(!hadOg) inj+=`\n<meta property="og:url" content="${full}" />`; if(!hadTw) inj+=`\n<meta name="twitter:url" content="${full}" />`; return `<head${attrs}>${inj}`;});
}

function rewriteJSONLD(html){
  return html.replace(/(<script[^>]+type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi,
    (_w,o,json,c)=>{ let s=json;
      s=s.replace(/https:\/\/aduplanet\.com\/([A-Za-z0-9/_\-]+?)(?:index\.html|\.html)((\?[^"\\\s]*)?#[^"\\\s]*)?/g,
        (_m,p,tail)=>'https://aduplanet.com/'+p.replace(/\/index$/i,'')+(tail||''));
      s=s.replace(/"\/([A-Za-z0-9/_\-]+?)(?:index\.html|\.html)((\?[^"]*)?#[^"]*)?"/g,
        (_m,p,tail)=>'"/'+p.replace(/\/index$/i,'')+(tail||'')+'"');
      return o+s+c; });
}

function rewriteHrefs(html){return html.replace(/\bhref=(["'])([^"']+)\1/gi, (_m,q,url)=>'href='+q+prettifyHref(url)+q);}
function rewriteSitemapXml(xml){
  return xml.replace(/(<loc>\s*https:\/\/aduplanet\.com\/)([^<]+?)(<\/loc>)/gi,
    (_m,pre,pathPart,post)=>{let out=pathPart; if(/\/index\.html$/i.test(out)) out=out.replace(/\/index\.html$/i,'/'); else if(/\.html$/i.test(out)) out=out.replace(/\.html$/i,'');
      return pre+out+post;});
}
function isSitemap(p){return p.toLowerCase().endsWith('sitemap.xml');}

(async function main(){
  const files=await walk(ROOT); let changed=0;
  for(const fsPath of files){
    const raw=await fs.readFile(fsPath,'utf8');
    if(isSitemap(fsPath)){const next=rewriteSitemapXml(raw); if(next!==raw){await fs.writeFile(fsPath,next,'utf8'); console.log('sitemap updated:',toWebPath(fsPath)); changed++;} continue;}
    const prettyWebPath=prettyFromFile(fsPath);
    let html=raw; html=replaceCanonicals(html,prettyWebPath); html=rewriteJSONLD(html); html=rewriteHrefs(html);
    if(html!==raw){await fs.writeFile(fsPath,html,'utf8'); console.log('rewrote:',toWebPath(fsPath),'→',prettyWebPath); changed++;}
  }
  console.log(`Done. Files changed: ${changed}`);
  console.log(`Leftovers check (.html links):`);
  console.log(`  git grep -nE 'href=\"/[^\"]+\\.html\"' -- ':!assets' ':!functions' ':!node_modules' || echo none`);
})();
