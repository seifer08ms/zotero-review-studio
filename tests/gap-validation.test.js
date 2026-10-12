const assert = require('node:assert/strict');
const Core = require('../addon/content/review-core.js');

function analysis(id, claims) {
  return {
    paper: {id, title: id},
    sourceQuality: 'fulltext',
    summary: {},
    chunks: [{index: 1, claims}],
  };
}

const analyses = [
  analysis('P1', [{
    evidenceId: 'P1-C1-E1-l', kind: 'limitations', claim: 'Cross-region transfer is unstable',
    quote: 'cross-region transfer is unstable', verified: true, interpretation: 'author_stated', chunkIndex: 1,
  }]),
  analysis('P2', [{
    evidenceId: 'P2-C1-E1-l', kind: 'limitations', claim: 'Occlusion remains difficult',
    quote: 'occlusion remains difficult', verified: true, interpretation: 'author_stated', chunkIndex: 1,
  }, {
    evidenceId: 'P2-C1-E2-l', kind: 'limitations', claim: 'Unverified statement',
    quote: 'not present in source', verified: false, interpretation: 'inferred', chunkIndex: 1,
  }]),
];

const matrixClaims = Core.cleanClaims({
  methods: [{claim: 'Method claim', quote: 'Method claim is reported here'}],
  metrics: [{claim: 'Metric claim', quote: 'Metric claim is reported here'}],
  contributions: [{claim: 'Contribution claim', quote: 'Contribution claim is reported here'}],
  counterEvidence: [{claim: 'Counter claim', quote: 'Counter claim is reported here'}],
}, 'Method claim is reported here. Metric claim is reported here. Contribution claim is reported here. Counter claim is reported here.', 'P9', 1, {uniqueKinds: true});
assert.equal(new Set(matrixClaims.map(x => x.evidenceId)).size, matrixClaims.length);

const result = Core.validateSynthesis({
  themes: [],
  establishedLimitations: [],
  possibleGaps: [{
    claim: 'Generalization remains open',
    paperIds: ['P1', 'P2', 'P999'],
    evidenceIds: ['P1-C1-E1-l', 'P2-C1-E2-l', 'fabricated'],
    status: 'inferred',
  }],
  counterExamples: [{
    claim: 'A counterexample exists', paperIds: ['P2'], evidenceIds: [], status: 'mixed',
  }],
  uncertainties: [{
    claim: 'The effect outside the benchmark is unknown', paperIds: ['P2'], evidenceIds: ['P2-C1-E1-l'], status: 'inferred',
  }],
}, analyses);

const gap = result.possibleGaps[0];
assert.deepEqual(gap.evidenceIds, ['P1-C1-E1-l']);
assert.deepEqual(gap.paperIds, ['P1']);
assert.deepEqual(gap.supportingPaperIds, ['P1']);
assert.equal(gap.supportingPaperCount, 1);
assert.equal(gap.sourceVerified, false);
assert.equal(gap.verificationStatus, 'partial');
assert.equal(gap.sourceVerification.status, 'partial');
assert.deepEqual(gap.sourceVerification.invalidPaperIds, ['P999']);
assert.deepEqual(gap.sourceVerification.unverifiedEvidenceIds, ['P2-C1-E2-l']);
assert.deepEqual(gap.sourceVerification.unknownEvidenceIds, ['fabricated']);
assert.deepEqual(gap.sourceVerification.unsupportedDeclaredPaperIds, ['P2', 'P999']);
assert.equal(gap.evidenceLinks[0].paperId, 'P1');
assert.equal(gap.reviewStatus, 'pending');
assert.equal(gap.findingType, 'possible_gap');

const counter = result.counterExamples[0];
assert.equal(counter.verificationStatus, 'unverified');
assert.equal(counter.claimSupportStatus, 'no_verified_quote');
assert.equal(counter.findingType, 'counter_example');
assert.equal(counter.needsHumanReview, true);

const uncertainty = result.uncertainties[0];
assert.equal(uncertainty.verificationStatus, 'verified');
assert.equal(uncertainty.sourceVerified, true);
assert.deepEqual(uncertainty.paperIds, ['P2']);

const complete = Core.validateSynthesis({
  possibleGaps: [{claim: 'Two papers support this', paperIds: ['P1', 'P2'], evidenceIds: ['P1-C1-E1-l', 'P2-C1-E1-l'], status: 'mixed'}],
}, analyses).possibleGaps[0];
assert.equal(complete.sourceVerified, true);
assert.equal(complete.verificationStatus, 'verified');
assert.equal(complete.supportingPaperCount, complete.evidenceLinks.length);
assert.deepEqual(complete.paperIds, ['P1', 'P2']);

// Draft prompts retain the compact legacy shape, while checkpoint/export code
// can request the full traceability record explicitly.
const compact = JSON.parse(JSON.stringify(result));
assert.equal(compact.possibleGaps[0].verificationStatus, undefined);
const rich = Core.serializeSynthesis(result, true);
assert.equal(rich.possibleGaps[0].verificationStatus, 'partial');
assert.deepEqual(rich.possibleGaps[0].sourceVerification.unknownEvidenceIds, ['fabricated']);

const reviewed = Core.validateSynthesis({
  possibleGaps: [
    {claim: 'Accepted after researcher wording edit', paperIds: ['P1'], evidenceIds: ['P1-C1-E1-l'], reviewStatus: 'accepted'},
    {claim: 'Pending', paperIds: ['P1'], evidenceIds: ['P1-C1-E1-l']},
    {claim: 'Rejected', paperIds: ['P1'], evidenceIds: ['P1-C1-E1-l'], reviewStatus: 'rejected'},
  ],
}, analyses);
assert.deepEqual(Core.draftSynthesis(reviewed).possibleGaps.map(x => x.claim), ['Accepted after researcher wording edit']);
assert.equal(Core.serializeSynthesis(reviewed, true).possibleGaps[0].reviewStatus, 'accepted');

console.log('Gap evidence validation tests passed');
