// OFFLINE ONLY: hash/verify an owner Ed25519 V0 transaction saved by near-cli.
// No key lookup, signing, network or broadcast; only the public hash is returned.
import {createHash,createPublicKey,verify} from 'node:crypto';
import {readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';
export function signedHash(row) {
 const s=row.signed_transaction_as_base64;if(typeof s!=='string')throw Error('saved signed transaction required');
 const b=Buffer.from(s,'base64');if(b.toString('base64')!==s||b.length<160)throw Error('invalid signed transaction encoding');
 const n=b.readUInt32LE(0);if(n!==18||b.subarray(4,4+n).toString()!=='keyhole-devmo.near'||b[4+n]!==0||b[b.length-65]!==0)throw Error('only reviewed owner Ed25519 V0 supported');
 const pk=b.subarray(5+n,37+n),tx=b.subarray(0,b.length-65),hash=createHash('sha256').update(tx).digest();
 const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),pk]),format:'der',type:'spki'});
 if(!verify(null,hash,key,b.subarray(b.length-64)))throw Error('invalid original signature');
 const a='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let x=BigInt('0x'+hash.toString('hex')),out='';while(x){out=a[Number(x%58n)]+out;x/=58n;}for(const z of hash){if(z!==0)break;out='1'+out;}return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const file=process.argv[2];if(!file?.endsWith('.signed.json'))throw Error('usage: signed-hash.mjs STEP.signed.json');console.log(signedHash(JSON.parse(readFileSync(file,'utf8'))));}
