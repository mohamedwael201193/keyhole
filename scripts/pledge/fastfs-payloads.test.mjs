import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {payloads,CHUNK,quoteArg,MAX_NONCE,validateNonce,deriveNonce} from './fastfs-payloads.mjs';
const field=(b,p)=>{const n=b.readUInt32LE(p);return [b.subarray(p+4,p+4+n),p+4+n];};
test('simple payload matches official Borsh variant, path, optional content and MIME',()=>{const data=Buffer.from('wasm'),b=payloads(data,42)[0];assert.equal(b[0],0);let [path,p]=field(b,1);assert.equal(path.toString(),createHash('sha256').update(data).digest('hex')+'.wasm');assert.equal(b[p++],1);let [mime,q]=field(b,p);assert.equal(mime.toString(),'application/wasm');let [body,end]=field(b,q);assert.deepEqual(body,data);assert.equal(end,b.length);});
test('interrupted multi-chunk upload retains same nonce, offsets and exact bytes',()=>{const data=Buffer.alloc(CHUNK+37,7),bs=payloads(data,123);assert.equal(bs.length,2);const chunks=[];for(let i=0;i<bs.length;i++){const b=bs[i];assert.equal(b[0],1);let [,p]=field(b,1);assert.equal(b.readUInt32LE(p),i*CHUNK);assert.equal(b.readUInt32LE(p+4),data.length);let [,q]=field(b,p+8);let [body,end]=field(b,q);assert.equal(b.readUInt32LE(end),123);assert.equal(end+4,b.length);chunks.push(body);}assert.deepEqual(Buffer.concat(chunks),data);assert.deepEqual(payloads(data,123)[1],bs[1]);assert.notDeepEqual(payloads(data,124)[1],bs[1]);});
test('chunk threshold and fixed nonce reject accidental invalid journals',()=>{assert.equal(quoteArg("/tmp/a'b"),"'/tmp/a'\\''b'");assert.equal(payloads(Buffer.alloc(CHUNK),1).length,1);assert.equal(payloads(Buffer.alloc(CHUNK+1),1).length,2);for(const n of [-1,0,MAX_NONCE+1,2611110050,0xffffffff,2**32,NaN,Infinity,0.1])assert.throws(()=>payloads(Buffer.alloc(1),n));});

test('FastFS nonce boundaries match upstream signed-i32 validator',()=>{
 for(const n of [1,MAX_NONCE]){assert.equal(validateNonce(n),n);const bs=payloads(Buffer.alloc(CHUNK+1),n);for(const b of bs)assert.equal(b.readUInt32LE(b.length-4),n);}
 for(const n of [0,MAX_NONCE+1,2611110050,0xffffffff,-1,NaN,Infinity,1.5,'1']){assert.throws(()=>validateNonce(n));assert.throws(()=>payloads(Buffer.alloc(CHUNK+1),n));}
});
test('derived nonce is bounded, unique after persisted previous nonce, and fails closed on exhaustion',()=>{
 assert.equal(deriveNonce(0),1);assert.equal(deriveNonce(MAX_NONCE-1),MAX_NONCE);assert.equal(deriveNonce(MAX_NONCE),1);assert.equal(deriveNonce(MAX_NONCE+1),2);
 assert.equal(deriveNonce(10,100),101);assert.equal(deriveNonce(10,deriveNonce(10)),12);assert.equal(deriveNonce(1794353000),1794353001);
 for(const args of [[-1],[1.5],[NaN],[Infinity],[1,MAX_NONCE],[1,-1],[1,MAX_NONCE+1],[1,2611110050]])assert.throws(()=>deriveNonce(...args));
 for(const seconds of [0,1,MAX_NONCE,MAX_NONCE*2,Number.MAX_SAFE_INTEGER])assert.ok(deriveNonce(seconds)>=1&&deriveNonce(seconds)<=MAX_NONCE);
});
