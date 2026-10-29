// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

/**
 * Every request from the client goes through `safeFetch`, which resolves the target name before issuing: the resolution is
 * simulated here, otherwise the suite would depend on a reachable DNS.
 */
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

/** Frozen exemption list: the development harness must remain reachable. */
vi.mock('../../config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/env')>();
  return { ...actual, env: { ...actual.env, SHOTGRID_INSECURE_HOSTS: 'sim.local:8890' } };
});

/** An authentication refusal must leave a trace: the logs are asserted here. */
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { lookup } from 'node:dns/promises';
import { ShotgridClient, ShotgridApiError, clearTokenCache, flattenRecord } from './ShotgridClient';
import { OutboundBlockedError } from '../../lib/safeFetch';
import { logger } from '../../lib/logger';

/**
 * The client talks to a simulated server through a replaced `fetch`: these tests describe the transport contract
 * (authentication, pagination, retry) without depending on a site. The full scenario against the real simulator lives
 * in `scripts/test-shotgrid-e2e.mjs`.
 */

const PUBLIC_ADDRESS = [{ address: '93.184.216.34', family: 4 }];

const creds = {
  baseUrl: 'https://studio.shotgrid.autodesk.com',
  authMode: 'script' as const,
  scriptName: 'review_sync',
  scriptKey: 'secret',
};

const authOk = () =>
  new Response(JSON.stringify({ access_token: 'tok', expires_in: 600, token_type: 'Bearer' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function record(id: number, attributes: Record<string, unknown> = {}) {
  return { id, type: 'Shot', attributes, relationships: {} };
}

describe('flattenRecord', () => {
  it('flattens the JSONAPI shape into a single record', () => {
    const flat = flattenRecord({
      id: 12,
      type: 'Shot',
      attributes: { code: 'SH010', sg_cut_in: 1001 },
      relationships: { project: { data: { type: 'Project', id: 70 } } },
    });
    expect(flat).toMatchObject({
      id: 12,
      type: 'Shot',
      code: 'SH010',
      sg_cut_in: 1001,
      project: { type: 'Project', id: 70 },
    });
  });

  it('accepts an already flat record without damaging it', () => {
    const flat = flattenRecord({ id: 3, type: 'Status', code: 'ip' });
    expect(flat.code).toBe('ip');
  });

  it('tolerates an empty payload', () => {
    expect(flattenRecord(null)).toEqual({ id: 0, type: '' });
  });
});

describe('ShotgridClient', () => {
  let fetchMock: Mock<typeof fetch>;

  beforeEach(() => {
    clearTokenCache();
    vi.mocked(lookup).mockResolvedValue(PUBLIC_ADDRESS as never);
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('authenticates once then reuses the token', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockImplementation(async () => json({ data: [] }));
    const client = new ShotgridClient(creds);
    await client.search('Shot', { fields: ['code'] });
    await client.search('Asset', { fields: ['code'] });

    const authCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('access_token'));
    expect(authCalls).toHaveLength(1);
    // Script credentials go through the "client_credentials" flow.
    expect(String(authCalls[0]![1]!.body)).toContain('grant_type=client_credentials');
  });

  it('clearly reports refused credentials', async () => {
    fetchMock.mockImplementation(async () => json({ errors: [{ detail: "Can't authenticate user" }] }, 401));
    const client = new ShotgridClient(creds);
    await expect(client.search('Shot')).rejects.toBeInstanceOf(ShotgridApiError);
    await expect(client.search('Shot')).rejects.toMatchObject({ status: 401 });
  });

  /**
   * An authentication refusal arrives under a code the documentation does not promise: a real site answers **400** with
   * `code: 102`. Deducing it from the HTTP code left the connection as a mere "error", and the generic label erased what the
   * site said: "locked account" and "wrong password" call for different actions.
   */
  it("recognizes a refusal returned as 400 and carries the site's words", async () => {
    const title = "Can't authenticate user 'demo' because the account is locked.";
    fetchMock.mockImplementation(async () => json({ errors: [{ code: 102, title, detail: null }] }, 400));

    const error = await new ShotgridClient(creds).serverInfo().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShotgridApiError);
    const sgError = error as ShotgridApiError;
    expect(sgError.isAuth).toBe(true);
    expect(sgError.message).toContain(title);
    expect(sgError.code).toBe('SHOTGRID_AUTH_REFUSED');
    expect(sgError.details).toEqual({ reason: title });
    // The code returned to ReView's client is that of the gateway, not that of the site.
    expect(sgError.statusCode).toBe(502);
    expect(sgError.status).toBe(400);
  });

  /**
   * The reason for the refusal must be readable in the logs, without replaying the call by hand. It was not: only the replay
   * from the cache wrote a line, and it said "already refused" without the reason. A locked account on the site was therefore
   * indistinguishable from a wrong password for anyone who only has `docker logs`.
   */
  it('writes the reason for the refusal to the logs, from the first call', async () => {
    const title = "Can't authenticate user 'demo' because the account is locked.";
    fetchMock.mockImplementation(async () => json({ errors: [{ code: 102, title }] }, 400));

    await expect(new ShotgridClient(creds).serverInfo()).rejects.toBeInstanceOf(ShotgridApiError);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: creds.baseUrl, status: 400, reason: title }),
      expect.stringContaining('refusée par le site'),
    );
  });

  /**
   * The site locks the account after a few failures: retrying refused credentials does not make them good, and turns a typo
   * into a locked account.
   */
  it('no longer calls the site after a refusal, until the credentials are fixed', async () => {
    fetchMock.mockImplementation(async () =>
      json({ errors: [{ title: "Can't authenticate user 'demo'." }] }, 400),
    );

    await expect(new ShotgridClient(creds).serverInfo()).rejects.toBeInstanceOf(ShotgridApiError);
    const emitted = fetchMock.mock.calls.length;

    // Two more screens, two more clients: no extra request.
    await expect(new ShotgridClient(creds).serverInfo()).rejects.toMatchObject({
      code: 'SHOTGRID_AUTH_REFUSED',
    });
    await expect(new ShotgridClient(creds).search('Shot')).rejects.toBeInstanceOf(ShotgridApiError);
    expect(fetchMock.mock.calls).toHaveLength(emitted);

    // Fixing the site empties the token cache: the gate reopens at the same moment.
    clearTokenCache(creds.baseUrl);
    fetchMock.mockImplementation(async (input) =>
      String(input).includes('access_token') ? authOk() : json({ data: { shotgun_version: '8.88' } }),
    );
    await expect(new ShotgridClient(creds).serverInfo()).resolves.toMatchObject({
      shotgun_version: '8.88',
    });
  });

  it('uses the password flow for a user account', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockImplementation(async () => json({ data: [] }));
    const client = new ShotgridClient({
      baseUrl: creds.baseUrl,
      authMode: 'user',
      login: 'demo.user',
      password: 'legacy',
    });
    await client.search('Shot');
    const body = String(fetchMock.mock.calls[0]![1]!.body);
    expect(body).toContain('grant_type=password');
    expect(body).toContain('username=demo.user');
  });

  it('refuses to start without credentials', async () => {
    const client = new ShotgridClient({ baseUrl: creds.baseUrl, authMode: 'script' });
    await expect(client.search('Shot')).rejects.toThrow();
  });

  it('walks all pages up to the last incomplete one', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    const full = Array.from({ length: 500 }, (_, i) => record(i + 1));
    fetchMock.mockResolvedValueOnce(json({ data: full }));
    fetchMock.mockResolvedValueOnce(json({ data: [record(501)] }));

    const client = new ShotgridClient(creds);
    const out = await client.search('Shot', { fields: ['code'] });
    expect(out).toHaveLength(501);
  });

  it('passes the project filter through as is', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockImplementation(async () => json({ data: [] }));
    const client = new ShotgridClient(creds);
    await client.search('Shot', { filters: [['project', 'is', { type: 'Project', id: 70 }]] });

    const searchCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('_search'));
    const body = JSON.parse(String(searchCall![1]!.body));
    expect(body.filters).toEqual([['project', 'is', { type: 'Project', id: 70 }]]);
  });

  it('retries after a transient site error', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockResolvedValueOnce(json({ errors: [{ detail: 'busy' }] }, 503));
    fetchMock.mockResolvedValueOnce(json({ data: [record(1)] }));

    const client = new ShotgridClient(creds);
    const out = await client.search('Shot');
    expect(out).toHaveLength(1);
  });

  it('does not retry a plainly invalid request', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockImplementation(async () => json({ errors: [{ detail: 'bad field' }] }, 400));
    const client = new ShotgridClient(creds);
    await expect(client.search('Shot')).rejects.toMatchObject({ status: 400 });
    const searchCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('_search'));
    expect(searchCalls).toHaveLength(1);
  });

  it('returns null for a missing entity rather than throwing', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockImplementation(async () => json({ errors: [{ detail: 'not found' }] }, 404));
    const client = new ShotgridClient(creds);
    expect(await client.findById('Shot', 999, ['code'])).toBeNull();
    expect(await client.schemaField('Shot', 'sg_inexistant')).toBeNull();
  });

  it('sends no Content-Type on a request without a body', async () => {
    // A real ShotGrid site answers "Unsupported Content-Type" to a GET carrying this header;
    // the default was not visible against a permissive server.
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockImplementation(async () => json({ data: { shotgun_version: '8.60' } }));
    const client = new ShotgridClient(creds);
    await client.serverInfo();

    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/api/v1.1/'));
    const headers = call![1]!.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers.Accept).toBe('application/json');
  });

  it('declares the shape of the filters in the search Content-Type', async () => {
    // ShotGrid refuses `application/json` on `_search` and requires knowing whether the filters arrive as an array of
    // conditions or as an object with a logical operator.
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockImplementation(async () => json({ data: [] }));
    const client = new ShotgridClient(creds);

    await client.search('Shot', { filters: [['project', 'is', { type: 'Project', id: 70 }]] });
    const arrayCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('_search'));
    expect((arrayCall![1]!.headers as Record<string, string>)['Content-Type']).toBe(
      'application/vnd+shotgun.api3_array+json',
    );
    expect(JSON.parse(String(arrayCall![1]!.body)).filters).toEqual([
      ['project', 'is', { type: 'Project', id: 70 }],
    ]);

    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => json({ data: [] }));
    await client.search('Shot', {
      filters: [['code', 'contains', 'SH']],
      logicalOperator: 'or',
    });
    const hashCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('_search'));
    expect((hashCall![1]!.headers as Record<string, string>)['Content-Type']).toBe(
      'application/vnd+shotgun.api3_hash+json',
    );
    // In object form, the conditions are nested under the operator.
    expect(JSON.parse(String(hashCall![1]!.body)).filters).toEqual({
      logical_operator: 'or',
      conditions: [['code', 'contains', 'SH']],
    });
  });

  it('targets version 1.1 of the API', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockImplementation(async () => json({ data: [] }));
    const client = new ShotgridClient(creds);
    await client.search('Shot');
    expect(fetchMock.mock.calls.every((c) => String(c[0]).includes('/api/v1.1/'))).toBe(true);
  });
});

describe('uploadFile', () => {
  let fetchMock: Mock<typeof fetch>;

  beforeEach(() => {
    clearTokenCache();
    vi.mocked(lookup).mockResolvedValue(PUBLIC_ADDRESS as never);
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('reads the upload address under "links", not under "data"', async () => {
    // ShotGrid describes the upload in `data` and places the signed address in `links.upload`: looking it up in
    // `data.upload_url` always returned empty, hence a "no upload URL" when the site did provide one.
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockResolvedValueOnce(
      json({
        data: { upload_type: 'Attachment', storage_service: 's3' },
        links: { upload: 'https://s3.example/signed', complete_upload: '/api/v1.1/complete' },
      }),
    );
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(json({ data: {} }));

    const client = new ShotgridClient(creds);
    await client.unsafeUploadFile('Note', 42, 'attachments', Buffer.from('image'), 'a.png', 'image/png');

    const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(String(put![0])).toBe('https://s3.example/signed');
    // The confirmation makes the file visible: without it, it stays orphaned.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/complete'))).toBe(true);
  });

  it('clearly reports the absence of an upload address', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockImplementation(async () => json({ data: {}, links: {} }));
    const client = new ShotgridClient(creds);
    await expect(
      client.unsafeUploadFile('Note', 42, 'attachments', Buffer.from('x'), 'a.png'),
    ).rejects.toThrow();
  });
});

/**
 * The remote site dictates two addresses that ReView will fetch itself: the one of the media to download and the one of the
 * file upload. A compromised, misconfigured or hostile site would point them at the application network: they therefore go
 * through the guard like the others.
 */
describe('ShotgridClient: outgoing requests under guard', () => {
  let fetchMock: Mock<typeof fetch>;

  beforeEach(() => {
    clearTokenCache();
    vi.mocked(lookup).mockResolvedValue(PUBLIC_ADDRESS as never);
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('refuses a media stream pointing to the metadata service', async () => {
    const client = new ShotgridClient(creds);
    await expect(client.openStream('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a stream whose name resolves to an internal address', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never);
    const client = new ShotgridClient(creds);
    await expect(client.openStream('https://media.exemple.com/master.mov')).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a download redirect into the internal network', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://192.168.10.4:9000/review/' } }),
    );
    const client = new ShotgridClient(creds);
    await expect(client.openStream('https://media.exemple.com/master.mov')).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a legitimate S3 redirect and returns the stream', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 307, headers: { location: 'https://s3.exemple.com/signed' } }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response('média', { status: 200, headers: { 'content-type': 'video/quicktime' } }),
    );
    const client = new ShotgridClient(creds);
    const out = await client.openStream('https://media.exemple.com/master.mov');
    expect(out.type).toBe('video/quicktime');
    expect(String(fetchMock.mock.calls[1]![0])).toBe('https://s3.exemple.com/signed');
  });

  it('refuses an upload address aimed at the application network', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockResolvedValueOnce(json({ data: {}, links: { upload: 'http://169.254.169.254/review/x' } }));
    const client = new ShotgridClient(creds);
    await expect(
      client.unsafeUploadFile('Note', 42, 'attachments', Buffer.from('x'), 'a.png'),
    ).rejects.toBeInstanceOf(OutboundBlockedError);
    // No PUT was issued.
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'PUT')).toBe(false);
  });

  it('refuses a site whose name resolves to an internal address', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '192.168.1.10', family: 4 }] as never);
    const client = new ShotgridClient(creds);
    await expect(client.serverInfo()).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // SHOTGRID_INSECURE_HOSTS: without this exemption, the development simulator
  // (host.docker.internal:8890, a private plaintext address) would become unreachable.
  it('lets through a host declared in SHOTGRID_INSECURE_HOSTS', async () => {
    fetchMock.mockResolvedValueOnce(authOk());
    fetchMock.mockResolvedValueOnce(json({ data: { shotgun_version: '8.60' } }));
    const client = new ShotgridClient({ ...creds, baseUrl: 'http://sim.local:8890' });
    await expect(client.serverInfo()).resolves.toMatchObject({ shotgun_version: '8.60' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("applies the exemption to the simulator's media stream", async () => {
    fetchMock.mockResolvedValueOnce(new Response('média', { status: 200 }));
    const client = new ShotgridClient({ ...creds, baseUrl: 'http://sim.local:8890' });
    await expect(client.openStream('http://sim.local:8890/_media/Version/1/x')).resolves.toBeTruthy();
    expect(lookup).not.toHaveBeenCalled();
  });
});
