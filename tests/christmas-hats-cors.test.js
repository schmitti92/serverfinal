import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

test('authenticated Christmas Hats voucher endpoints accept cross-origin token preflight',()=>{
 const file=fileURLToPath(new URL('../server.js',import.meta.url));
 const code=readFileSync(file,'utf8');
 const cors=code.slice(code.indexOf('// CORS for GitHub Pages'),code.indexOf('app.use(express.json('));
 assert.ok(cors.length>300);
 const middlewareBeforeOrigin=cors.slice(0,cors.indexOf('const origin ='));
 assert.match(middlewareBeforeOrigin,/req\.path\.startsWith\('\/api\/christmas-hats'\)/);
 assert.match(cors,/Access-Control-Allow-Headers', 'Authorization,Content-Type(?:,X-DOG-Preview-Key)?'/);
 assert.match(cors,/Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS'/);
 assert.match(cors,/if \(req\.method === "OPTIONS"\) return res\.status\(204\)\.end\(\)/);
 assert.match(cors,/PROFILE_ALLOWED_ORIGINS/);
});
