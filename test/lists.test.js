import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {parseCallList, parseHostList, hostFromEntry, listPath, parseCallDate, parseDuration} from '../lib/lists.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('lists', () => {
    test('listPath: absolute url → path of our own base, params appended', () => {
        assert.equal(
            listPath('https://fritz.box:49443/calllist.lua?sid=abc', {max: 20, days: undefined}),
            '/calllist.lua?sid=abc&max=20',
        );
        assert.equal(listPath('/hostlist.lua?sid=abc'), '/hostlist.lua?sid=abc');
        assert.equal(listPath('/x.lua', {days: 7}), '/x.lua?days=7');
    });

    test('call date and duration', () => {
        assert.equal(parseCallDate('26.08.26 17:42'), new Date(2026, 7, 26, 17, 42).getTime());
        assert.equal(parseCallDate(''), undefined);
        assert.equal(parseDuration('1:03'), 3780);
        assert.equal(parseDuration('0:00'), 0);
        assert.equal(parseDuration(''), undefined);
    });

    test('call list', () => {
        const calls = parseCallList(fixture('calllist.xml'));
        assert.equal(calls.length, 3);
        assert.deepEqual(calls[0], {
            id: 105,
            type: 'missed',
            number: '0301234567',
            name: 'Max Mustermann',
            own: '987654',
            device: '',
            port: -1,
            ts: new Date(2026, 7, 26, 17, 42).getTime(),
            duration: 0,
            path: null,
        });
        assert.equal(calls[1].type, 'outgoing');
        assert.equal(calls[1].number, '0401112233');
        assert.equal(calls[1].own, '987654');
        assert.equal(calls[1].device, 'Küche');
        assert.equal(calls[1].duration, 3780);
        assert.equal(calls[2].type, 'incoming');
        assert.equal(calls[2].port, 10);
        assert.equal(calls[2].path, '/download.lua?path=/var/media/ftp/USB/FRITZ/voicebox/rec/rec.0.000');
        // outgoing: own number from CallerNumber when present
        const out = parseCallList(
            '<root><Call><Id>1</Id><Type>3</Type><Called>0123</Called><Caller>SIP: 98765</Caller><CallerNumber>98765</CallerNumber></Call></root>',
        )[0];
        assert.equal(out.number, '0123');
        assert.equal(out.own, '98765');
        assert.deepEqual(parseCallList('<root><timestamp>1</timestamp></root>'), []);
        assert.equal(
            parseCallList('<root><Call><Id>1</Id><Type>9</Type><Caller>1</Caller></Call></root>')[0].type,
            'active_incoming',
        );
    });

    test('host list', () => {
        const hosts = parseHostList(fixture('hostlist.xml'));
        assert.deepEqual(hosts, [
            {
                mac: 'AA:BB:CC:DD:EE:01',
                ip: '192.168.178.20',
                name: 'phone',
                active: true,
                interface: '802.11',
                speed: 866,
                guest: false,
            },
            {
                mac: 'AA:BB:CC:DD:EE:03',
                ip: '192.168.178.22',
                name: 'nas',
                active: false,
                interface: 'Ethernet',
                speed: 1000,
                guest: false,
            },
            {
                mac: 'AA:BB:CC:DD:EE:05',
                ip: '192.168.179.5',
                name: 'guest-laptop',
                active: true,
                interface: '802.11',
                speed: undefined,
                guest: true,
            },
        ]);
        assert.deepEqual(parseHostList('<List></List>'), []);
    });

    test('host entry fallback', () => {
        assert.deepEqual(
            hostFromEntry({
                IPAddress: '10.0.0.2',
                MACAddress: 'aa:bb:cc:00:00:01',
                Active: '1',
                HostName: 'pc',
                InterfaceType: 'Ethernet',
            }),
            {
                mac: 'AA:BB:CC:00:00:01',
                ip: '10.0.0.2',
                name: 'pc',
                active: true,
                interface: 'Ethernet',
                speed: undefined,
                guest: false,
            },
        );
    });
});
