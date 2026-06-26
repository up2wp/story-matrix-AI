import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const importSource = await readFile(new URL('../src/features/import/novelImport.ts', import.meta.url), 'utf8')
const importPromptSource = await readFile(new URL('../src/ai/prompts/import.ts', import.meta.url), 'utf8')
const importModalSource = await readFile(new URL('../src/pages/works/NovelImportModal.tsx', import.meta.url), 'utf8')
const packageSource = await readFile(new URL('../package.json', import.meta.url), 'utf8')

function loadNovelImportForTest() {
  let nextId = 0
  const executableSource = importSource
    .replace(/^import type .*$/gm, '')
    .replace(/^import \{ generateId \}.*$/m, 'const generateId = () => `test-id-${nextId += 1}`')
    .replace(/^export type .*$/gm, '')
    .replace(/^export interface [\s\S]*?^\}/gm, '')
    .replace('export function canImportNovelFile', 'function canImportNovelFile')
    .replace('export function parseNovelImportDraft', 'function parseNovelImportDraft')
    .replace('export function parseAiBoundaryJson', 'function parseAiBoundaryJson')
    .replace('export function applyAiBoundarySuggestions', 'function applyAiBoundarySuggestions')
    .replace('export function createWorkFromImportDraft', 'function createWorkFromImportDraft')
  const { outputText } = ts.transpileModule(executableSource, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2023 },
  })
  return Function('nextId', `${outputText}; return { canImportNovelFile, parseNovelImportDraft, parseAiBoundaryJson, applyAiBoundarySuggestions, createWorkFromImportDraft }`)(nextId)
}

const {
  canImportNovelFile,
  parseNovelImportDraft,
  parseAiBoundaryJson,
  applyAiBoundarySuggestions,
  createWorkFromImportDraft,
} = loadNovelImportForTest()

assert.equal(canImportNovelFile('novel.md'), true, 'Markdown novels should be accepted')
assert.equal(canImportNovelFile('novel.txt'), true, 'TXT novels should be accepted')
assert.equal(canImportNovelFile('novel.pdf'), false, 'unsupported formats should be rejected before parsing')

const markdownDraft = parseNovelImportDraft('星桥.md', '# 第一章 雨夜\n正文一\n\n## 第二章 天明\n正文二')
assert.equal(markdownDraft.title, '星桥', 'draft title should come from the file name')
assert.equal(markdownDraft.chapters.length, 2, 'Markdown headings should create chapter drafts')
assert.deepEqual(markdownDraft.chapters.map((chapter) => chapter.title), ['第一章 雨夜', '第二章 天明'], 'Markdown heading markers should not persist in chapter titles')
assert.deepEqual(markdownDraft.chapters.map((chapter) => chapter.body), ['正文一', '正文二'], 'chapter bodies should preserve source order and text')

const chineseDraft = parseNovelImportDraft('旧稿.txt', '序言文字\n第 一 章 初见\n她推门而入。\n第 二 章 回声\n他听见钟声。')
assert.equal(chineseDraft.chapters.length, 2, 'Chinese 第 X 章 headings should create ordered chapters')
assert.equal(chineseDraft.issues.some((issue) => issue.message.includes('章节标题前存在正文')), true, 'prose before the first chapter should be surfaced as a warning')

const emptyDraft = parseNovelImportDraft('empty.txt', '   ')
assert.equal(emptyDraft.chapters.length, 0, 'empty files should not create empty works')
assert.equal(emptyDraft.issues[0].level, 'error', 'empty files should return an error issue')

const unsupportedDraft = parseNovelImportDraft('novel.docx', '第 1 章\n正文')
assert.equal(unsupportedDraft.chapters.length, 0, 'unsupported files should not be parsed')
assert.equal(unsupportedDraft.issues[0].message, '仅支持导入 .txt 或 .md 文件')

const ambiguousDraft = parseNovelImportDraft('散文.txt', '没有明显章节，但是有很多段落。')
assert.equal(ambiguousDraft.chapters.length, 0, 'ambiguous prose should stay as draft warnings instead of becoming a final work')
assert.equal(ambiguousDraft.needsReview, false, 'no error is present, but creation still requires chapters from review or AI suggestions')

const suggestions = parseAiBoundaryJson('```json\n[{"title":"第一章 建议","startOffset":0,"confidence":0.61}]\n```')
assert.equal(suggestions[0].confidence, 0.61, 'AI boundary parser should tolerate fenced JSON arrays')
const aiDraft = applyAiBoundarySuggestions(ambiguousDraft, suggestions)
assert.equal(aiDraft.chapters[0].source, 'ai', 'AI suggestions should be marked as AI sourced')
assert.equal(aiDraft.chapters[0].needsReview, true, 'AI-suggested boundaries should require review')

const work = createWorkFromImportDraft(markdownDraft, 'owner-1')
assert.equal(work.ownerId, 'owner-1', 'imported works should belong to the current user')
assert.equal(work.shared, false, 'imported works should not be shared by default')
assert.equal(work.chapters.length, 2, 'confirmed import should create chapter bodies')
assert.equal(work.outline.length, 2, 'confirmed import should create matching outline nodes')
assert.equal(work.chapters[0].outlineId, work.outline[0].id, 'each imported chapter should link to its outline node')
assert.deepEqual(work.characters, [], 'stage backfill should not populate characters during body import')
assert.deepEqual(work.settings, [], 'stage backfill should not populate settings during body import')
assert.deepEqual(work.constraints, [], 'stage backfill should not populate constraints during body import')

assert.match(packageSource, /test:novel-import/, 'root test script should include the novel import behavior test')
assert.match(importPromptSource, /IMPORT_EXCERPT_LIMIT = 6000/, 'AI boundary prompt should cap import excerpts instead of sending a full novel')
assert.doesNotMatch(importPromptSource, /\$\{text\}/, 'AI boundary prompt should not pass unrestricted source text')
assert.match(importModalSource, /buildImportBoundaryPrompt\(sourceText\)/, 'import modal should request AI boundary suggestions through the bounded prompt builder')
assert.match(importModalSource, /applyAiBoundarySuggestions/, 'AI boundary suggestions should be applied as reviewable draft suggestions')
assert.match(importModalSource, /AI 建议必须人工确认后才能创建作品/, 'UI copy should make AI suggestions confirm-first')
assert.match(importModalSource, /lowConfidenceChapters\.length === 0/, 'low-confidence or AI-suggested chapters should block final work creation until confirmed')

console.log('novel-import behavior assertions passed')
