import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {FritzState, topicKey, normalizeMac} from '../lib/model.js';

const items = (r) => Object.fromEntries(r.changes.map((c) => [c.item, c.value]));

describe('model helpers', () => {
    test('topicKey and normalizeMac', () => {
        assert.equal(topicKey('My Phone/1+2#'), 'My_Phone_1_2_');
        assert.equal(topicKey('  '), '_');
        assert.equal(normalizeMac('aa-bb-cc-dd-ee-ff'), 'AA:BB:CC:DD:EE:FF');
    });
});

describe('FritzState', () => {
    test('device: numbers, discovery on model change', () => {
        const s = new FritzState();
        const r = s.applyDevice({
            ModelName: 'FRITZ!Box 7590',
            SoftwareVersion: '154.07.57',
            SerialNumber: 'X',
            UpTime: '99',
        });
        assert.equal(r.discovery, true);
        assert.deepEqual(items(r), {
            'device/model': 'FRITZ!Box 7590',
            'device/software_version': '154.07.57',
            'device/serial': 'X',
            'device/uptime': 99,
        });
        const r2 = s.applyDevice({
            ModelName: 'FRITZ!Box 7590',
            SoftwareVersion: '154.07.57',
            SerialNumber: 'X',
            UpTime: '159',
        });
        assert.equal(r2.discovery, false);
        assert.deepEqual(items(r2), {'device/uptime': 159});
        assert.equal(s.device.model, 'FRITZ!Box 7590');
    });

    test('dsl: tenths of dB, statistics, unchanged values are not repeated', () => {
        const s = new FritzState();
        const info = {
            Enable: '1',
            Status: 'Up',
            DataPath: 'Interleaved',
            UpstreamCurrRate: '41952',
            DownstreamCurrRate: '109868',
            UpstreamMaxRate: '44372',
            DownstreamMaxRate: '129476',
            UpstreamNoiseMargin: '70',
            DownstreamNoiseMargin: '65',
            UpstreamAttenuation: '110',
            DownstreamAttenuation: '150',
            UpstreamPower: '125',
            DownstreamPower: '158',
            ATURVendor: '41564d00',
            ATURCountry: '0400',
        };
        const r = s.applyDsl(info, {
            CRCErrors: '12',
            FECErrors: '3400',
            HECErrors: '0',
            ErroredSecs: '5',
            SeverelyErroredSecs: '0',
            LinkRetrain: '1',
        });
        const v = items(r);
        assert.equal(v['dsl/enabled'], true);
        assert.equal(v['dsl/status'], 'Up');
        assert.equal(v['dsl/downstream_curr_rate'], 109868);
        assert.equal(v['dsl/downstream_noise_margin'], 6.5);
        assert.equal(v['dsl/upstream_attenuation'], 11);
        assert.equal(v['dsl/downstream_power'], 15.8);
        assert.equal(v['dsl/crc_errors'], 12);
        assert.equal(v['dsl/fec_errors'], 3400);
        assert.equal(v['dsl/link_retrain'], 1);
        assert.equal(s.applyDsl(info).changes.length, 0);
        assert.deepEqual(items(s.applyDsl({...info, Status: 'Down'})), {'dsl/status': 'Down'});
    });

    test('wan: ppp info and ipv6', () => {
        const s = new FritzState();
        const r = s.applyWan(
            {
                Enable: '1',
                ConnectionStatus: 'Connected',
                Uptime: '12345',
                ExternalIPAddress: '203.0.113.5',
                LastConnectionError: 'ERROR_NONE',
                DNSServers: '1.1.1.1, 8.8.8.8',
                UpstreamMaxBitRate: '40000000',
                DownstreamMaxBitRate: '100000000',
            },
            {kind: 'ppp', ipv6: {ExternalIPv6Address: '2001:db8::1', PrefixLength: '64'}},
        );
        const v = items(r);
        assert.equal(v['wan/type'], 'ppp');
        assert.equal(v['wan/connected'], true);
        assert.equal(v['wan/status'], 'Connected');
        assert.equal(v['wan/uptime'], 12345);
        assert.equal(v['wan/external_ip'], '203.0.113.5');
        assert.equal(v['wan/external_ipv6'], '2001:db8::1');
        assert.equal(v['wan/external_ipv6_prefix_length'], 64);
        assert.equal(s.wanKind, 'ppp');
        assert.deepEqual(items(s.applyWan({ConnectionStatus: 'Disconnected'}, {kind: 'ppp'})), {
            'wan/status': 'Disconnected',
            'wan/connected': false,
        });
    });

    test('link and traffic (64 bit counters preferred)', () => {
        const s = new FritzState();
        assert.deepEqual(
            items(
                s.applyLink({
                    WANAccessType: 'DSL',
                    Layer1UpstreamMaxBitRate: '41952000',
                    Layer1DownstreamMaxBitRate: '109868000',
                    PhysicalLinkStatus: 'Up',
                }),
            ),
            {
                'wan/access_type': 'DSL',
                'wan/link/status': 'Up',
                'wan/link/upstream_max_bitrate': 41952000,
                'wan/link/downstream_max_bitrate': 109868000,
            },
        );
        const v = items(
            s.applyTraffic({
                ByteSendRate: '1234',
                ByteReceiveRate: '56789',
                PacketSendRate: '10',
                PacketReceiveRate: '20',
                TotalBytesSent: '4294967295',
                TotalBytesReceived: '100',
                X_AVM_DE_TotalBytesSent64: '9876543210',
                X_AVM_DE_TotalBytesReceived64: '123456789012',
            }),
        );
        assert.equal(v['wan/bytes_sent'], 9876543210);
        assert.equal(v['wan/bytes_received'], 123456789012);
        assert.equal(v['wan/rate_up'], 1234);
        assert.equal(v['wan/rate_down'], 56789);
        assert.equal(v['wan/packet_rate_up'], 10);
        // tr-064 counters without rates: derived from deltas
        const t = new FritzState();
        let w = items(t.applyTraffic({TotalBytesSent: '1000', TotalBytesReceived: '5000'}, {now: 10000}));
        assert.equal(w['wan/bytes_sent'], 1000);
        assert.equal(w['wan/rate_up'], undefined);
        w = items(t.applyTraffic({TotalBytesSent: '3000', TotalBytesReceived: '15000'}, {now: 20000}));
        assert.equal(w['wan/rate_up'], 200);
        assert.equal(w['wan/rate_down'], 1000);
        // counter reset → 0, not negative
        w = items(t.applyTraffic({TotalBytesSent: '100', TotalBytesReceived: '100'}, {now: 30000}));
        assert.equal(w['wan/rate_up'], 0);
        assert.equal(w['wan/rate_down'], 0);
    });

    test('wlans: items, discovery on ssid change, cleared when gone', () => {
        const s = new FritzState();
        const list = [
            {
                index: 1,
                info: {Enable: '1', Status: 'Up', SSID: 'Home', Channel: '6', Standard: 'ax', BSSID: 'AA:BB'},
                ext: {'X_AVM-DE_APType': 'normal', 'X_AVM-DE_FrequencyBand': '2400'},
                associations: '7',
            },
            {
                index: 3,
                info: {Enable: '0', Status: 'Disabled', SSID: 'Guest'},
                ext: {'X_AVM-DE_APType': 'guest'},
                associations: '0',
            },
        ];
        const r = s.applyWlans(list);
        assert.equal(r.discovery, true);
        const v = items(r);
        assert.equal(v['wlan/1/enabled'], true);
        assert.equal(v['wlan/1/ssid'], 'Home');
        assert.equal(v['wlan/1/channel'], 6);
        assert.equal(v['wlan/1/band'], '2400');
        assert.equal(v['wlan/1/guest'], false);
        assert.equal(v['wlan/1/associations'], 7);
        assert.equal(v['wlan/3/guest'], true);
        assert.equal(v['wlan/3/enabled'], false);
        assert.deepEqual(s.wlanList(), [
            {index: 1, ssid: 'Home', guest: false, band: '2400'},
            {index: 3, ssid: 'Guest', guest: true, band: undefined},
        ]);
        const r2 = s.applyWlans(list);
        assert.equal(r2.discovery, false);
        assert.equal(r2.changes.length, 0);
        const r3 = s.applyWlans([list[0]]);
        assert.equal(r3.discovery, true);
        assert.ok(r3.clear.includes('wlan/3/enabled'));
        assert.ok(r3.clear.includes('wlan/3/ssid'));
    });

    test('hosts: keys, counts, filter, rename, removal', () => {
        const s = new FritzState();
        const hosts = [
            {
                mac: 'aa:bb:cc:dd:ee:01',
                ip: '192.168.178.20',
                name: 'Phone',
                active: true,
                interface: '802.11',
                speed: 866,
                guest: false,
            },
            {
                mac: 'aa:bb:cc:dd:ee:02',
                ip: '192.168.178.21',
                name: 'Phone',
                active: false,
                interface: '802.11',
                guest: true,
            },
            {
                mac: 'aa:bb:cc:dd:ee:03',
                ip: '192.168.178.22',
                name: 'NAS',
                active: true,
                interface: 'Ethernet',
                speed: 1000,
            },
            {mac: 'aa:bb:cc:dd:ee:04', ip: '', name: '', active: false, interface: ''},
        ];
        const r = s.applyHosts(hosts);
        assert.equal(r.discovery, true);
        const v = items(r);
        assert.equal(v['host_count'], 4);
        assert.equal(v['host_count/active'], 2);
        assert.equal(v['host/Phone_EE01/present'], true);
        assert.equal(v['host/Phone_EE02/present'], false);
        assert.equal(v['host/NAS/present'], true);
        assert.deepEqual(v['host/NAS/details'], {
            mac: 'AA:BB:CC:DD:EE:03',
            name: 'NAS',
            ip: '192.168.178.22',
            interface: 'Ethernet',
            speed: 1000,
            guest: false,
            wired: true,
        });
        assert.equal(v['host/AA:BB:CC:DD:EE:04/present'], false);
        assert.equal(s.applyHosts(hosts).changes.length, 0);
        assert.equal(s.hostByKey('NAS').mac, 'AA:BB:CC:DD:EE:03');
        assert.equal(s.hostByKey('aa:bb:cc:dd:ee:01').name, 'Phone');
        assert.equal(s.hostByKey('nope'), null);
        assert.equal(s.hostList().find((h) => h.key === 'NAS').wired, true);

        // rename → old topics cleared, new published
        const r2 = s.applyHosts([{...hosts[2], name: 'Storage'}, hosts[0], hosts[1], hosts[3]]);
        assert.ok(r2.clear.includes('host/NAS/present'));
        assert.ok(r2.clear.includes('host/NAS/details'));
        assert.equal(items(r2)['host/Storage/present'], true);
        assert.equal(r2.discovery, true);

        // removal
        const r3 = s.applyHosts([hosts[0], hosts[1]]);
        assert.ok(r3.clear.includes('host/Storage/present'));
        assert.equal(items(r3)['host_count'], 2);
    });

    test('hosts: mac keys and filter', () => {
        const s = new FritzState({hostKey: 'mac', hostFilter: ['nas', 'AA:BB:CC:DD:EE:01']});
        const r = s.applyHosts([
            {mac: 'aa:bb:cc:dd:ee:01', name: 'Phone', active: true, interface: '802.11'},
            {mac: 'aa:bb:cc:dd:ee:02', name: 'Other', active: true, interface: '802.11'},
            {mac: 'aa:bb:cc:dd:ee:03', name: 'NAS', active: true, interface: 'Ethernet'},
        ]);
        const v = items(r);
        assert.equal(v['host_count'], 3);
        assert.equal(v['host/AA:BB:CC:DD:EE:01/present'], true);
        assert.equal(v['host/AA:BB:CC:DD:EE:03/present'], true);
        assert.equal(v['host/AA:BB:CC:DD:EE:02/present'], undefined);
        assert.equal(s.hostList().length, 2);
    });

    test('calls: ring → connect → disconnect', () => {
        const s = new FritzState();
        const t0 = 1700000000000;
        let r = s.applyCall({type: 'ring', id: 0, ts: t0, caller: '0123', callee: '987', line: 'SIP0'});
        let v = items(r);
        assert.deepEqual(v['call/last_incoming'], {number: '0123', own: '987', line: 'SIP0', ts: t0});
        assert.equal(v['call/ringing'], true);
        assert.equal(v['call/active'], false);
        assert.equal(v['call/count'], 1);
        assert.equal(v['event/call'].type, 'ring');
        assert.equal(r.changes.find((c) => c.item === 'event/call').retain, false);
        assert.equal(r.changes.find((c) => c.item === 'call/ringing').retain, true);

        r = s.applyCall({type: 'connect', id: 0, ts: t0 + 5000, extension: '11', number: '0123'});
        v = items(r);
        assert.equal(v['call/ringing'], false);
        assert.equal(v['call/active'], true);
        assert.equal(v['call/calls'][0].state, 'connected');

        r = s.applyCall({type: 'disconnect', id: 0, ts: t0 + 65000, duration: 60});
        v = items(r);
        assert.equal(v['call/active'], false);
        assert.equal(v['call/count'], 0);
        assert.deepEqual(v['call/calls'], []);
        assert.equal(v['call/last'].direction, 'incoming');
        assert.equal(v['call/last'].duration, 60);
        assert.equal(v['call/last'].missed, false);
        assert.equal(v['call/last'].state, 'ended');
    });

    test('calls: missed incoming, outgoing, unknown ids', () => {
        const s = new FritzState();
        s.applyCall({type: 'ring', id: 1, ts: 1, caller: '0123', callee: '987', line: 'SIP0'});
        let v = items(s.applyCall({type: 'disconnect', id: 1, ts: 2, duration: 0}));
        assert.equal(v['call/last'].missed, true);

        v = items(
            s.applyCall({type: 'call', id: 2, ts: 3, extension: '11', caller: '987', callee: '0456', line: 'SIP0'}),
        );
        assert.deepEqual(v['call/last_outgoing'], {number: '0456', own: '987', extension: '11', line: 'SIP0', ts: 3});
        assert.equal(v['call/calls'][0].direction, 'outgoing');
        v = items(s.applyCall({type: 'connect', id: 2, ts: 4, extension: '11', number: '0456'}));
        assert.equal(v['call/active'], true);
        v = items(s.applyCall({type: 'disconnect', id: 2, ts: 5, duration: 1}));
        assert.equal(v['call/last'].direction, 'outgoing');
        assert.equal(v['call/last'].missed, false);

        // disconnect of an unknown id changes nothing but counts
        const r = s.applyCall({type: 'disconnect', id: 9, ts: 6, duration: 0});
        assert.equal(items(r)['call/last'], undefined);
        assert.equal(s.applyCall({type: 'bogus', id: 1}).changes.length, 0);
    });

    test('calllist', () => {
        const s = new FritzState();
        const r = s.applyCallList([{id: 1}]);
        assert.deepEqual(items(r), {calllist: [{id: 1}]});
        assert.equal(s.applyCallList([{id: 1}]).changes.length, 0);
    });

    test('tams: items, message counts, discovery on set change', () => {
        const s = new FritzState();
        const msgs = [
            {index: 3, number: '0301', name: 'Max', new: true, ts: 1},
            {index: 2, number: '0151', name: '', new: false, ts: 0},
        ];
        const r = s.applyTams({
            running: true,
            capacity: 38,
            tams: [
                {index: 0, display: true, enabled: true, name: 'AB', messages: msgs},
                {index: 1, display: false, enabled: false, name: ''},
            ],
        });
        assert.equal(r.discovery, true);
        const v = items(r);
        assert.equal(v['tam/running'], true);
        assert.equal(v['tam/capacity'], 38);
        assert.equal(v['tam/0/enabled'], true);
        assert.equal(v['tam/0/name'], 'AB');
        assert.equal(v['tam/0/messages'], 2);
        assert.equal(v['tam/0/new_messages'], 1);
        assert.deepEqual(v['tam/0/last_message'], msgs[0]);
        assert.deepEqual(v['tam/0/message_list'], msgs);
        assert.equal(v['tam/1/enabled'], undefined);
        assert.deepEqual(s.tamList(), [{index: 0, name: 'AB'}]);
        // messages unreadable: counts untouched
        const r2 = s.applyTams({
            running: true,
            capacity: 38,
            tams: [{index: 0, display: true, enabled: false, name: 'AB', messages: null}],
        });
        assert.deepEqual(items(r2), {'tam/0/enabled': false});
        assert.equal(r2.discovery, false);
        // tam gone → cleared
        const r3 = s.applyTams({running: false, capacity: 0, tams: []});
        assert.ok(r3.clear.includes('tam/0/enabled'));
        assert.ok(r3.clear.includes('tam/0/message_list'));
        assert.equal(r3.discovery, true);
    });

    test('deflections', () => {
        const s = new FritzState();
        const list = [
            {
                id: 0,
                enabled: true,
                type: 'fromNumber',
                number: '0301',
                to: '0151',
                mode: 'eImmediately',
                outgoing: '',
                phonebook: null,
            },
            {
                id: 1,
                enabled: false,
                type: 'fromAll',
                number: '',
                to: '**600',
                mode: 'eNoResponse',
                outgoing: '',
                phonebook: 0,
            },
        ];
        const r = s.applyDeflections(list);
        assert.equal(r.discovery, true);
        const v = items(r);
        assert.equal(v['deflection/0/enabled'], true);
        assert.equal(v['deflection/1/enabled'], false);
        assert.deepEqual(v['deflection/0/details'], {
            type: 'fromNumber',
            number: '0301',
            to: '0151',
            mode: 'eImmediately',
            outgoing: '',
            phonebook: null,
        });
        assert.equal(s.applyDeflections(list).changes.length, 0);
        assert.deepEqual(s.deflectionList()[1], {id: 1, type: 'fromAll', number: '', to: '**600'});
        const r2 = s.applyDeflections([{...list[0], enabled: false}]);
        assert.deepEqual(items(r2), {'deflection/0/enabled': false});
        assert.ok(r2.clear.includes('deflection/1/details'));
    });
});
