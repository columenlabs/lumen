/**
 * The page's first load across a deploy (`@columenlabs/lumen-ui/boot`, a Vite plugin).
 *
 * The kit's own recovery (`watchNewBuilds`, `RouteError`, `lazyPart`) runs inside the app's code, so it
 * cannot help when that code never starts: a deploy landing while the page loads, a file the host
 * answers 5xx for a moment, a dropped connection. The page then sat on its splash forever (2026-11-24:
 * an app's own CSS and a chunk answered 500 right after a deploy, and the logo stayed for over a minute).
 *
 * The plugin puts a small plain script at the top of `index.html`. Until the app draws (the splash is
 * gone, or the app calls `window.__lumenBooted = true`), a stylesheet or script of this site that fails
 * to load, or nothing drawn within `timeoutMs`, reloads the page onto the build the server has now,
 * after 1, 3 and then 9 s. Past 3 tries in 2 minutes it stops and the splash says the app could not load,
 * with a Reload button: never a page stuck on a logo, and never a reload loop. It does nothing once the
 * app has drawn; from then on the kit's in-app recovery takes over.
 */

export interface BootGuardOptions {
  /** CSS selector of the splash `index.html` draws until the app does (gone = drawn). */
  splash: string;
  /** The app's name, for "<name> couldn't load". */
  name: string;
  /** How long the page may take to draw before it counts as stuck. Default 30 s. */
  timeoutMs?: number;
}

/** The inline script, for an app that writes its own `index.html` without the plugin. */
export function bootGuardScript({ splash, name, timeoutMs = 30_000 }: BootGuardOptions): string {
  const cfg = JSON.stringify({ splash, name, timeoutMs }).replace(/</g, '\\u003c');
  return `(function(c){var K='lumen_boot_tries',W=12e4,B=[1e3,3e3,9e3],done=false;
function booted(){return window.__lumenBooted===true||!document.querySelector(c.splash)}
function tries(){try{var n=Date.now();return JSON.parse(sessionStorage.getItem(K)||'[]').filter(function(t){return n-t<W})}catch(e){return []}}
function show(){var el=document.querySelector(c.splash);if(!el)return;el.textContent='';el.setAttribute('role','alert');
var p=document.createElement('p');p.textContent=c.name+" couldn't load. Check your connection, then reload.";p.style.cssText='font:500 15px system-ui,sans-serif;margin:0;text-align:center;max-width:22em;padding:0 16px';
var b=document.createElement('button');b.type='button';b.title='Reload';b.setAttribute('aria-label','Reload');
b.style.cssText='display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:8px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer';
b.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>';
b.onclick=function(){try{sessionStorage.removeItem(K)}catch(e){}location.reload()};el.appendChild(p);el.appendChild(b)}
function fail(){if(done||booted())return;done=true;var t=tries();if(t.length>=B.length){show();return}
t.push(Date.now());try{sessionStorage.setItem(K,JSON.stringify(t))}catch(e){}setTimeout(function(){location.reload()},B[t.length-1])}
addEventListener('error',function(e){var x=e.target;if(!x||(x.tagName!=='SCRIPT'&&x.tagName!=='LINK'))return;
if(x.tagName==='LINK'&&!/stylesheet|modulepreload/.test(x.rel))return;var u=x.src||x.href||'';if(u.indexOf(location.origin)===0)fail()},true);
setTimeout(fail,c.timeoutMs);var iv=setInterval(function(){if(booted()){clearInterval(iv);try{sessionStorage.removeItem(K)}catch(e){}}},1e3)})(${cfg});`;
}

/** The Vite plugin: injects `bootGuardScript` first in `<head>`. */
export function bootGuard(options: BootGuardOptions) {
  return {
    name: 'lumen-boot-guard',
    transformIndexHtml() {
      return [
        { tag: 'script', children: bootGuardScript(options), injectTo: 'head-prepend' as const },
      ];
    },
  };
}
