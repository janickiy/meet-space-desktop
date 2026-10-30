const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {MACOS_RELEASE_FUSES,verifyMacReleaseFuses}=require('../scripts/macos-fuses.cjs');
const {flipFuses,FuseV1Options}=require('@electron/fuses');
const {SENTINEL}=require('@electron/fuses/dist/constants');
test('production Mac fuse policy is accepted by installed builder and verified through the real fuse reader',async()=>{
  const {validateConfiguration}=require('app-builder-lib/out/util/config/config.js');
  await validateConfiguration({electronFuses:{...MACOS_RELEASE_FUSES}},{isEnabled:false});
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'meetspace-fuse-policy-'));
  const file=path.join(root,'fixture-binary');
  try{
    await fs.writeFile(file,Buffer.concat([Buffer.from(SENTINEL),Buffer.from([1,8]),Buffer.alloc(8,49)]));
    await assert.rejects(verifyMacReleaseFuses(file));
    const config={version:'1'};
    for(const [key,value] of Object.entries(MACOS_RELEASE_FUSES)) config[FuseV1Options[key[0].toUpperCase()+key.slice(1)]]=value;
    await flipFuses(file,config);
    assert.deepEqual(await verifyMacReleaseFuses(file),MACOS_RELEASE_FUSES);
    await flipFuses(file,{version:'1',[FuseV1Options.EnableNodeCliInspectArguments]:true});
    await assert.rejects(verifyMacReleaseFuses(file));
    await fs.writeFile(file,Buffer.alloc(40));
    await assert.rejects(verifyMacReleaseFuses(file));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
