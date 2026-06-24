import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const confidenceSource = await readFile(new URL('../src/features/backfill/confidence.ts', import.meta.url), 'utf8')
const chunkingSource = await readFile(new URL('../src/features/backfill/chunking.ts', import.meta.url), 'utf8')
const extractSource = await readFile(new URL('../src/features/backfill/extract.ts', import.meta.url), 'utf8')
const reconcileSource = await readFile(new URL('../src/features/backfill/reconcile.ts', import.meta.url), 'utf8')
const applySource = await readFile(new URL('../src/features/backfill/applyBackfill.ts', import.meta.url), 'utf8')
const promptSource = await readFile(new URL('../src/ai/prompts/backfill.ts', import.meta.url), 'utf8')
const importBackfillPageSource = await readFile(new URL('../src/pages/backfill/ImportBackfillPage.tsx', import.meta.url), 'utf8')
const useImportBackfillSource = await readFile(new URL('../src/features/backfill/useImportBackfill.ts', import.meta.url), 'utf8')
const novelImportModalSource = await readFile(new URL('../src/pages/works/NovelImportModal.tsx', import.meta.url), 'utf8')
const packageSource = await readFile(new URL('../package.json', import.meta.url), 'utf8')

let nextId = 0
const generateId = () => `test-id-${nextId += 1}`

function loadModule(source, requireMap = {}) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  })
  const module = { exports: {} }
  const require = (name) => {
    if (name in requireMap) return requireMap[name]
    throw new Error(`Unexpected test require: ${name}`)
  }
  Function('exports', 'require', 'module', outputText)(module.exports, require, module)
  return module.exports
}

const confidence = loadModule(confidenceSource)
const chunking = loadModule(chunkingSource)
const extract = loadModule(extractSource, {
  '@/utils/id': { generateId },
  './confidence': confidence,
})
const reconcile = loadModule(reconcileSource, { './confidence': confidence })
const applyBackfill = loadModule(applySource, { '@/utils/id': { generateId } })

const work = {
  id: 'work-1',
  ownerId: 'owner-1',
  shared: false,
  title: '导入作品',
  createdAt: 1,
  updatedAt: 1,
  seed: { timePeriod: '已有时代', regions: [], genre: '', coreConcept: '', tone: '' },
  characters: [],
  settings: [],
  constraints: [],
  storylines: [],
  outline: [
    { id: 'outline-1', title: '第一章 雨夜', summary: '', order: 0, level: 'chapter', characterIds: [], storylineIds: [] },
    { id: 'outline-2', title: '第二章 天明', summary: '已有摘要', order: 1, level: 'chapter', characterIds: [], storylineIds: [] },
  ],
  chapters: [
    { id: 'chapter-1', outlineId: 'outline-1', title: '第一章 雨夜', content: '林晚在雨夜推开旧宅大门。\n\n她发现墙上刻着家族禁令。', wordCount: 24, scenes: [], versions: [] },
    { id: 'chapter-2', outlineId: 'outline-2', title: '第二章 天明', content: '', wordCount: 0, scenes: [], versions: [] },
  ],
}

const longChapter = {
  ...work.chapters[0],
  content: Array.from({ length: 12 }, (_, index) => `第${index + 1}段：林晚继续追查旧宅秘密，发现新的线索。`.repeat(10)).join('\n\n'),
}
const windows = chunking.buildBackfillWindows([longChapter, work.chapters[1]], { maxChars: 260, overlapChars: 30 })
assert.ok(windows.windows.length > 1, 'long chapters should be split into multiple extraction windows')
assert.ok(windows.windows.every(window => window.text.length <= 260), 'each extraction window should stay below the configured cap')
assert.equal(windows.skipped[0].reason, '本章暂无可用于反推的正文', 'empty chapters should return a user-readable skip reason')

const firstWindow = chunking.buildBackfillWindows([work.chapters[0]], { maxChars: 500, overlapChars: 40 }).windows[0]
const summaryResult = extract.parseBackfillJson('chapterSummary', '{"candidates":[{"summary":"林晚进入旧宅并发现家族禁令。","confidence":0.91,"sourceExcerpt":"林晚在雨夜推开旧宅大门"}]}', firstWindow)
assert.equal(summaryResult.errors.length, 0, 'valid chapter summary JSON should parse without errors')
assert.equal(summaryResult.candidates[0].evidenceLabel, '证据充分', 'candidate with source excerpt and high confidence should be easy to review')

const missingSourceResult = extract.parseBackfillJson('characters', '{"candidates":[{"name":"林晚","role":"major","bio":"进入旧宅的人","traits":["谨慎"],"confidence":0.95}]}', firstWindow)
assert.equal(missingSourceResult.candidates[0].evidenceLabel, '需要核对', 'missing source excerpts should prevent strong-evidence grouping')

const malformedResult = extract.parseBackfillJson('characters', 'not json', firstWindow)
assert.equal(malformedResult.candidates.length, 0, 'malformed AI output should not produce candidates')
assert.match(malformedResult.errors[0], /无法解析/, 'malformed AI output should return recoverable error text')

const duplicateCharacters = reconcile.reconcileBackfillCandidates([
  missingSourceResult.candidates[0],
  {
    ...missingSourceResult.candidates[0],
    id: 'dup-1',
    value: { ...missingSourceResult.candidates[0].value, name: '林晚', aliases: ['林小姐'], traits: ['敏锐'] },
    sources: [{ ...missingSourceResult.candidates[0].sources[0], excerpt: '林晚在雨夜推开旧宅大门' }],
    confidence: 0.86,
  },
])
assert.equal(duplicateCharacters.length, 1, 'duplicate character candidates should be merged')
assert.deepEqual(duplicateCharacters[0].value.traits.sort(), ['敏锐', '谨慎'], 'merged character should preserve traits from multiple windows')
assert.equal(duplicateCharacters[0].sources.length, 2, 'merged character should preserve multiple source excerpts')

const acceptedSummary = { ...summaryResult.candidates[0], reviewStatus: 'accepted' }
const acceptedCharacter = { ...duplicateCharacters[0], reviewStatus: 'accepted' }
const ignoredSetting = {
  id: 'setting-1',
  task: 'settings',
  title: '旧宅',
  value: { category: 'world', title: '旧宅', content: '林晚发现秘密的地点。' },
  sources: firstWindow ? [{ chapterId: 'chapter-1', chapterTitle: '第一章 雨夜', outlineId: 'outline-1', excerpt: '旧宅', windowIndex: 1 }] : [],
  confidence: 0.8,
  evidenceLabel: '证据充分',
  reviewStatus: 'ignored',
}
const seedCandidate = {
  id: 'seed-1',
  task: 'seed',
  title: 'timePeriod',
  value: { field: 'timePeriod', value: '近未来' },
  sources: [{ chapterId: 'chapter-1', chapterTitle: '第一章 雨夜', outlineId: 'outline-1', excerpt: '雨夜', windowIndex: 1 }],
  confidence: 0.8,
  evidenceLabel: '证据充分',
  reviewStatus: 'accepted',
}
const originalChapterContent = work.chapters.map(chapter => chapter.content).join('\n---\n')
const applied = applyBackfill.applyBackfillPatch(work, [acceptedSummary, acceptedCharacter, ignoredSetting, seedCandidate])
assert.equal('chapters' in applied.patch, false, 'backfill patch must never include chapters')
assert.equal(applied.work.chapters.map(chapter => chapter.content).join('\n---\n'), originalChapterContent, 'chapter content should remain byte-for-byte unchanged')
assert.equal(applied.work.outline[0].summary, '林晚进入旧宅并发现家族禁令。', 'accepted summary should update the matching outline node')
assert.equal(applied.work.characters.length, 1, 'accepted character should be added to stage data')
assert.equal(applied.work.settings.length, 0, 'ignored candidates should not be written')
assert.equal(applied.work.seed.timePeriod, '已有时代', 'non-empty seed fields should not be replaced by default')
assert.ok(applied.summary.replacementWarnings.some(text => text.includes('timePeriod')), 'protected existing fields should produce replacement warnings')
assert.match(applyBackfill.formatBackfillImpact(applied.summary), /正文 0 处修改/, 'impact summary should explicitly state body text is untouched')

assert.match(promptSource, /小段正文摘录/, 'backfill prompt should frame extraction as evidence-based small excerpts')
assert.match(promptSource, /不要改写正文/, 'backfill prompt should forbid rewriting imported body text')
assert.doesNotMatch(promptSource, /整章正文\$\{/, 'backfill prompt should not interpolate full chapter bodies by name')
assert.match(importBackfillPageSource, /确认写入前不保存候选/, 'wizard should explain candidates are temporary until confirmation')
assert.match(importBackfillPageSource, /正文 0 处修改/, 'wizard should surface write impact before confirmation')
assert.match(useImportBackfillSource, /db\.works\.update\(currentWork\.id, applied\.patch\)/, 'confirmed write should reuse the existing works update path')
assert.match(novelImportModalSource, /navigate\('\/backfill'\)/, 'successful import should route to the stage backfill entry')
assert.match(packageSource, /test:stage-backfill/, 'root scripts should register the stage backfill behavior test')

console.log('stage-backfill behavior assertions passed')
