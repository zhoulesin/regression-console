const CODE_PATTERN = /^\d+\.\d+$/;
const REASONS = new Set([
  'duplicate_code',
  'duplicate_title',
  'batch_limit',
  'apply_conflict',
  'invalid',
]);

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedTitle(value) {
  return clean(value).replace(/\s+/g, '').toLocaleLowerCase();
}

function skipped(row, reason, detail = '') {
  return {
    code: clean(row?.code),
    title: clean(row?.title),
    reason,
    detail,
  };
}

/**
 * 模型输出不可信：逐条检查，并把坏条目降级为 skipped，避免一条坏数据
 * 毁掉整批可审阅结果。
 *
 * @param {unknown} draft
 * @param {{ code: string, title: string }[]} existing
 */
export function normalizeCatalogDraft(draft, existing) {
  if (!draft || typeof draft !== 'object') {
    throw new Error('422: catalog response must be an object');
  }
  const rationale = clean(draft.rationale);
  if (!rationale) {
    throw new Error('422: catalog rationale required');
  }
  if (!Array.isArray(draft.features)) {
    throw new Error('422: catalog features must be an array');
  }

  const existingCodes = new Set(existing.map((row) => clean(row.code)));
  const existingTitles = new Set(
    existing.map((row) => normalizedTitle(row.title)).filter(Boolean),
  );
  const batchCodes = new Set();
  const batchTitles = new Set();
  const features = [];
  const skippedRows = [];

  for (const row of draft.features) {
    const code = clean(row?.code);
    const title = clean(row?.title);
    const criteria = clean(row?.criteria);
    const precondition = clean(row?.precondition);
    const chapter = row?.chapter;
    const titleKey = normalizedTitle(title);

    if (
      !CODE_PATTERN.test(code) ||
      !Number.isInteger(chapter) ||
      chapter < 0 ||
      !title ||
      !criteria
    ) {
      skippedRows.push(skipped(row, 'invalid', '编号、章节、标题或判定依据不合法'));
      continue;
    }
    if (existingCodes.has(code) || batchCodes.has(code)) {
      skippedRows.push(skipped(row, 'duplicate_code'));
      continue;
    }
    if (existingTitles.has(titleKey) || batchTitles.has(titleKey)) {
      skippedRows.push(skipped(row, 'duplicate_title'));
      continue;
    }
    if (features.length >= 15) {
      skippedRows.push(skipped(row, 'batch_limit'));
      continue;
    }

    features.push({
      code,
      chapter,
      chapter_title: clean(row.chapter_title),
      title,
      criteria,
      precondition,
    });
    batchCodes.add(code);
    batchTitles.add(titleKey);
  }

  for (const row of Array.isArray(draft.skipped) ? draft.skipped : []) {
    const reason = REASONS.has(row?.reason) ? row.reason : 'invalid';
    skippedRows.push(skipped(row, reason, clean(row?.detail)));
  }

  if (features.length === 0 && skippedRows.length === 0) {
    throw new Error('422: catalog returned no features');
  }
  return { rationale, features, skipped: skippedRows };
}

export function parseCatalogResponse(raw, existing) {
  const text = String(raw ?? '').trim();
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  let parsed;
  try {
    parsed = JSON.parse(fenced ? fenced[1].trim() : text);
  } catch {
    throw new Error('422: catalog returned invalid JSON');
  }
  return normalizeCatalogDraft(parsed, existing);
}
