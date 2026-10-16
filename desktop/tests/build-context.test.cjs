const test = require('node:test');
const assert = require('node:assert/strict');
test('build identity binds exact source snapshot and stable source time instead of the wall clock', async () => {
  const {makeBuildProvenance,sourceDateEpoch} = await import('../scripts/build-context.mjs');
  const inputs={sourceCommit:'a'.repeat(40),sourceDirty:true,sourceTreeSha256:'b'.repeat(64)};
  const options={pkg:{version:'0.6.0'},inputs,epoch:1760000000,hostPlatform:'darwin',hostArch:'arm64'};
  assert.deepEqual(makeBuildProvenance(options),makeBuildProvenance(options));
  assert.equal(makeBuildProvenance(options).sourceTreeSha256,inputs.sourceTreeSha256);
  assert.equal(makeBuildProvenance(options).buildVersion,'0.6.0-test');
  const beta = {...options,pkg:{version:'0.1.0-beta'}};
  assert.equal(makeBuildProvenance(beta).buildVersion,'0.1.0-beta-test');
  assert.throws(()=>makeBuildProvenance({...beta,releaseMode:'release',inputs:{...inputs,sourceDirty:false},config:{}}),/stable version/);
  for (const version of ['0.1.0 beta','0.1.0-beta-test','0.1.0-rc.1'])
    assert.throws(()=>makeBuildProvenance({...options,pkg:{version}}),/version/);
  assert.equal(sourceDateEpoch(undefined,1760000000),1760000000);
  for (const value of ['-1','NaN','1.5','0',String(Math.floor(Date.now()/1000)+3600)]) assert.throws(()=>sourceDateEpoch(value,1760000000));
  assert.throws(()=>makeBuildProvenance({...options,releaseMode:'release'}),/clean/);
});
