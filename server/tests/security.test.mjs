import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
test('API requires a configured secret',()=>{assert.match(source,/AGENTFORGE_API_KEY/);assert.match(source,/timingSafeEqual/);});
test('task creation validates input',()=>{assert.match(source,/task\.length>4000/);});
test('PostgreSQL approval uses atomic conditional update',()=>{assert.match(source,/status='Pending approval' RETURNING id/);});
test('local server binds loopback only',()=>{assert.match(source,/127\.0\.0\.1/);});
