import test from 'node:test';
import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';
test('strict judge RPC has an honest identifying User-Agent and preserves pinned byte/version/minter assertions',()=>{
 const s=readFileSync(new URL('../../judge/1-contract.sh',import.meta.url),'utf8');
 assert.match(s,/'User-Agent':'KEYHOLE-release-verifier\/2\.6/);
 assert.match(s,/VERIFY_RPC/);assert.match(s,/block_id=block/);
 assert.match(s,/live bytes != repository/);assert.match(s,/NEP-330 version mismatch/);assert.match(s,/minter mismatch/);
});
