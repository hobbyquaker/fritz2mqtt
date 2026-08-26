import {parseConfig} from 'mqtt-interfaces-core';
import pkg from './package.json' with {type: 'json'};

export const OPTIONS = {
    address: {
        alias: 'a',
        type: 'string',
        describe: 'fritz!box address (hostname or ip, optionally with port)',
        default: 'fritz.box',
    },
    username: {
        type: 'string',
        describe:
            'fritz!box user (System → FRITZ!Box Users; needs "FRITZ!Box settings" for dsl/wan and the set topics); default: the user the box used last',
    },
    password: {
        type: 'string',
        describe: 'fritz!box password',
        secret: true,
        demandOption: true,
    },
    tls: {
        type: 'boolean',
        describe: 'talk tr-064 over https (port 49443) instead of http (port 49000)',
        default: false,
    },
    insecure: {
        alias: 'k',
        type: 'boolean',
        describe: 'with --tls: accept the box certificate without validation (self-signed certificates)',
        default: false,
    },
    'poll-interval': {
        type: 'number',
        describe: 'seconds between polls of dsl, wan, wlan, device and host status',
        default: 60,
    },
    'traffic-interval': {
        type: 'number',
        describe: 'seconds between polls of the wan traffic counters and rates (0 = off)',
        default: 10,
    },
    dsl: {
        type: 'boolean',
        describe: 'publish dsl line status (--no-dsl for cable, fiber and lte boxes)',
        default: true,
    },
    wlan: {
        type: 'boolean',
        describe: 'publish wlan status and accept wlan/<n>/enabled commands',
        default: true,
    },
    hosts: {
        type: 'boolean',
        describe: 'publish lan host presence (host/<key>/present, host/<key>/details)',
        default: true,
    },
    'host-key': {
        type: 'string',
        describe: 'how hosts are named in topics: name (hostname, else mac) or mac',
        choices: ['name', 'mac'],
        default: 'name',
    },
    'host-filter': {
        type: 'array',
        describe: 'only publish these hosts (mac addresses or hostnames, comma separated); default: all',
        default: [],
    },
    'ha-hosts': {
        type: 'boolean',
        describe: 'announce a device_tracker per host to Home Assistant (--no-ha-hosts: box only)',
        default: false,
    },
    callmonitor: {
        type: 'boolean',
        describe: 'connect to the call monitor on port 1012 for realtime call events (enable it with #96*5*)',
        default: true,
    },
    calllist: {
        type: 'boolean',
        describe: 'publish the call list (calllist item, refreshed after every call and on set/calllist/refresh)',
        default: true,
    },
    'calllist-max': {
        type: 'number',
        describe: 'number of entries in the call list and in each answering machine message list',
        default: 20,
    },
    'calllist-days': {
        type: 'number',
        describe: 'only calls of the last n days in the call list (0 = no limit)',
        default: 0,
    },
    tam: {
        type: 'boolean',
        describe: 'publish the answering machines (tam/<n>/*) and accept tam/<n>/enabled commands',
        default: true,
    },
    deflections: {
        type: 'boolean',
        describe: 'publish call deflections (deflection/<id>/*) and accept deflection/<id>/enabled commands',
        default: true,
    },
    'raw-set': {
        type: 'boolean',
        describe: 'accept arbitrary tr-064 actions on <name>/set/raw (security surface, off by default)',
        default: false,
    },
};

export function check(argv) {
    if (argv.pollInterval < 5) {
        throw new Error('--poll-interval must be >= 5 seconds');
    }
    if (argv.trafficInterval < 0 || (argv.trafficInterval > 0 && argv.trafficInterval < 1)) {
        throw new Error('--traffic-interval must be 0 or >= 1 seconds');
    }
    if (argv.calllistMax < 1 || argv.calllistMax > 999) {
        throw new Error('--calllist-max must be between 1 and 999');
    }
    if (argv.calllistDays < 0) {
        throw new Error('--calllist-days must be >= 0');
    }
    return true;
}

export default parseConfig({
    pkg,
    options: OPTIONS,
    defaults: {name: 'fritz'},
    check,
    examples: [
        ['$0 --username fritz2mqtt --password s3cret -u mqtt://broker', 'run in the foreground (box at fritz.box)'],
        [
            'sudo $0 --install -n fritz -a 192.168.178.1 --username fritz2mqtt --password s3cret -u mqtt://broker',
            'install as service fritz2mqtt@fritz',
        ],
    ],
});
