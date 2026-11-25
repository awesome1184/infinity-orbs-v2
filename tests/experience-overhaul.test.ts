import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');

test('desktop Armory uses compact tiles and adaptive inventory columns',()=>{
 const css=read('src/client/mobile-experience.css');
 const pass=css.slice(css.lastIndexOf('2.1.48 · Adaptive experience pass'));
 assert.match(pass,/io-combat-gear-icon\s*\{[^}]*width:52px/s);
 assert.match(pass,/io-combat-gear-grid\s*\{[^}]*auto-fill,minmax\(76px,1fr\)/s);
 assert.match(pass,/io-combat-equipped-grid\s*\{[^}]*auto-fit,minmax\(140px,1fr\)/s);
 assert.match(pass,/max-width:62px/);
});

test('every combat destination has fluid desktop and adaptive narrow-screen layouts',()=>{
 const pass=read('src/client/mobile-experience.css').split('2.1.48 · Adaptive experience pass').pop()||'';
 for(const page of ['fight','dungeons','gear','forge','skills','arena'])assert.ok(pass.includes('.io-combat-page-'+page));
 assert.match(pass,/height:auto!important/);assert.match(pass,/max-height:none!important/);
 assert.match(pass,/@media \(min-width:761px\) and \(max-width:1179px\)/);
 assert.match(pass,/@media \(max-width:760px\)/);assert.match(pass,/#root:fullscreen/);
});

test('overflow, safe-area, dialog, focus, and reduced-motion guards are present',()=>{
 const pass=read('src/client/mobile-experience.css').split('2.1.48 · Adaptive experience pass').pop()||'';
 for(const token of ['overflow-x:clip','overflow-wrap:anywhere','min-width:0','max-width:100%','safe-area-inset','overscroll-behavior:contain','prefers-reduced-motion:reduce'])assert.ok(pass.includes(token),token);
});

test('client mutation dispatch does not wait in a duplicate queue',()=>{
 const main=read('src/client/main.tsx');
 assert.doesNotMatch(main,/mutationQueueRef/);
 assert.match(main,/const enqueueMutation = useCallback[\s\S]*?return task\(\);[\s\S]*?Promise\.reject\(error\)/);
});

test('all API mutations including combat writes enter the server player FIFO',()=>{
 const app=read('src/server/app.ts');
 const start=app.indexOf("app.use('/api', async (req, res, next) => {");
 const end=app.indexOf('// Major systems unlock gradually',start);
 const fifo=app.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(fifo,/const mutatesState = \['POST', 'PUT', 'PATCH', 'DELETE'\]/);
 assert.match(fifo,/await acquireMutationLock\(playerKey\)/);
 assert.doesNotMatch(fifo,/req\.path === '\/combat\/equip'/);
 assert.match(fifo,/Every player mutation, including Gear, Skills, Forge, Arena and combat/);
});

test('combat requests no longer wait for an active beat in the webview',()=>{
 const combat=read('src/client/components/CombatSection.tsx');
 assert.doesNotMatch(combat,/const activeBeat=runtime\.current\.beatPromise/);
 assert.doesNotMatch(combat,/await activeBeat/);
 assert.match(combat,/io-combat-pending/);
 assert.match(combat,/Sending action for server validation/);
});

test('combat reads retry safely while side-effecting requests are never replayed',()=>{
 const combat=read('src/client/components/CombatSection.tsx');
 assert.match(combat,/maxAttempts=isRead\?3:1/);
 assert.match(combat,/retryableRead=isRead/);
 assert.match(combat,/hasUncertainCombatMutationOutcome/);
 assert.match(combat,/action was not replayed/);
});

test('release version is synchronized across package, lockfile, runtime, and changelog',()=>{
 const pkg=JSON.parse(read('package.json'));
 const lock=JSON.parse(read('package-lock.json'));
 assert.equal(pkg.version,'2.1.48');assert.equal(lock.version,'2.1.48');assert.equal(lock.packages[''].version,'2.1.48');
 assert.match(read('src/shared/version.ts'),/APP_VERSION = '2\.1\.48'/);
 assert.match(read('changelog.md'),/Responsive Fullscreen UX and Immediate Server Dispatch \(2\.1\.48\)/);
 assert.match(read('.github/workflows/deploy.yml'),/\[deploy-dev:2\.1\.48\]/);
});
