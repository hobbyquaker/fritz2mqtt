import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {discoveryModel, wlanLabel, ADAPTER} from '../lib/hadiscovery.js';

describe('hadiscovery', () => {
    test('box device with all features', () => {
        const [box, ...rest] = discoveryModel({
            name: 'fritz',
            device: {model: 'FRITZ!Box 7590', version: '154.07.57', serial: 'S1', hardware: 'FRITZ!Box 7590'},
            wlans: [
                {index: 1, ssid: 'Home', guest: false, band: '2400'},
                {index: 3, ssid: 'Guest', guest: true},
            ],
            hosts: [{mac: 'AA:BB:CC:DD:EE:01', key: 'phone', name: 'phone', wired: false}],
        });
        assert.equal(rest.length, 0);
        assert.equal(ADAPTER, 'fritz2mqtt');
        assert.equal(box.id, 'fritz2mqtt_fritz');
        assert.deepEqual(box.device, {
            name: 'fritz',
            mf: 'AVM',
            mdl: 'FRITZ!Box 7590',
            sw: '154.07.57',
            sn: 'S1',
            hw: 'FRITZ!Box 7590',
        });
        const c = box.components;
        assert.equal(c.dsl_downstream_curr_rate.stat_t, 'fritz/status/dsl/downstream_curr_rate');
        assert.equal(c.dsl_downstream_curr_rate.val_tpl, '{{ value_json.val }}');
        assert.equal(c.dsl_downstream_curr_rate.unit_of_meas, 'kbit/s');
        assert.equal(c.dsl_downstream_noise_margin.ent_cat, 'diagnostic');
        assert.equal(c.wan_connected.p, 'binary_sensor');
        assert.equal(c.wan_connected.dev_cla, 'connectivity');
        assert.equal(c.wan_bytes_received.stat_cla, 'total_increasing');
        assert.equal(c.wan_reconnect.p, 'button');
        assert.equal(c.wan_reconnect.cmd_t, 'fritz/set/wan/reconnect');
        assert.equal(c.wan_reconnect.stat_t, undefined);
        assert.equal(c.wlan_1_enabled.p, 'switch');
        assert.equal(c.wlan_1_enabled.name, 'WLAN Home 2.4 GHz');
        assert.equal(c.wlan_3_enabled.name, 'WLAN Guest');
        assert.equal(c.wlan_1_enabled.cmd_t, 'fritz/set/wlan/1/enabled');
        assert.equal(c.wlan_3_enabled.ic, 'mdi:wifi-lock-open');
        assert.equal(c.wlan_3_associations.stat_t, 'fritz/status/wlan/3/associations');
        assert.equal(c.host_count_active.stat_t, 'fritz/status/host_count/active');
        assert.equal(c.call_active.p, 'binary_sensor');
        assert.equal(c.call_last_caller.val_tpl, '{{ value_json.val.number }}');
        assert.equal(c.reboot.cmd_t, 'fritz/set/device/reboot');
        assert.equal(c.uptime.dev_cla, 'duration');
        const ids = Object.values(c).map((e) => e.uniq_id);
        assert.equal(new Set(ids).size, ids.length, 'unique ids');
    });

    test('wlan labels: band added, always when two radios share an ssid', () => {
        const wlans = [
            {index: 1, ssid: 'Home', band: '2400'},
            {index: 2, ssid: 'Home', band: '5000'},
            {index: 3, ssid: 'Gast', guest: true, band: 'unknown'},
            {index: 4, ssid: '', band: '6000'},
        ];
        assert.equal(wlanLabel(wlans[0], wlans), 'WLAN Home 2.4 GHz');
        assert.equal(wlanLabel(wlans[1], wlans), 'WLAN Home 5 GHz');
        assert.equal(wlanLabel(wlans[2], wlans), 'WLAN Gast');
        assert.equal(wlanLabel(wlans[3], wlans), 'WLAN 4 6 GHz');
    });

    test('features off remove their entities', () => {
        const [box] = discoveryModel({
            name: 'fritz',
            features: {dsl: false, wan: false, traffic: false, hosts: false, callmonitor: false},
        });
        const keys = Object.keys(box.components);
        assert.deepEqual(keys, ['uptime', 'reboot']);
    });

    test('plain payloads', () => {
        const [box] = discoveryModel({name: 'fritz', jsonPayloads: false});
        assert.equal(box.components.dsl_status.val_tpl, undefined);
        assert.equal(box.components.call_last_caller.val_tpl, '{{ value_json.number }}');
    });

    test('host trackers with --ha-hosts', () => {
        const devices = discoveryModel({
            name: 'fritz',
            haHosts: true,
            hosts: [
                {mac: 'AA:BB:CC:DD:EE:01', key: 'phone', name: 'phone', wired: false},
                {mac: 'AA:BB:CC:DD:EE:03', key: 'nas', name: 'nas', wired: true},
            ],
        });
        assert.equal(devices.length, 3);
        const phone = devices[1];
        assert.equal(phone.id, 'fritz2mqtt_fritz_host_aabbccddee01');
        assert.deepEqual(phone.device, {
            name: 'phone',
            cns: [['mac', 'AA:BB:CC:DD:EE:01']],
            via_device: 'fritz2mqtt_fritz',
        });
        const t = phone.components.present;
        assert.equal(t.p, 'device_tracker');
        assert.equal(t.stat_t, 'fritz/status/host/phone/present');
        assert.equal(t.json_attr_t, 'fritz/status/host/phone/details');
        assert.equal(t.src_type, 'router');
        assert.equal(t.ic, 'mdi:wifi');
        assert.equal(devices[2].components.present.ic, 'mdi:ethernet');
        assert.match(t.val_tpl, /value_json\.val/);
        const plain = discoveryModel({
            name: 'fritz',
            haHosts: true,
            jsonPayloads: false,
            hosts: [{mac: 'A', key: 'a', name: 'a'}],
        });
        assert.match(plain[1].components.present.val_tpl, /value == 'true'/);
        assert.equal(plain[1].components.present.json_attr_tpl, undefined);
    });
});
