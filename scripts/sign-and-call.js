// usage: OUTLAYER_PAYMENT_KEY=... node sign-and-call.js <keyfile.json {account_id, private_key}> <op> '<params json>' [authFile]
// Signs a NEP-413 request (recipient "keyhole") with a local NEAR key and sends it to the KEYHOLE worker.
const {KeyPair}=require('near-api-js');const fs=require('fs');const crypto=require('crypto');const {execSync}=require('child_process');
const [,,kf,op,params,save]=process.argv;const k=JSON.parse(fs.readFileSync(kf));const kp=KeyPair.fromString(k.private_key);
const sb=s=>{const b=Buffer.from(s);const l=Buffer.alloc(4);l.writeUInt32LE(b.length);return Buffer.concat([l,b]);};
let auth;
if(save&&fs.existsSync(save)){auth=JSON.parse(fs.readFileSync(save));}else{
const message=JSON.stringify({op,account_id:k.account_id,ts_ms:Date.now(),params:JSON.parse(params||'{}')});
const nonce=crypto.randomBytes(32);const recipient='keyhole';const tag=Buffer.alloc(4);tag.writeUInt32LE(2147484061);
const payload=Buffer.concat([tag,sb(message),nonce,sb(recipient),Buffer.from([0])]);
const sig=kp.sign(crypto.createHash('sha256').update(payload).digest()).signature;
auth={account_id:k.account_id,public_key:kp.getPublicKey().toString(),signature:Buffer.from(sig).toString('base64'),nonce:nonce.toString('base64'),message,recipient};
if(save)fs.writeFileSync(save,JSON.stringify(auth));}
const pk=process.env.OUTLAYER_PAYMENT_KEY;
const body=JSON.stringify({input:{op,auth},async:false,secrets_ref:{profile:'default',account_id:'keyhole-devmo.near'}});
fetch('https://api.outlayer.ai/call/keyhole-devmo.near/keyhole-probe',{method:'POST',headers:{'X-Payment-Key':pk,'content-type':'application/json'},body}).then(r=>r.text()).then(t=>console.log(t));
