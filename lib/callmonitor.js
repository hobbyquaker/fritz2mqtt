/**
 * FRITZ!Box call monitor: a plain TCP text stream on port 1012 (enable it once by dialling
 * #96*5* on a phone connected to the box, #96*4* disables it). One line per event, `;`-separated:
 *
 *   26.08.26 17:42:13;RING;0;01234567;9876543;SIP0;          incoming: caller, called number, line
 *   26.08.26 17:42:13;CALL;1;11;9876543;01234567;SIP0;       outgoing: extension, own number, callee, line
 *   26.08.26 17:42:20;CONNECT;0;11;01234567;                 answered: extension, remote number
 *   26.08.26 17:45:01;DISCONNECT;0;168;                      ended: duration in seconds
 *
 * `parseLine()` is pure; `CallMonitor` keeps the socket open with a fixed-delay reconnect and
 * emits `event` (parsed line), `open`, `close`, `error`.
 */

import net from 'node:net';
import {EventEmitter} from 'node:events';

export const CALLMONITOR_PORT = 1012;
const RECONNECT_MS = 10000;

/** `26.08.26 17:42:13` → ms since epoch (local time), or `undefined`. */
export function parseTimestamp(text) {
    const m = String(text || '').match(/^(\d{2})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!m) {
        return undefined;
    }
    const [, dd, mm, yy, hh, mi, ss] = m.map(Number);
    return new Date(2000 + yy, mm - 1, dd, hh, mi, ss).getTime();
}

/**
 * @returns {null | {type: 'ring'|'call'|'connect'|'disconnect', id: number, ts: number|undefined,
 *   caller?, callee?, line?, extension?, number?, duration?}}
 */
export function parseLine(line) {
    const f = String(line || '')
        .trim()
        .split(';');
    if (f.length < 3) {
        return null;
    }
    const ts = parseTimestamp(f[0]);
    const id = Number(f[2]);
    switch (f[1]) {
        case 'RING':
            return {type: 'ring', id, ts, caller: f[3] || '', callee: f[4] || '', line: f[5] || ''};
        case 'CALL':
            return {
                type: 'call',
                id,
                ts,
                extension: f[3] || '',
                caller: f[4] || '',
                callee: f[5] || '',
                line: f[6] || '',
            };
        case 'CONNECT':
            return {type: 'connect', id, ts, extension: f[3] || '', number: f[4] || ''};
        case 'DISCONNECT':
            return {type: 'disconnect', id, ts, duration: Number(f[3]) || 0};
        default:
            return null;
    }
}

export class CallMonitor extends EventEmitter {
    /**
     * @param {object} o
     * @param {string} o.host
     * @param {number} [o.port]
     * @param {object} [o.log]
     * @param {Function} [o.connect] `net.connect` replacement for tests
     * @param {number} [o.reconnectMs]
     */
    constructor({host, port = CALLMONITOR_PORT, log, connect, reconnectMs = RECONNECT_MS}) {
        super();
        this.host = host;
        this.port = port;
        this.log = log || {debug() {}, info() {}, warn() {}, error() {}};
        this.netConnect = connect || net.connect;
        this.reconnectMs = reconnectMs;
        this.socket = null;
        this.timer = null;
        this.stopped = false;
        this.connected = false;
        this.buffer = '';
        this.lastError = null;
    }

    start() {
        this.stopped = false;
        this.connect();
    }

    connect() {
        if (this.stopped || this.socket) {
            return;
        }
        this.log.debug('callmonitor connecting to', `${this.host}:${this.port}`);
        const socket = this.netConnect({host: this.host, port: this.port});
        this.socket = socket;
        this.buffer = '';
        socket.setEncoding('utf8');
        // the box sends nothing while idle; tcp keepalive notices a dead connection (node-red: 118 s)
        socket.setKeepAlive(true, 118000);
        socket.on('connect', () => {
            this.connected = true;
            this.lastError = null;
            this.log.info('callmonitor connected to', `${this.host}:${this.port}`);
            this.emit('open');
        });
        socket.on('data', (chunk) => this.onData(chunk));
        socket.on('error', (err) => {
            const message = err.message || String(err);
            if (message !== this.lastError) {
                this.log.warn('callmonitor', `${this.host}:${this.port}:`, message, '(is it enabled? dial #96*5*)');
                this.lastError = message;
            } else {
                this.log.debug('callmonitor error again:', message);
            }
            if (this.listenerCount('error') > 0) {
                this.emit('error', err);
            }
        });
        socket.on('close', () => {
            const wasConnected = this.connected;
            this.connected = false;
            this.socket = null;
            if (wasConnected) {
                this.log.info('callmonitor disconnected');
                this.emit('close');
            }
            this.scheduleReconnect();
        });
    }

    onData(chunk) {
        this.buffer += chunk;
        let i;
        while ((i = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.slice(0, i).trim();
            this.buffer = this.buffer.slice(i + 1);
            if (!line) {
                continue;
            }
            this.log.debug('callmonitor <', line);
            const event = parseLine(line);
            if (event) {
                this.emit('event', event, line);
            } else {
                this.log.warn('callmonitor unknown line:', line);
            }
        }
    }

    scheduleReconnect() {
        if (this.stopped || this.timer) {
            return;
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            this.connect();
        }, this.reconnectMs);
    }

    stop() {
        this.stopped = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this.connected = false;
    }
}
