const {generateKeyPairSync,createHash,sign}=require('node:crypto');
const {canonicalizeUpdatePayload,updateKeyId}=require('../../dist/updates-policy.js');
function updateFixture(origin='https://updates.fixture.invalid/'){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const pem=publicKey.export({type:'spki',format:'pem'}).toString();
  const bytes=Buffer.from(Array.from({length:192*1024},(_,i)=>i%251));
  const trust={schemaVersion:1,enabled:true,appId:'com.janickiy.meetspace.desktop',channel:'stable',feedBaseUrl:origin,
    publisherNames:['CN=MeetSpace Test Fixture, O=Disposable Tests, C=XX'],signingCertThumbprints:['A'.repeat(40)],manifestPublicKeys:[pem]};
  const payload={schemaVersion:1,appId:trust.appId,channel:'stable',arch:'x64',version:'0.7.0',
    publishedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),
    installer:{file:'MeetSpace-0.7.0-win-x64-setup.exe',size:bytes.length,sha512:createHash('sha512').update(bytes).digest('base64')}};
  const envelope=(value=payload,key=privateKey)=>{
    const raw=canonicalizeUpdatePayload(value);return {schemaVersion:1,keyId:updateKeyId(pem),payload:raw.toString('base64'),signature:sign(null,raw,key).toString('base64')};
  };
  return{trust,payload,bytes,privateKey,publicKey,envelope};
}
module.exports={updateFixture};
