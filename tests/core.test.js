const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const file = path.resolve(__dirname,'../addon/content/review-core.js');
const Core=require(file);

const raw='第一段研究方法：采用图网络进行道路拓扑提取。\n'.repeat(800);
const r=Core.splitText(raw,3100,10000,250);
assert(r.chunks.length>2,'chunk segmentation should work');
assert(r.chunks.every(c=>c.text.length<=3150));
assert(r.coverage<1 && r.truncated);
assert(r.chunks.at(-1).end===10000);
assert(Core.evidenceMatches('采用图网络进行道路拓扑提取',raw));
assert(!Core.evidenceMatches('作者声称该技术在所有场景完美可靠',raw));
assert(!Core.evidenceMatches('少量字符','这句话不存在'));
assert.equal(Core.safeJSON('```json\n{"methods":[]}\n```').methods.length,0);
assert.deepEqual(Core.unknownCitations('[P1] text [P3] [P3]', ['P1','P2']),['P3']);
assert(!Core.markdownToSafeNote('# Title\n<img onload=alert(1)>').includes('<img'));
assert.equal(Core.BUILT_IN_TEMPLATES.length,5);
const c=Core.cleanClaims({limitations:[
  {claim:'研究假设不支持变化区域',quote:'采用图网络进行道路拓扑提取',interpretation:'author_stated'},
  {claim:'可能有问题',quote:'not in text',interpretation:'inferred'}
]},raw,'P1',2);
assert.equal(c.length,2);
assert(c[0].verified && !c[1].verified);
assert(!Core.compactForPaper({id:'P1',title:'test',sourceQuality:'fulltext',coverage:1,chunks:[{claims:c}]}).includes('可能有问题'));
assert(Core.bibliography([{id:'P1',title:'Title',authors:['Smith'],year:'2024',doi:'10.1/xyz'}])[0].includes('https://doi.org/10.1/xyz'));
console.log('ReviewCore tests passed');
