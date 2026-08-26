import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {configSchema} from 'mqtt-interfaces-core';

import pkg from '../package.json' with {type: 'json'};

// config.js parses the command line at import time; the password is mandatory
process.env.FRITZ2MQTT_PASSWORD = 's3cret';
const {OPTIONS, check} = await import('../config.js');

describe('config schema', () => {
    const schema = configSchema({pkg, envPrefix: 'FRITZ2MQTT', options: OPTIONS, defaults: {name: 'fritz'}});

    test('adapter metadata', () => {
        assert.equal(schema.title, 'fritz2mqtt');
        assert.equal(schema['x-adapter'].name, 'fritz2mqtt');
        assert.equal(schema['x-adapter'].envPrefix, 'FRITZ2MQTT');
        assert.deepEqual(schema['x-adapter'].mqttInterfaces, {
            spec: '2.0',
            envPrefix: 'FRITZ2MQTT',
            needs: ['network-host'],
            serviceExtra: [],
        });
    });

    test('mandatory options and secrets', () => {
        assert.deepEqual(schema.required, ['password']);
        assert.equal(schema.properties.password['x-secret'], true);
        assert.equal(schema.properties.password['x-env'], 'FRITZ2MQTT_PASSWORD');
        assert.equal(schema.properties.username['x-secret'], undefined);
        assert.equal(schema.properties['mqtt-password']['x-secret'], true);
    });

    test('adapter options with env names, defaults and enums', () => {
        const p = schema.properties;
        assert.equal(p.address['x-env'], 'FRITZ2MQTT_ADDRESS');
        assert.equal(p.address.default, 'fritz.box');
        assert.equal(p['poll-interval'].default, 60);
        assert.equal(p['traffic-interval'].default, 10);
        assert.deepEqual(p['host-key'].enum, ['name', 'mac']);
        assert.equal(p['host-filter'].type, 'array');
        assert.equal(p.tls.default, false);
        assert.equal(p.insecure.default, false);
        assert.equal(p.dsl.default, true);
        assert.equal(p.wlan.default, true);
        assert.equal(p.hosts.default, true);
        assert.equal(p['ha-hosts'].default, false);
        assert.equal(p.callmonitor.default, true);
        assert.equal(p.calllist.default, true);
        assert.equal(p['calllist-max'].default, 20);
        assert.equal(p['calllist-days'].default, 0);
        assert.equal(p['raw-set'].default, false);
        assert.equal(p.name.default, 'fritz');
    });

    test('shared options are present, meta options are not', () => {
        const keys = Object.keys(schema.properties);
        for (const k of ['mqtt-url', 'mqtt-username', 'name', 'json-payloads', 'ha-discovery', 'verbosity']) {
            assert.ok(keys.includes(k), k);
        }
        for (const k of ['install', 'uninstall', 'config-schema', 'help']) {
            assert.ok(!keys.includes(k), k);
        }
    });

    test('check() rejects nonsense values', () => {
        const ok = {pollInterval: 60, trafficInterval: 10, calllistMax: 20, calllistDays: 0};
        assert.equal(check(ok), true);
        assert.equal(check({...ok, trafficInterval: 0}), true);
        assert.throws(() => check({...ok, pollInterval: 1}), /poll-interval/);
        assert.throws(() => check({...ok, trafficInterval: 0.5}), /traffic-interval/);
        assert.throws(() => check({...ok, trafficInterval: -1}), /traffic-interval/);
        assert.throws(() => check({...ok, calllistMax: 0}), /calllist-max/);
        assert.throws(() => check({...ok, calllistDays: -1}), /calllist-days/);
    });
});
