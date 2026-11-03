import test from 'node:test';
import assert from 'node:assert/strict';
import {submitJobOnce} from '../src/jobSubmission.js';
import {submitJobOnce as submitLocalJobOnce} from '../../ocean-acoustic-workbench/src/jobSubmission.js';

for (const [label, submitOnce] of [['public', submitJobOnce], ['local', submitLocalJobOnce]]) {
  test(label + ' rerun ignores a simultaneous click and keeps the receipt after a lost response', async () => {
    const receipt = {}, calls = [];
    let reject;
    const submit = (body, key) => {
      calls.push({body, key});
      return new Promise((resolve, fail) => {reject = fail;});
    };
    const first = submitOnce(receipt, {frequency_hz: 50}, submit);
    assert.equal(await submitOnce(receipt, {frequency_hz: 50}, submit), null);
    assert.equal(calls.length, 1);
    reject(Error('Response lost'));
    await assert.rejects(first, /Response lost/);
    assert.equal(receipt.pending, false);
    const answer = await submitOnce(receipt, {frequency_hz: 50}, async (body, key) => {
      calls.push({body, key}); return {ids: ['abcdef123456']};
    });
    assert.deepEqual(answer.ids, ['abcdef123456']);
    assert.deepEqual(calls[1], calls[0]);
    assert.equal(receipt.key, null);
    await submitOnce(receipt, {frequency_hz: 50}, async (body, key) => {calls.push({body, key});return {ids: ['another']};});
    assert.notEqual(calls[2].key, calls[0].key);
  });

  test(label + ' a changed rerun plan gets a new receipt after failure', async () => {
    const receipt = {}, keys = [];
    await assert.rejects(submitOnce(receipt, {range_points: 201}, async (body, key) => {keys.push(key);throw Error('offline');}), /offline/);
    await submitOnce(receipt, {range_points: 501}, async (body, key) => {keys.push(key);return {ids: ['refined']};});
    assert.notEqual(keys[0], keys[1]);
  });
}
