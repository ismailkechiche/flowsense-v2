// The report draft (spec §9 "Add to Report"): an ordered list of pivot
// CONFIGURATIONS. Only configurations are kept; the server recomputes all
// data when the PDF is generated. Kept in memory and mirrored to
// sessionStorage so a page refresh doesn't lose it; storage can be
// unavailable, so every access is guarded and memory stays authoritative.

const STORAGE_KEY = 'flowsense.reportDraft';

/** `storage` is injectable for tests; defaults to sessionStorage when present. */
export function createReportDraft(storage = safeSessionStorage()) {
  let sections = load();

  function load() {
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }
  function save() {
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(sections)); } catch { /* memory only */ }
  }
  const copy = (value) => JSON.parse(JSON.stringify(value));

  return {
    sections: () => copy(sections),
    get size() { return sections.length; },
    add(config) { sections.push(copy(config)); save(); },
    remove(index) { sections.splice(index, 1); save(); },
    /** Moves the section at `index` by `delta` (−1 up, +1 down). */
    move(index, delta) {
      const to = index + delta;
      if (to < 0 || to >= sections.length) return;
      [sections[index], sections[to]] = [sections[to], sections[index]];
      save();
    },
    clear() {
      sections = [];
      try { storage?.removeItem(STORAGE_KEY); } catch { /* memory only */ }
    },
  };
}

function safeSessionStorage() {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

/**
 * Generates the PDF and, ONLY if the file was received and handed to the
 * browser, resets the builder and the draft (spec §9). Any failure leaves
 * everything as it was so the user doesn't lose work, and is rethrown.
 */
export async function generateAndReset({ request, save, reset }) {
  const file = await request();
  save(file);
  reset();
  return file;
}
