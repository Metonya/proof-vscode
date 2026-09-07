import * as assert from 'node:assert/strict';
import * as net from 'node:net';
import { test } from 'node:test';

import { httpsGetBuffer } from '../../../cli/githubFetch';

/**
 * The bug this guards against: a corporate proxy/firewall that silently
 * swallows a connection (rather than refusing it outright) leaves a bare
 * `https.get` with no socket event ever firing - no `error`, no `data`, no
 * `end`. A plain TCP server that accepts the connection and never writes a
 * byte back reproduces exactly that: the TLS handshake stalls waiting for a
 * ServerHello that never comes, which is indistinguishable from a black-holed
 * corporate link. This is a real socket, not a faked timeout, so it actually
 * exercises `req.setTimeout` rather than assuming it works.
 */
test('httpsGetBuffer rejects instead of hanging forever when the connection never responds', async () => {
	const server = net.createServer((socket) => {
		socket.on('error', () => {});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as net.AddressInfo).port;
	try {
		await assert.rejects(
			() => httpsGetBuffer(`https://127.0.0.1:${port}/`, 0, 100),
			/timed out after 100ms/,
		);
	} finally {
		server.close();
	}
});
