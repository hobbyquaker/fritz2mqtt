import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';

import {parseLine, parseTimestamp, CallMonitor} from '../lib/callmonitor.js';

describe('callmonitor parseLine', () => {
    test('timestamp is local time', () => {
        assert.equal(parseTimestamp('26.08.26 17:42:13'), new Date(2026, 7, 26, 17, 42, 13).getTime());
        assert.equal(parseTimestamp('garbage'), undefined);
    });

    test('ring / call / connect / disconnect', () => {
        assert.deepEqual(parseLine('26.08.26 17:42:13;RING;0;01234567;9876543;SIP0;'), {
            type: 'ring',
            id: 0,
            ts: new Date(2026, 7, 26, 17, 42, 13).getTime(),
            caller: '01234567',
            callee: '9876543',
            line: 'SIP0',
        });
        assert.deepEqual(parseLine('26.08.26 17:42:13;CALL;1;11;9876543;01234567;SIP0;'), {
            type: 'call',
            id: 1,
            ts: new Date(2026, 7, 26, 17, 42, 13).getTime(),
            extension: '11',
            caller: '9876543',
            callee: '01234567',
            line: 'SIP0',
        });
        assert.deepEqual(parseLine('26.08.26 17:42:20;CONNECT;0;11;01234567;'), {
            type: 'connect',
            id: 0,
            ts: new Date(2026, 7, 26, 17, 42, 20).getTime(),
            extension: '11',
            number: '01234567',
        });
        assert.deepEqual(parseLine('26.08.26 17:45:01;DISCONNECT;0;168;\r'), {
            type: 'disconnect',
            id: 0,
            ts: new Date(2026, 7, 26, 17, 45, 1).getTime(),
            duration: 168,
        });
        assert.equal(parseLine('26.08.26 17:45:01;WHATEVER;0;'), null);
        assert.equal(parseLine(''), null);
    });
});

class FakeSocket extends EventEmitter {
    setEncoding() {}
    setKeepAlive() {}
    setTimeout() {}
    destroy() {
        this.destroyed = true;
        this.emit('close');
    }
}

describe('CallMonitor', () => {
    test('emits parsed events per line, reconnects after close', async () => {
        const sockets = [];
        const connect = () => {
            const s = new FakeSocket();
            sockets.push(s);
            return s;
        };
        const monitor = new CallMonitor({host: 'fritz.box', connect, reconnectMs: 5});
        const events = [];
        const opens = [];
        monitor.on('event', (e) => events.push(e));
        monitor.on('open', () => opens.push(1));
        monitor.start();
        assert.equal(sockets.length, 1);
        sockets[0].emit('connect');
        assert.equal(monitor.connected, true);
        sockets[0].emit('data', '26.08.26 17:42:13;RING;0;0123;987;SIP0;\r\n26.08.26 17:42:20;CONN');
        sockets[0].emit('data', 'ECT;0;11;0123;\r\n');
        assert.deepEqual(
            events.map((e) => e.type),
            ['ring', 'connect'],
        );
        sockets[0].emit('close');
        assert.equal(monitor.connected, false);
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(sockets.length, 2);
        sockets[1].emit('connect');
        assert.equal(opens.length, 2);
        monitor.stop();
        assert.equal(sockets[1].destroyed, true);
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(sockets.length, 2);
    });
});
