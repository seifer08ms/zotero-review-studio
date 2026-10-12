/* Evidence comparison matrix helpers. Dependency-free so the data model can be
 * tested outside Zotero and reused by the dialog UI. Values derived from model
 * output are kept separate from manual edits; incremental refreshes therefore
 * update newly analyzed papers without overwriting the researcher's corrections.
 */
var ReviewMatrix = (function () {
  'use strict';

  const VERSION = 1;
  const MAX_CELL = 4000;
  const DEFAULT_COLUMNS = [
    { key: 'method', label: '方法 / 技术路线', kind: 'auto' },
    { key: 'assumption', label: '关键假设 / 适用条件', kind: 'manual' },
    { key: 'dataset', label: '数据集 / 实验场景', kind: 'manual' },
    { key: 'metrics', label: '评价指标', kind: 'manual' },
    { key: 'results', label: '定量结果', kind: 'manual' },
    { key: 'limitations', label: '局限 / 未解问题', kind: 'auto' },
    { key: 'evidence', label: '原文证据与 PDF 页码', kind: 'auto' },
  ];

  function clean(value, max = MAX_CELL) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function scalar(value) {
    if (value && typeof value === 'object') {
      for (const key of ['claim', 'name', 'title', 'text', 'description', 'value']) {
        if (value[key] != null && String(value[key]).trim()) return value[key];
      }
      return '';
    }
    return value;
  }

  function list(value, max = 8) {
    if (Array.isArray(value)) return value.map(x => clean(scalar(x))).filter(Boolean).slice(0, max);
    if (value == null || value === '') return [];
    return [clean(scalar(value))];
  }

  function join(values, separator = '；') {
    return list(values).join(separator);
  }

  function normalizeColumns(columns) {
    const seen = new Set();
    const out = [];
    for (const raw of Array.isArray(columns) ? columns : DEFAULT_COLUMNS) {
      if (!raw) continue;
      const key = clean(raw.key || raw.id, 50).toLowerCase().replace(/[^a-z0-9_\-]/g, '_');
      const label = clean(raw.label || raw.name || key, 80);
      if (!key || !label || seen.has(key) || key === 'paper' || key === 'status') continue;
      seen.add(key);
      out.push({ key, label, kind: raw.kind === 'auto' ? 'auto' : 'manual' });
    }
    return out.length ? out.slice(0, 18) : DEFAULT_COLUMNS.map(x => ({ ...x }));
  }

  function claims(analysis, kinds) {
    const allowed = new Set(Array.isArray(kinds) ? kinds : []);
    const all = (typeof ReviewCore !== 'undefined' && ReviewCore.flattenPaperEvidence)
      ? ReviewCore.flattenPaperEvidence(analysis)
      : (analysis?.chunks || []).flatMap(x => x.claims || []);
    // A matrix citation is evidence only when the quote was explicitly
    // matched to the extracted source text. Missing `verified` is treated as
    // unknown so legacy or hand-authored claims cannot be promoted silently.
    return all.filter(x => x && x.verified === true && (!allowed.size || allowed.has(x.kind)));
  }

  function summaryList(summary, keys) {
    const out = [];
    for (const key of keys) out.push(...list(summary?.[key], 5));
    return [...new Set(out)].slice(0, 10);
  }

  function evidenceText(analysis) {
    const rows = claims(analysis, [
      'methods', 'contributions', 'limitations', 'openProblems', 'counterEvidence',
      'assumptions', 'datasets', 'metrics', 'quantitativeResults',
    ]).slice(0, 18).map(c => {
      const page = Number.isFinite(Number(c.pdfPage)) && Number(c.pdfPage) > 0
        ? `PDF p.${Number(c.pdfPage)}` : 'PDF 页码未定位';
      const quote = clean(c.quote, 240);
      return `${c.evidenceId} · ${page}${quote ? ` · “${quote}”` : ''}`;
    });
    return rows.join('\n');
  }

  function derivedCell(analysis, key) {
    const summary = analysis?.summary || {};
    const methodClaims = claims(analysis, ['methods', 'contributions']);
    const limitationClaims = claims(analysis, ['limitations', 'openProblems', 'counterEvidence']);
    if (key === 'method') {
      // Reducer summaries are useful context, but their individual statements
      // do not carry a claim-to-quote link. Keep automatic cells grounded in
      // verified claims and leave unobserved details to editable cells.
      return join(methodClaims.map(c => c.claim).slice(0, 8));
    }
    if (key === 'limitations') {
      return join(limitationClaims.map(c => c.claim).slice(0, 10));
    }
    if (key === 'evidence') return evidenceText(analysis);
    if (key === 'assumption') {
      return join(summaryList(summary, ['assumptions', 'keyAssumptions']));
    }
    if (key === 'dataset') {
      return join(summaryList(summary, ['datasets', 'dataSets', 'experimentalSettings']));
    }
    if (key === 'metrics') {
      return join(summaryList(summary, ['metrics', 'evaluationMetrics', 'evaluation']));
    }
    if (key === 'results') {
      return join(summaryList(summary, ['results', 'quantitativeResults', 'keyResults', 'findings']));
    }
    // When the reducer does not expose one of these fields, leave it blank.
    // Empty cells expose work still requiring scientific judgment instead of
    // turning an unobserved field into a model guess.
    return '';
  }

  function paperId(analysis) {
    return clean(analysis?.paper?.id || analysis?.paper?.itemID || analysis?.id, 120);
  }

  function displayPaper(analysis) {
    const paper = analysis?.paper || {};
    const authors = Array.isArray(paper.authors) ? paper.authors.slice(0, 3).join(', ') : '';
    return {
      title: clean(paper.title || '无标题', 300),
      citation: clean(`${authors}${authors ? ' · ' : ''}${paper.year || '年份未知'}`, 180),
    };
  }

  function createRow(analysis, columns) {
    const normalized = normalizeColumns(columns);
    const cells = {};
    const autoCells = {};
    for (const column of normalized) {
      const value = clean(derivedCell(analysis, column.key));
      cells[column.key] = value;
      autoCells[column.key] = value;
    }
    const paper = displayPaper(analysis);
    return {
      paperId: paperId(analysis), itemID: analysis?.paper?.itemID || null,
      title: paper.title, citation: paper.citation,
      sourceQuality: clean(analysis?.sourceQuality || 'unknown', 40),
      coverage: Number.isFinite(Number(analysis?.coverage)) ? Number(analysis.coverage) : 0,
      cells, autoCells, manualCells: {},
      updatedAt: Date.now(),
    };
  }

  function build(result, options = {}) {
    const columns = normalizeColumns(options.columns || result?.matrix?.columns || DEFAULT_COLUMNS);
    const analyses = (result?.analyses || []).filter(a => !a?.skipped && a?.summary && paperId(a));
    return {
      version: VERSION,
      question: clean(result?.question || '', 1000),
      columns,
      rows: analyses.map(a => createRow(a, columns)),
      updatedAt: Date.now(),
    };
  }

  function normalizeMatrix(matrix, fallbackResult) {
    const source = matrix && typeof matrix === 'object' ? matrix : {};
    const columns = normalizeColumns(source.columns || fallbackResult?.matrix?.columns || DEFAULT_COLUMNS);
    const rows = Array.isArray(source.rows) ? source.rows : [];
    return {
      version: VERSION,
      question: clean(source.question || fallbackResult?.question || '', 1000),
      columns,
      rows: rows.filter(r => r && clean(r.paperId, 120)).map(row => {
        const cells = {};
        const autoCells = {};
        const manualCells = {};
        for (const column of columns) {
          cells[column.key] = clean(row.cells?.[column.key]);
          autoCells[column.key] = clean(row.autoCells?.[column.key]);
          if (row.manualCells?.[column.key]) manualCells[column.key] = true;
        }
        return {
          paperId: clean(row.paperId, 120), itemID: row.itemID || null,
          title: clean(row.title || '无标题', 300), citation: clean(row.citation, 180),
          sourceQuality: clean(row.sourceQuality || 'unknown', 40),
          coverage: Number.isFinite(Number(row.coverage)) ? Number(row.coverage) : 0,
          cells, autoCells, manualCells,
          updatedAt: Number(row.updatedAt) || Date.now(),
        };
      }),
      updatedAt: Number(source.updatedAt) || Date.now(),
    };
  }

  function merge(existing, result, options = {}) {
    const old = normalizeMatrix(existing, result);
    const columns = normalizeColumns(options.columns || old.columns || result?.matrix?.columns || DEFAULT_COLUMNS);
    const fresh = build(result, { columns });
    const previous = new Map(old.rows.map(row => [row.paperId, row]));
    for (const row of fresh.rows) {
      const before = previous.get(row.paperId);
      if (!before) continue;
      row.manualCells = { ...(before.manualCells || {}) };
      for (const column of columns) {
        const key = column.key;
        const isManual = row.manualCells[key] === true;
        if (isManual) {
          row.cells[key] = clean(before.cells?.[key]);
          row.autoCells[key] = clean(row.autoCells[key]);
        } else if (Object.prototype.hasOwnProperty.call(before.cells || {}, key)
                   && !row.autoCells[key] && before.cells[key]) {
          // A user may have typed into a default blank field before the next
          // incremental run. Preserve that value as an implicit manual edit.
          row.cells[key] = clean(before.cells[key]);
          row.manualCells[key] = true;
        }
      }
      row.updatedAt = before.updatedAt || row.updatedAt;
    }
    return { ...fresh, columns, rows: fresh.rows, updatedAt: Date.now() };
  }

  function edit(matrix, paperIdValue, key, value) {
    const out = normalizeMatrix(matrix);
    const row = out.rows.find(x => x.paperId === clean(paperIdValue, 120));
    if (!row || !out.columns.some(x => x.key === key)) return out;
    row.cells[key] = clean(value);
    row.manualCells[key] = true;
    row.updatedAt = Date.now(); out.updatedAt = row.updatedAt;
    return out;
  }

  function clearManual(matrix, paperIdValue = null, key = null) {
    const out = normalizeMatrix(matrix);
    for (const row of out.rows) {
      if (paperIdValue && row.paperId !== clean(paperIdValue, 120)) continue;
      for (const column of out.columns) {
        if (key && column.key !== key) continue;
        delete row.manualCells[column.key];
        row.cells[column.key] = row.autoCells[column.key] || '';
      }
    }
    out.updatedAt = Date.now();
    return out;
  }

  function addColumn(matrix, label, key = '') {
    const out = normalizeMatrix(matrix);
    const cleanLabel = clean(label, 80);
    const candidate = clean(key || cleanLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_'), 50);
    if (!cleanLabel || out.columns.some(x => x.label.toLowerCase() === cleanLabel.toLowerCase())) return out;
    const generated = key ? candidate : (/^[a-z][a-z0-9_-]{0,48}$/.test(candidate) && candidate !== '_'
      ? candidate : `custom_${Date.now().toString(36)}`);
    if (!cleanLabel || !generated || out.columns.some(x => x.key === generated)) return out;
    out.columns.push({ key: generated, label: cleanLabel, kind: 'manual' });
    for (const row of out.rows) {
      row.cells[generated] = ''; row.autoCells[generated] = '';
    }
    out.updatedAt = Date.now();
    return out;
  }

  function filterRows(matrix, query = '', onlyMissing = false) {
    const out = normalizeMatrix(matrix);
    const needle = clean(query).toLowerCase();
    return out.rows.filter(row => {
      const text = [row.title, row.citation, ...Object.values(row.cells || {})].join(' ').toLowerCase();
      if (needle && !text.includes(needle)) return false;
      if (onlyMissing && !out.columns.some(c => c.key !== 'evidence' && !clean(row.cells?.[c.key]))) return false;
      return true;
    });
  }

  function sortRows(matrix, key = 'title', direction = 'asc') {
    const out = normalizeMatrix(matrix);
    const sign = direction === 'desc' ? -1 : 1;
    out.rows.sort((a, b) => {
      const av = key === 'title' ? a.title : key === 'citation' ? a.citation : a.cells?.[key] || '';
      const bv = key === 'title' ? b.title : key === 'citation' ? b.citation : b.cells?.[key] || '';
      return sign * String(av).localeCompare(String(bv), 'zh-Hans');
    });
    return out;
  }

  function escTSV(value) { return String(value == null ? '' : value).replace(/\t/g, ' ').replace(/\r?\n/g, ' '); }
  function rowsWithHeaders(matrix, rows = null) {
    const m = normalizeMatrix(matrix);
    const body = rows || m.rows;
    return {
      headers: ['论文', '作者 / 年份', '来源', '覆盖率', ...m.columns.map(c => c.label)],
      rows: body.map(row => [row.title, row.citation, row.sourceQuality,
        `${Math.round(Math.max(0, Math.min(1, row.coverage)) * 100)}%`,
        ...m.columns.map(c => row.cells?.[c.key] || '')]),
    };
  }

  function toTSV(matrix, rows = null) {
    const table = rowsWithHeaders(matrix, rows);
    return [table.headers, ...table.rows].map(row => row.map(escTSV).join('\t')).join('\n');
  }

  function htmlEscape(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toHTML(matrix, rows = null) {
    const table = rowsWithHeaders(matrix, rows);
    const head = table.headers.map(x => `<th>${htmlEscape(x)}</th>`).join('');
    const body = table.rows.map(row => `<tr>${row.map(x => `<td>${htmlEscape(x).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('');
    return `<table border="1" cellspacing="0" cellpadding="5"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function latexEscape(value) {
    return String(value == null ? '' : value).replace(/\\/g, '\\textbackslash{}')
      .replace(/([{}#$%&_])/g, '\\$1').replace(/\^/g, '\\textasciicircum{}')
      .replace(/~/g, '\\textasciitilde{}').replace(/\r?\n/g, ' ');
  }

  function toLatex(matrix, rows = null) {
    const table = rowsWithHeaders(matrix, rows);
    const cols = 'l'.repeat(table.headers.length);
    const head = table.headers.map(latexEscape).join(' & ');
    const body = table.rows.map(row => row.map(latexEscape).join(' & ') + ' \\\\').join('\n');
    return `\\begin{tabular}{${cols}}\n\\hline\n${head} \\\\\n\\hline\n${body}\n\\hline\n\\end{tabular}`;
  }

  return {
    VERSION, DEFAULT_COLUMNS, normalizeColumns, build, normalizeMatrix, merge,
    edit, clearManual, addColumn, filterRows, sortRows, toTSV, toHTML, toLatex,
    derivedCell, evidenceText,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ReviewMatrix;
