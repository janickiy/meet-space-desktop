// Local HTTPS storage + authenticated API fixture. No production credentials.
const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {randomBytes, createCipheriv, createDecipheriv} = require('node:crypto');
const {createFixture, CONFERENCE, PASSWORD} = require('./https-fixture.cjs');
const {MeetSpaceBroker} = require('../../dist/broker.js');
const {createNodeHttpsTransport} = require('../../dist/network/transport.js');
const RECORDING='44444444-4444-4444-8444-444444444444', FILE='55555555-5555-4555-8555-555555555555';
const ATTACHMENT='66666666-6666-4666-8666-666666666666';
const asset={kind:'recording',conferenceId:CONFERENCE,recordingId:RECORDING,fileId:FILE};
function cipher() {
  const key=randomBytes(32);
  return {isAvailable:()=>true, encrypt(value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(value,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]);},
    decrypt(value){const b=Buffer.from(value),c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8');}};
}
function signed(origin, expire=300) {
  const url=new URL('/bucket/recording.mp4',origin);
  const date=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  for(const [key,value] of Object.entries({'X-Amz-Algorithm':'AWS4-HMAC-SHA256','X-Amz-Credential':`test/${date.slice(0,8)}/us-east-1/s3/aws4_request`,'X-Amz-Date':date,'X-Amz-Expires':String(expire),'X-Amz-SignedHeaders':'host','X-Amz-Signature':'a'.repeat(64)}))url.searchParams.set(key,value);
  return url.href;
}
async function createAssetsFixture(certificates, options={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'meetspace-assets-'));
  const bytes=options.bytes||Buffer.from(Array.from({length:256*1024},(_,i)=>i%251));
  const seen=[], peers=new Set(), controls={denied:false,redirect:false,expireOnce:false,slow:false,wrongRange:false,wrongLength:false,wrongMime:false,size:bytes.length,initialPreferencesFail:!!options.initialPreferencesFail};
  let origin, api, metadataReads=0, contentReads=0, preferenceReads=0;
  const serve=(request,response)=>{
    contentReads++;
    if(controls.redirect){response.writeHead(302,{Location:'https://unrequested.invalid/no'});response.end();return;}
    if(controls.expireOnce){controls.expireOnce=false;response.writeHead(403);response.end();return;}
    let start=0,end=bytes.length-1,status=200;
    if(request.headers.range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if(!match){response.writeHead(416);response.end();return;}
      start=match[1]?Number(match[1]):Math.max(0,bytes.length-Number(match[2]));
      end=match[1]&&match[2]?Math.min(bytes.length-1,Number(match[2])):bytes.length-1;
      if(start>=bytes.length||end<start){response.writeHead(416,{'Content-Range':`bytes */${bytes.length}`});response.end();return;}
      status=206;
    }
    response.writeHead(status,{'Content-Type':controls.wrongMime?'text/html':'video/mp4','Content-Length':String(end-start+1+(controls.wrongLength?1:0)),
      ...(status===206?{'Content-Range':`bytes ${controls.wrongRange?start+1:start}-${end}/${bytes.length}`}:{})});
    let cursor=start;
    const pump=()=>{
      if(response.destroyed)return;
      if(cursor>end){response.end();return;}
      const stop=Math.min(end+1,cursor+16384);const next=bytes.subarray(cursor,stop);cursor=stop;
      const more=response.write(next);
      if(controls.slow)setTimeout(pump,10);else if(more)setImmediate(pump);else response.once('drain',pump);
    };pump();
  };
  const storage=https.createServer({key:certificates.key,cert:certificates.cert},(request,response)=>{
    seen.push({method:request.method,headers:{...request.headers},url:request.url});serve(request,response);
  });
  storage.on('connection',socket=>{peers.add(socket);socket.once('close',()=>peers.delete(socket));});
  await new Promise(resolve=>storage.listen(0,'127.0.0.1',resolve));origin=`https://127.0.0.1:${storage.address().port}`;
  const card=()=>({uuid:RECORDING,conferenceId:CONFERENCE,status:'ready',files:[{uuid:FILE,fileType:'final_mp4',fileName:'recording.mp4',mimeType:'video/mp4',sizeBytes:controls.size,url:signed(origin)}]});
  api=await createFixture({name:'assets',certificates,handleRequest:async({request,response,url,send})=>{
    if(url.pathname==='/api/v1/notifications/preferences'){
      preferenceReads++;send(response,controls.initialPreferencesFail?503:200,controls.initialPreferencesFail?{status:'failed'}:{invitation:true,reminder:true,recording:false,summary:false});return true;
    }
    if(url.pathname===`/api/v1/conferences/${CONFERENCE}/recordings/${RECORDING}`){metadataReads++;send(response,controls.denied?403:200,controls.denied?{status:'failed'}:{item:card()});return true;}
    if(url.pathname===`/api/v1/conferences/${CONFERENCE}/recordings`){send(response,200,{items:[card()]});return true;}
    if(url.pathname===`/api/v1/conversations/${CONFERENCE}/attachments/${ATTACHMENT}/download`){metadataReads++;send(response,200,{url:`${api.origin}/api/v1/conversations/${CONFERENCE}/attachments/${ATTACHMENT}/content`,authenticated:true,expiresAt:new Date(Date.now()+240000).toISOString()});return true;}
    if(url.pathname===`/api/v1/conversations/${CONFERENCE}/attachments/${ATTACHMENT}/content`){serve(request,response);return true;}
    return false;
  }});
  const events=[], identities=[], preferences=[], notifications=[];
  const broker=new MeetSpaceBroker({storageDir:directory,cipher:cipher(),emit:event=>events.push(event),transport:options.transport||createNodeHttpsTransport({ca:certificates.ca,timeoutMs:3000}),
    onIdentityChanged:value=>identities.push(value),onNotificationPreferences:value=>preferences.push(value),onNotificationEvent:value=>notifications.push(value)});
  await broker.initialize();await broker.addServer({origin:api.origin,label:'Local assets fixture'});
  await broker.selectServer(broker.serversState().items.find(item=>item.origin===api.origin).id);
  let sequence=0;
  const http=(method,path,body,token)=>broker.http({id:`asset-http-${++sequence}`,method,path:`/api/v1${path}`,responseType:'json',...(body===undefined?{}:{body}),...(token?{token}:{})});
  const login=await http('POST','/auth/login',{email:api.users[0].email,password:PASSWORD});
  if(login.status!==200)throw new Error('fixture login failed');
  return {directory,bytes,origin,api,seen,controls,broker,http,marker:login.body.accessToken,events,identities,preferences,notifications,
    get metadataReads(){return metadataReads;},get contentReads(){return contentReads;},get preferenceReads(){return preferenceReads;},
    async close(){broker.dispose();await api.close();for(const socket of peers)socket.destroy();await new Promise(resolve=>storage.close(resolve));await fs.rm(directory,{recursive:true,force:true});}};
}
module.exports={createAssetsFixture,signed,asset,RECORDING,FILE,ATTACHMENT,CONFERENCE};
