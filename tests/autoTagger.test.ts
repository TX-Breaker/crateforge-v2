import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '@core/schema';
import {
  applyProposals,
  proposeTags,
  queryDiscogs,
  queryMusicBrainz,
  RateLimiter,
  type FetchFn
} from '@services/tagger/autoTagger';

function memDb() {
  const db = new Database(':memory:');
  migrate(db);
  return db;
}

function mockFetch(
  responses: { status: number; body?: unknown }[]
): { fn: FetchFn; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const fn: FetchFn = async (url) => {
    calls.push(url);
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {}
    };
  };
  return { fn, calls };
}

const fastLimiter = () => new RateLimiter(1);

describe('queryMusicBrainz', () => {
  it('ritorna il match solo con score >= 90', async () => {
    const { fn } = mockFetch([
      { status: 200, body: { recordings: [{ score: 95, title: 'X', 'first-release-date': '2011-09-30' }] } }
    ]);
    const r = await queryMusicBrainz('Avicii', 'Levels', fn, fastLimiter());
    expect(r?.['first-release-date']).toBe('2011-09-30');

    const low = mockFetch([{ status: 200, body: { recordings: [{ score: 60 }] } }]);
    expect(await queryMusicBrainz('A', 'B', low.fn, fastLimiter())).toBeNull();
  });

  it('fa retry su 503 e poi riesce', async () => {
    const { fn, calls } = mockFetch([
      { status: 503 },
      { status: 200, body: { recordings: [{ score: 100, tags: [{ count: 3, name: 'house' }] }] } }
    ]);
    const r = await queryMusicBrainz('A', 'B', fn, fastLimiter());
    expect(r?.tags?.[0].name).toBe('house');
    expect(calls.length).toBe(2);
  });

  it('offline: nessuna eccezione, ritorna null', async () => {
    const fn: FetchFn = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(await queryMusicBrainz('A', 'B', fn, fastLimiter(), 1)).toBeNull();
  });
});

describe('queryDiscogs', () => {
  it('preferisce style (più specifico) al genre macro', async () => {
    const { fn, calls } = mockFetch([
      {
        status: 200,
        body: { results: [{ year: '2019', genre: ['Electronic'], style: ['Tech House'] }] }
      }
    ]);
    const r = await queryDiscogs('Fisher', 'Losing It', 'tok123', fn, fastLimiter());
    expect(r).toEqual({ year: '2019', genre: 'Tech House' });
    expect(calls[0]).toContain('token=tok123');
    expect(calls[0]).toContain('api.discogs.com');
  });

  it('429 → retry con backoff', async () => {
    const { fn, calls } = mockFetch([
      { status: 429 },
      { status: 200, body: { results: [{ year: '2020', genre: ['House'] }] } }
    ]);
    const r = await queryDiscogs('A', 'B', 't', fn, fastLimiter());
    expect(r?.year).toBe('2020');
    expect(calls.length).toBe(2);
  });

  it('provider discogs senza token: errore chiaro da proposeTags', async () => {
    const db = memDb();
    await expect(proposeTags(db, { provider: 'discogs' })).rejects.toThrow(/token/i);
  });
});

describe('proposeTags / applyProposals', () => {
  it('propone anno+genere mancanti e li applica solo su richiesta', async () => {
    const db = memDb();
    db.prepare(
      `INSERT INTO tracks (source, source_id, title, artist, year, genre)
       VALUES ('xml', '1', 'Levels', 'Avicii', NULL, NULL)`
    ).run();
    db.prepare(
      `INSERT INTO tracks (source, source_id, title, artist, year, genre, needs_review)
       VALUES ('xml', '2', 'Rotto', 'X', NULL, NULL, 1)`
    ).run(); // needs_review: escluso

    const { fn } = mockFetch([
      {
        status: 200,
        body: {
          recordings: [
            {
              score: 98,
              'first-release-date': '2011-09-30',
              tags: [
                { count: 1, name: 'edm' },
                { count: 7, name: 'progressive house' }
              ]
            }
          ]
        }
      }
    ]);
    const r = await proposeTags(db, { fetchFn: fn });
    expect(r.queried).toBe(1); // il brano needs_review non viene interrogato
    expect(r.proposals).toHaveLength(2);
    const year = r.proposals.find((p) => p.field === 'year')!;
    const genre = r.proposals.find((p) => p.field === 'genre')!;
    expect(year.proposed).toBe('2011');
    expect(genre.proposed).toBe('progressive house'); // tag con count più alto

    // Niente è stato scritto finché non si applica (dry-run by design)
    let row = db.prepare(`SELECT year, genre FROM tracks WHERE source_id='1'`).get() as {
      year: number | null;
      genre: string | null;
    };
    expect(row.year).toBeNull();

    applyProposals(db, r.proposals);
    row = db.prepare(`SELECT year, genre FROM tracks WHERE source_id='1'`).get() as {
      year: number | null;
      genre: string | null;
    };
    expect(row.year).toBe(2011);
    expect(row.genre).toBe('progressive house');
  });
});
