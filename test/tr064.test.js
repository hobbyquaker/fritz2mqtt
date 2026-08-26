import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
    Tr064Client,
    Tr064Error,
    baseUrl,
    digestHeader,
    parseDigestChallenge,
    soapEnvelope,
    parseSoapResponse,
    parseDescription,
    normalizeServiceType,
    parseUserList,
    stripNew,
} from '../lib/tr064.js';

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

const DESCRIPTION = `<?xml version="1.0"?>
<root xmlns="urn:dslforum-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:dslforum-org:device:InternetGatewayDevice:1</deviceType>
    <friendlyName>FRITZ!Box 7590</friendlyName>
    <manufacturer>AVM</manufacturer>
    <modelName>FRITZ!Box 7590</modelName>
    <modelNumber>avm</modelNumber>
    <serviceList>
      <service>
        <serviceType>urn:dslforum-org:service:DeviceInfo:1</serviceType>
        <serviceId>urn:DeviceInfo-com:serviceId:DeviceInfo1</serviceId>
        <controlURL>/upnp/control/deviceinfo</controlURL>
        <eventSubURL>/upnp/control/deviceinfo</eventSubURL>
        <SCPDURL>/deviceinfoSCPD.xml</SCPDURL>
      </service>
    </serviceList>
    <deviceList>
      <device>
        <deviceType>urn:dslforum-org:device:LANDevice:1</deviceType>
        <serviceList>
          <service>
            <serviceType>urn:dslforum-org:service:WLANConfiguration:1</serviceType>
            <serviceId>urn:WLANConfiguration-com:serviceId:WLANConfiguration1</serviceId>
            <controlURL>/upnp/control/wlanconfig1</controlURL>
            <SCPDURL>/wlanconfigSCPD.xml</SCPDURL>
          </service>
        </serviceList>
        <deviceList>
          <device>
            <deviceType>urn:dslforum-org:device:WANConnectionDevice:1</deviceType>
            <serviceList>
              <service>
                <serviceType>urn:dslforum-org:service:WANDSLInterfaceConfig:1</serviceType>
                <serviceId>urn:WANDSLIfConfig-com:serviceId:WANDSLInterfaceConfig1</serviceId>
                <controlURL>/upnp/control/wandslifconfig1</controlURL>
                <SCPDURL>/wandslifconfigSCPD.xml</SCPDURL>
              </service>
            </serviceList>
          </device>
        </deviceList>
      </device>
    </deviceList>
  </device>
</root>`;

const IGD_DESCRIPTION = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device>
    <deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType>
    <friendlyName>FRITZ!Box 7590</friendlyName>
    <deviceList>
      <device>
        <deviceType>urn:schemas-upnp-org:device:WANDevice:1</deviceType>
        <serviceList>
          <service>
            <serviceType>urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1</serviceType>
            <serviceId>urn:upnp-org:serviceId:WANCommonIFC1</serviceId>
            <controlURL>/igdupnp/control/WANCommonIFC1</controlURL>
            <SCPDURL>/igdicfgSCPD.xml</SCPDURL>
          </service>
        </serviceList>
      </device>
    </deviceList>
  </device>
</root>`;

const soapResponse = (action, service, args) =>
    '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<s:Body><u:${action}Response xmlns:u="${service}">` +
    Object.entries(args)
        .map(([k, v]) => `<${k}>${v}</${k}>`)
        .join('') +
    `</u:${action}Response></s:Body></s:Envelope>`;

const FAULT =
    '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>' +
    '<faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:dslforum-org:control-1-0">' +
    '<errorCode>401</errorCode><errorDescription>Invalid Action</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>';

/** A fake box: digest auth on POST, description without auth, records requests. */
function fakeBox({username = 'user', password = 'pw', responses = {}, igd = false} = {}) {
    const requests = [];
    const realm = 'F!Box SOAP-Auth';
    const nonce = 'abc123';
    const request = async ({method, url, headers = {}, body}) => {
        requests.push({method, url, headers, body});
        const path = new URL(url).pathname;
        if (path === '/tr64desc.xml') {
            return {status: 200, headers: {}, body: DESCRIPTION};
        }
        if (path === '/igddesc.xml') {
            return igd ? {status: 200, headers: {}, body: IGD_DESCRIPTION} : {status: 404, headers: {}, body: ''};
        }
        if (path.startsWith('/igdupnp/')) {
            // the igd tree never asks for authentication
            const action = (headers.soapaction || '').match(/#([\w-]+)"/)[1];
            return {status: 200, headers: {}, body: responses[action] || FAULT};
        }
        const auth = headers.authorization;
        const noAuth = path === '/upnp/control/lanconfigsecurity';
        if (!auth && !noAuth) {
            return {
                status: 401,
                headers: {'www-authenticate': `Digest realm="${realm}", nonce="${nonce}", algorithm=MD5, qop="auth"`},
                body: '',
            };
        }
        if (!noAuth) {
            const p = parseDigestChallenge(auth);
            const ha1 = md5(`${username}:${realm}:${password}`);
            const ha2 = md5(`${method}:${path}`);
            const expected = md5(`${ha1}:${nonce}:${p.nc}:${p.cnonce}:auth:${ha2}`);
            if (p.response !== expected || p.username !== username) {
                return {
                    status: 401,
                    headers: {'www-authenticate': `Digest realm="${realm}", nonce="${nonce}", qop="auth"`},
                    body: '',
                };
            }
        }
        const action = (headers.soapaction || '').match(/#([\w-]+)"/)[1];
        const responder = responses[action];
        if (!responder) {
            return {status: 500, headers: {}, body: FAULT};
        }
        return typeof responder === 'function' ? responder({body, path}) : {status: 200, headers: {}, body: responder};
    };
    return {request, requests};
}

describe('tr064 helpers', () => {
    test('baseUrl', () => {
        assert.equal(baseUrl({address: 'fritz.box'}), 'http://fritz.box:49000');
        assert.equal(baseUrl({address: 'fritz.box', tls: true}), 'https://fritz.box:49443');
        assert.equal(baseUrl({address: '192.168.178.1:49000'}), 'http://192.168.178.1:49000');
        assert.equal(baseUrl({address: 'https://fritz.box'}), 'https://fritz.box:49443');
        assert.equal(baseUrl({address: 'fritz.box', port: 8000}), 'http://fritz.box:8000');
        assert.throws(() => baseUrl({address: ''}), /empty/);
    });

    test('normalizeServiceType', () => {
        assert.equal(normalizeServiceType('DeviceInfo'), 'urn:dslforum-org:service:DeviceInfo:1');
        assert.equal(normalizeServiceType('WLANConfiguration:2'), 'urn:dslforum-org:service:WLANConfiguration:2');
        assert.equal(normalizeServiceType('X_AVM-DE_OnTel'), 'urn:dslforum-org:service:X_AVM-DE_OnTel:1');
        assert.equal(normalizeServiceType('urn:dslforum-org:service:Hosts:1'), 'urn:dslforum-org:service:Hosts:1');
        assert.equal(
            normalizeServiceType('igd:WANCommonInterfaceConfig:1'),
            'urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1',
        );
    });

    test('parseUserList', () => {
        assert.equal(
            parseUserList('<List><Username>anna</Username><Username last_user="1">j&amp;n</Username></List>'),
            'j&n',
        );
        assert.equal(parseUserList('<List><Username>anna</Username></List>'), 'anna');
        assert.equal(parseUserList('<List></List>'), null);
    });

    test('digest challenge and response (RFC 2617 example)', () => {
        const challenge = parseDigestChallenge(
            'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
        );
        assert.equal(challenge.realm, 'testrealm@host.com');
        assert.equal(challenge.qop, 'auth,auth-int');
        const header = digestHeader({
            username: 'Mufasa',
            password: 'Circle Of Life',
            method: 'GET',
            uri: '/dir/index.html',
            challenge,
            nc: 1,
            cnonce: '0a4f113b',
        });
        assert.match(header, /response="6629fae49393a05397450978507c4ef1"/);
        assert.match(header, /^Digest username="Mufasa", realm="testrealm@host.com"/);
        assert.match(header, /qop=auth, nc=00000001, cnonce="0a4f113b"/);
        assert.match(header, /opaque="5ccc069c403ebaf9f0171e9517f40e41"/);
        assert.equal(parseDigestChallenge('Basic realm="x"'), null);
    });

    test('digest without qop', () => {
        const header = digestHeader({
            username: 'u',
            password: 'p',
            method: 'POST',
            uri: '/x',
            challenge: {realm: 'r', nonce: 'n'},
        });
        assert.match(header, new RegExp(`response="${md5(md5('u:r:p') + ':n:' + md5('POST:/x'))}"`));
        assert.doesNotMatch(header, /qop/);
    });

    test('soap envelope', () => {
        const xml = soapEnvelope('urn:dslforum-org:service:WLANConfiguration:1', 'SetEnable', {
            NewEnable: 1,
            NewX: 'a<b',
        });
        assert.match(
            xml,
            /<u:SetEnable xmlns:u="urn:dslforum-org:service:WLANConfiguration:1"><NewEnable>1<\/NewEnable><NewX>a&lt;b<\/NewX><\/u:SetEnable>/,
        );
        assert.match(xml, /^<\?xml version="1.0" encoding="utf-8"\?><s:Envelope/);
    });

    test('soap response and faults', () => {
        const out = parseSoapResponse(
            soapResponse('GetInfo', 'urn:dslforum-org:service:DeviceInfo:1', {
                NewModelName: 'FRITZ!Box 7590',
                NewUpTime: '12',
            }),
            'GetInfo',
        );
        assert.deepEqual(out, {NewModelName: 'FRITZ!Box 7590', NewUpTime: '12'});
        assert.deepEqual(stripNew(out), {ModelName: 'FRITZ!Box 7590', UpTime: '12'});
        assert.deepEqual(parseSoapResponse(soapResponse('Reboot', 'urn:x', {}), 'Reboot'), {});
        assert.throws(
            () => parseSoapResponse(FAULT, 'GetInfo'),
            (err) => {
                assert.ok(err instanceof Tr064Error);
                assert.equal(err.code, 401);
                assert.match(err.message, /Invalid Action \(401\)/);
                return true;
            },
        );
        assert.throws(() => parseSoapResponse('<html>nope</html>', 'GetInfo'), /no SOAP body/);
    });

    test('device description: services of nested devices', () => {
        const {services, info} = parseDescription(DESCRIPTION);
        assert.equal(services.size, 3);
        assert.deepEqual(services.get('urn:dslforum-org:service:WANDSLInterfaceConfig:1'), {
            type: 'urn:dslforum-org:service:WANDSLInterfaceConfig:1',
            id: 'urn:WANDSLIfConfig-com:serviceId:WANDSLInterfaceConfig1',
            controlUrl: '/upnp/control/wandslifconfig1',
            scpdUrl: '/wandslifconfigSCPD.xml',
            igd: false,
        });
        assert.equal(info.modelName, 'FRITZ!Box 7590');
        assert.equal(info.manufacturer, 'AVM');
    });
});

describe('Tr064Client', () => {
    test('describe, call with digest auth, nonce reuse', async () => {
        const box = fakeBox({
            responses: {
                GetInfo: soapResponse('GetInfo', 'urn:dslforum-org:service:DeviceInfo:1', {
                    NewModelName: 'FRITZ!Box 7590',
                    NewUpTime: '4711',
                }),
            },
        });
        const client = new Tr064Client({address: 'fritz.box', username: 'user', password: 'pw', request: box.request});
        const info = await client.call('DeviceInfo', 'GetInfo');
        assert.deepEqual(info, {ModelName: 'FRITZ!Box 7590', UpTime: '4711'});
        // descriptions (igd missing), unauthenticated POST, authenticated POST
        assert.deepEqual(
            box.requests.map((r) => [r.method, new URL(r.url).pathname, Boolean(r.headers.authorization)]),
            [
                ['GET', '/tr64desc.xml', false],
                ['GET', '/igddesc.xml', false],
                ['POST', '/upnp/control/deviceinfo', false],
                ['POST', '/upnp/control/deviceinfo', true],
            ],
        );
        assert.equal(box.requests[3].headers.soapaction, '"urn:dslforum-org:service:DeviceInfo:1#GetInfo"');
        assert.match(box.requests[3].headers['content-type'], /text\/xml/);

        await client.call('DeviceInfo', 'GetInfo');
        // the nonce is reused: no extra 401 round trip
        assert.equal(box.requests.length, 5);
        assert.match(box.requests[4].headers.authorization, /nc=00000002/);
        assert.equal(await client.hasService('WLANConfiguration:1'), true);
        assert.equal(await client.hasService('WLANConfiguration:2'), false);
        assert.equal(await client.hasService('igd:WANCommonInterfaceConfig:1'), false);
    });

    test('igd services are merged and called without authentication', async () => {
        const box = fakeBox({
            igd: true,
            responses: {
                GetAddonInfos: soapResponse(
                    'GetAddonInfos',
                    'urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1',
                    {
                        NewByteSendRate: '10',
                        NewX_AVM_DE_TotalBytesSent64: '123',
                    },
                ),
            },
        });
        const client = new Tr064Client({address: 'fritz.box', username: 'user', password: 'pw', request: box.request});
        assert.equal(await client.hasService('igd:WANCommonInterfaceConfig:1'), true);
        assert.equal(await client.hasService('WANCommonInterfaceConfig:1'), false);
        const out = await client.call('igd:WANCommonInterfaceConfig:1', 'GetAddonInfos');
        assert.deepEqual(out, {ByteSendRate: '10', X_AVM_DE_TotalBytesSent64: '123'});
        const post = box.requests.filter((r) => r.method === 'POST');
        assert.equal(post.length, 1);
        assert.equal(new URL(post[0].url).pathname, '/igdupnp/control/WANCommonIFC1');
        assert.equal(post[0].headers.authorization, undefined);
    });

    test('lastUsername', async () => {
        const box = fakeBox({
            responses: {
                'X_AVM-DE_GetUserList': soapResponse('X_AVM-DE_GetUserList', 'x', {
                    'NewX_AVM-DE_UserList':
                        '&lt;List&gt;&lt;Username last_user="1"&gt;john&lt;/Username&gt;&lt;/List&gt;',
                }),
            },
        });
        // LANConfigSecurity is not in the test description: add it
        const request = async (req) => {
            const res = await box.request(req);
            if (new URL(req.url).pathname === '/tr64desc.xml') {
                res.body = res.body.replace(
                    '</serviceList>',
                    '<service><serviceType>urn:dslforum-org:service:LANConfigSecurity:1</serviceType><controlURL>/upnp/control/lanconfigsecurity</controlURL></service></serviceList>',
                );
            }
            return res;
        };
        const client = new Tr064Client({address: 'fritz.box', request});
        assert.equal(await client.lastUsername(), 'john');
    });

    test('wrong password → Tr064Error 401', async () => {
        const box = fakeBox({responses: {GetInfo: soapResponse('GetInfo', 'x', {})}});
        const client = new Tr064Client({
            address: 'fritz.box',
            username: 'user',
            password: 'nope',
            request: box.request,
        });
        await assert.rejects(client.call('DeviceInfo', 'GetInfo'), (err) => {
            assert.ok(err instanceof Tr064Error);
            assert.equal(err.status, 401);
            assert.match(err.message, /authentication failed/);
            return true;
        });
    });

    test('soap fault → Tr064Error with code and service', async () => {
        const box = fakeBox();
        const client = new Tr064Client({address: 'fritz.box', username: 'user', password: 'pw', request: box.request});
        await assert.rejects(client.call('DeviceInfo', 'Nope'), (err) => {
            assert.equal(err.code, 401);
            assert.equal(err.service, 'urn:dslforum-org:service:DeviceInfo:1');
            assert.equal(err.action, 'Nope');
            return true;
        });
        await assert.rejects(client.call('Hosts', 'GetInfo'), /not offered by this box/);
    });

    test('description without services', async () => {
        const request = async () => ({status: 200, headers: {}, body: '<root><device></device></root>'});
        const client = new Tr064Client({address: 'fritz.box', request});
        await assert.rejects(client.describe(), /no services/);
        const down = async () => ({status: 404, headers: {}, body: ''});
        await assert.rejects(new Tr064Client({address: 'fritz.box', request: down}).describe(), /http 404/);
    });

    test('get() fetches a session path without auth', async () => {
        const box = fakeBox();
        const client = new Tr064Client({address: 'fritz.box', request: box.request});
        box.request2 = box.request;
        const request = async (req) =>
            new URL(req.url).pathname === '/calllist.lua'
                ? {status: 200, headers: {}, body: '<root/>'}
                : box.request(req);
        client.transport = request;
        assert.equal(await client.get('/calllist.lua?sid=abc&max=10'), '<root/>');
    });
});
