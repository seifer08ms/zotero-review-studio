const assert = require('node:assert/strict');
global.ReviewCore = require('../addon/content/review-core.js');
const Matrix = require('../addon/content/review-matrix.js');

function analysis(id, title, method, page = 4) {
  return {
    paper: { id, itemID: Number(id.slice(1)), title, authors: ['Author'], year: '2025' },
    sourceQuality: 'fulltext', coverage: .92,
    summary: { methods: [method], assumptions: ['同分布训练'], datasets: ['SpaceNet'], metrics: ['IoU'], quantitativeResults: ['IoU=0.81'], authorLimitations: ['跨区域验证不足'], unresolvedProblems: ['Domain shift'] },
    chunks: [{ claims: [
      { evidenceId: `${id}-C1-E1-m`, kind: 'methods', claim: method, quote: 'The proposed method uses graph attention.', verified: true },
      { evidenceId: `${id}-C1-E2-l`, kind: 'limitations', claim: '跨区域验证不足', quote: 'Performance decreases across regions.', verified: true, pdfPage: page },
      { evidenceId: `${id}-C1-E3-x`, kind: 'methods', claim: 'Legacy unverified claim', quote: 'This text is not verified.' },
    ] }],
  };
}

const result = { question: '如何比较跨区域泛化？', analyses: [analysis('P1', 'Graph method', 'Graph attention')] };
let matrix = Matrix.build(result);
assert.equal(matrix.rows.length, 1);
assert(matrix.rows[0].cells.method.includes('Graph attention'));
assert(!matrix.rows[0].cells.method.includes('Legacy unverified claim'));
assert(matrix.rows[0].cells.limitations.includes('跨区域验证不足'));
assert(matrix.rows[0].cells.assumption.includes('同分布训练'));
assert(matrix.rows[0].cells.dataset.includes('SpaceNet'));
assert(matrix.rows[0].cells.metrics.includes('IoU'));
assert(matrix.rows[0].cells.results.includes('IoU=0.81'));
assert(matrix.rows[0].cells.evidence.includes('PDF p.4'));

matrix = Matrix.edit(matrix, 'P1', 'dataset', 'SpaceNet and DeepGlobe');
const updated = { question: result.question, analyses: [analysis('P1', 'Graph method', 'Updated graph method', 7), analysis('P2', 'Transformer method', 'Transformer attention', 11)] };
const merged = Matrix.merge(matrix, updated);
assert.equal(merged.rows.length, 2);
assert.equal(merged.rows.find(r => r.paperId === 'P1').cells.dataset, 'SpaceNet and DeepGlobe', 'manual cells survive refresh');
assert(merged.rows.find(r => r.paperId === 'P1').cells.method.includes('Updated graph method'));
assert(merged.rows.find(r => r.paperId === 'P2').cells.method.includes('Transformer attention'));

const withColumn = Matrix.addColumn(merged, '是否开源');
assert(withColumn.columns.some(c => c.label === '是否开源'));
assert.equal(Matrix.addColumn(withColumn, '是否开源').columns.length, withColumn.columns.length);
const filtered = Matrix.filterRows(withColumn, 'Transformer');
assert.equal(filtered.length, 1);
assert(Matrix.toTSV(withColumn).includes('是否开源'));
assert(Matrix.toHTML(withColumn).startsWith('<table'));
assert(Matrix.toLatex(withColumn).includes('\\begin{tabular}'));
const cleared = Matrix.clearManual(merged);
assert.equal(cleared.rows[0].cells.dataset, 'SpaceNet');
console.log('ReviewMatrix tests passed');
