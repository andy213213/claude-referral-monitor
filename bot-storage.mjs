import { get, put } from '@vercel/blob';

export const defaultControls = { paused: false, intervalMinutes: 15, used: [], lastUpdateId: -1 };

async function readRecord(path) {
  const result = await get(path, { access: 'private', useCache: false });
  if (!result) return { value: null, etag: null };
  return { value: await new Response(result.stream).json(), etag: result.blob.etag };
}

export async function readControls() {
  const record = await readRecord('controls.json');
  return { ...defaultControls, ...record.value };
}

export async function updateControls(change) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const record = await readRecord('controls.json');
    const current = { ...defaultControls, ...record.value };
    const updated = change(structuredClone(current));
    if (!updated) return current;
    try {
      await put('controls.json', JSON.stringify(updated), {
        access: 'private', addRandomSuffix: false, contentType: 'application/json',
        allowOverwrite: Boolean(record.etag),
        ...(record.etag ? { ifMatch: record.etag } : {}),
      });
      return updated;
    } catch (error) {
      if (!/Precondition|AlreadyExists/.test(error.constructor.name)) throw error;
    }
  }
  throw new Error('Controls changed concurrently. Please try again.');
}

export async function readSnapshot() {
  return (await readRecord('snapshot.json')).value || { recent: [] };
}

export async function publishSnapshot(state, delivered = []) {
  const previous = await readSnapshot();
  const recent = new Map((previous.recent || []).map(pass => [pass.hash, pass]));
  for (const pass of delivered) recent.set(pass.hash, pass);
  const snapshot = {
    lastScanAt: state.lastScanAt,
    sources: state.sources,
    credits: state.searchCredits,
    deliveredCount: Object.keys(state.seen).length,
    recent: [...recent.values()]
      .filter(pass => Date.parse(pass.published) >= Date.now() - 48 * 3_600_000)
      .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
      .slice(0, 30),
  };
  await put('snapshot.json', JSON.stringify(snapshot), {
    access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json',
  });
}
