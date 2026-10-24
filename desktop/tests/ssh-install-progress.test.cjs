const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { installPhases } = require('../dist/ssh/protocol.js');

let model;
before(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/desktop/ssh-install-progress.ts'), 'utf8');
  const javascript = stripTypeScriptTypes(source);
  model = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
});

function status(overrides = {}) {
  return { state: 'running', phase: 'images', completedPhases: ['docker', 'source'], ...overrides };
}

test('presentation steps match the server-validated checkpoint order', () => {
  assert.deepEqual(model.INSTALL_PHASES.map(({ id }) => id), [...installPhases]);
});

test('component reporting advances no percentage until its whole checkpoint is confirmed', () => {
  const beforeComponent = model.deriveInstallProgress(status());
  const afterComponent = model.deriveInstallProgress(status({ phase: 'images:api' }));
  assert.equal(beforeComponent.percent, 20);
  assert.equal(afterComponent.percent, 20);
  assert.equal(afterComponent.completedCount, 2);
  assert.equal(afterComponent.total, 10);
  assert.equal(afterComponent.currentIndex, 2);
  assert.equal(afterComponent.phaseTitle, 'Сборка компонентов');
  assert.equal(afterComponent.detail, 'Подготовлен компонент: API сервера');
  assert.deepEqual(afterComponent.steps.map(({ state }) => state), ['completed', 'completed', 'current', ...Array(7).fill('pending')]);
});

test('all server checkpoints contribute equal confirmed shares without time interpolation', () => {
  for (let completed = 0; completed < installPhases.length; completed += 1) {
    const value = status({ phase: installPhases[completed], completedPhases: installPhases.slice(0, completed) });
    const progress = model.deriveInstallProgress(value);
    assert.equal(progress.percent, completed * 10);
    assert.equal(progress.currentIndex, completed);
    assert.deepEqual(model.deriveInstallProgress(value), progress);
  }
});

test('completed checkpoint does not guess the next active phase', () => {
  const progress = model.deriveInstallProgress(status({ phase: 'source' }));
  assert.equal(progress.percent, 20);
  assert.equal(progress.currentIndex, null);
  assert.equal(progress.phaseTitle, 'Переход к следующему этапу');
  assert.equal(progress.steps.some(({ state }) => state === 'current'), false);
});

test('100 percent requires both a final completed state and all checkpoints', () => {
  const waiting = model.deriveInstallProgress(status({ phase: 'readiness', completedPhases: [...installPhases] }));
  assert.equal(waiting.percent, null);
  assert.equal(waiting.completedCount, 10);
  assert.equal(waiting.currentIndex, null);
  assert.equal(waiting.phaseTitle, 'Подтверждение завершения');
  const complete = model.deriveInstallProgress(status({ state: 'completed', phase: 'readiness', completedPhases: [...installPhases] }));
  assert.equal(complete.percent, 100);
  assert.equal(complete.steps.every(({ state }) => state === 'completed'), true);
  assert.equal(model.deriveInstallProgress(status({ state: 'completed' })).percent, null);
  assert.equal(model.deriveInstallProgress(status({ state: 'completed', completedPhases: [...installPhases, 'unknown'] })).percent, null);
});

test('stopping and recovery preserve confirmed progress and do not show a running failed step', () => {
  for (const state of ['failed', 'needs_recovery', 'cancelled']) {
    const progress = model.deriveInstallProgress(status({ state }));
    assert.equal(progress.percent, 20);
    assert.equal(progress.steps[2].state, 'stopped');
    assert.equal(progress.steps.some(({ state }) => state === 'current'), false);
  }
  assert.equal(model.deriveInstallProgress(status({ state: 'cancel_requested' })).steps[2].state, 'current');
});

test('missing and unknown states remain indeterminate', () => {
  for (const value of [undefined, null, status({ state: 'future-state' }), status({ state: 'future-state', completedPhases: [...installPhases] })]) {
    const progress = model.deriveInstallProgress(value);
    assert.equal(progress.percent, null);
    assert.equal(progress.currentIndex, null);
    assert.equal(progress.steps.some(({ state }) => state === 'current'), false);
  }
});

test('unknown phases have a safe label while retaining known completed checkpoints', () => {
  const progress = model.deriveInstallProgress(status({ phase: 'unexpected-private-value' }));
  assert.equal(progress.percent, 20);
  assert.equal(progress.currentIndex, null);
  assert.equal(progress.phaseTitle, 'Этап уточняется');
  assert.equal(JSON.stringify(progress).includes('unexpected-private-value'), false);
  for (const phase of ['images:future-service', 'images:constructor', 'images:__proto__']) {
    assert.equal(model.installPhaseLabel(phase), 'Сборка компонентов');
    assert.equal(model.deriveInstallProgress(status({ phase })).detail, undefined);
  }
});

test('queued and resuming states retain confirmed progress without inventing an active step', () => {
  const queued = model.deriveInstallProgress(status({ phase: 'queued', completedPhases: [] }));
  assert.equal(queued.percent, 0);
  assert.equal(queued.phaseTitle, 'Ожидание запуска');
  assert.equal(queued.currentIndex, null);
  const resumed = model.deriveInstallProgress(status({ phase: 'resuming' }));
  assert.equal(resumed.percent, 20);
  assert.equal(resumed.phaseTitle, 'Возобновление установки');
  assert.equal(resumed.currentIndex, null);
});

test('malformed checkpoint arrays cannot inflate progress and inputs are unchanged', () => {
  for (const completedPhases of [['docker', 'source', 'source', 'images'], ['docker', 'source', 'unknown'], ['docker', 'source', 'https']]) {
    const input = Object.freeze(status({ completedPhases: Object.freeze(completedPhases) }));
    const progress = model.deriveInstallProgress(input);
    assert.equal(progress.percent, 20);
    assert.deepEqual(input.completedPhases, completedPhases);
  }
});
