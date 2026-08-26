import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {unitFile, envFile, envVarName, instanceName} from '../lib/install.js';
import {SHARED_OPTIONS} from 'mqtt-interfaces-core';

// config.js parses the command line at import time; the password is mandatory
process.env.FRITZ2MQTT_PASSWORD = 's3cret';
const {OPTIONS} = await import('../config.js');

describe('install', () => {
    test('unit is the shared template layout', () => {
        const unit = unitFile('/usr/bin/node /usr/local/lib/node_modules/fritz2mqtt/index.js');
        assert.match(unit, /^Description=fritz2mqtt %i - AVM FRITZ!Box to MQTT bridge$/m);
        assert.match(unit, /^Documentation=https:\/\/github\.com\/hobbyquaker\/fritz2mqtt$/m);
        assert.match(unit, /^EnvironmentFile=-\/etc\/mqtt-interfaces\/broker\.env$/m);
        assert.match(unit, /^EnvironmentFile=\/etc\/fritz2mqtt\/%i\.env$/m);
        assert.match(unit, /^Environment=FRITZ2MQTT_NAME=%i$/m);
        assert.match(unit, /^SyslogIdentifier=fritz2mqtt@%i$/m);
        assert.match(unit, /^StateDirectory=fritz2mqtt\/%i$/m);
        assert.match(unit, /^Restart=always$/m);
        assert.match(unit, /^User=fritz2mqtt$/m);
    });

    test('env file carries the set options as FRITZ2MQTT_* variables, never the name', () => {
        const argv = {
            name: 'fritz',
            address: '192.168.178.1',
            username: 'fritz2mqtt',
            password: 's3cret',
            pollInterval: 60,
            hostFilter: ['aa:bb:cc:dd:ee:01', 'nas'],
            mqttUrl: 'mqtt://broker',
            rawSet: undefined,
        };
        Object.defineProperty(argv, '$options', {value: {...OPTIONS, ...SHARED_OPTIONS}});
        const out = envFile(argv);
        assert.match(out, /^FRITZ2MQTT_ADDRESS=192\.168\.178\.1$/m);
        assert.match(out, /^FRITZ2MQTT_USERNAME=fritz2mqtt$/m);
        assert.match(out, /^FRITZ2MQTT_PASSWORD=s3cret$/m);
        assert.match(out, /^FRITZ2MQTT_POLL_INTERVAL=60$/m);
        assert.match(out, /^FRITZ2MQTT_HOST_FILTER=aa:bb:cc:dd:ee:01,nas$/m);
        assert.match(out, /^FRITZ2MQTT_MQTT_URL=mqtt:\/\/broker$/m);
        assert.doesNotMatch(out, /FRITZ2MQTT_NAME|RAW_SET/);
        assert.match(out, /fritz2mqtt@fritz\.service/);
    });

    test('helpers', () => {
        assert.equal(envVarName('pollInterval', 'FRITZ2MQTT'), 'FRITZ2MQTT_POLL_INTERVAL');
        assert.equal(instanceName('fritz-office'), 'fritz-office');
        assert.throws(() => instanceName('my box'), /instance name/);
    });
});
