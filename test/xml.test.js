import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {parseXml, unescapeXml, escapeXml, asArray, find} from '../lib/xml.js';

describe('xml', () => {
    test('nested elements, repeats, text', () => {
        const doc = parseXml('<?xml version="1.0"?><a><b>1</b><b>2</b><c><d>x</d></c><e/></a>');
        assert.deepEqual(doc, {a: {b: ['1', '2'], c: {d: 'x'}, e: ''}});
    });

    test('namespace prefixes are dropped, attributes ignored', () => {
        const doc = parseXml(
            '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="x">' +
                '<s:Body><u:GetInfoResponse xmlns:u="urn:dslforum-org:service:DeviceInfo:1">' +
                '<NewModelName>FRITZ!Box 7590</NewModelName><NewUpTime>1234</NewUpTime>' +
                '</u:GetInfoResponse></s:Body></s:Envelope>',
        );
        assert.deepEqual(doc.Envelope.Body.GetInfoResponse, {NewModelName: 'FRITZ!Box 7590', NewUpTime: '1234'});
    });

    test('entities, cdata, comments', () => {
        const doc = parseXml('<r><!-- c --><t>a &amp; b &lt; &#65; &#x42;</t><c><![CDATA[<raw> & stuff]]></c></r>');
        assert.deepEqual(doc, {r: {t: 'a & b < A B', c: '<raw> & stuff'}});
    });

    test('whitespace between elements is ignored, inside text kept', () => {
        const doc = parseXml('<r>\n  <a> x y </a>\n</r>');
        assert.deepEqual(doc, {r: {a: ' x y '}});
    });

    test('unescape / escape', () => {
        assert.equal(unescapeXml('&quot;a&apos;&unknown;'), '"a\'&unknown;');
        assert.equal(escapeXml('<a href="x">\'&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
    });

    test('asArray and find', () => {
        assert.deepEqual(asArray(undefined), []);
        assert.deepEqual(asArray(''), []);
        assert.deepEqual(asArray('x'), ['x']);
        assert.deepEqual(asArray(['x']), ['x']);
        const doc = parseXml('<a><b><c>1</c></b><d><c>2</c></d></a>');
        assert.equal(find(doc, 'c'), '1');
        assert.equal(find(doc, 'zzz'), undefined);
        assert.deepEqual(find(doc, 'd'), {c: '2'});
    });
});
