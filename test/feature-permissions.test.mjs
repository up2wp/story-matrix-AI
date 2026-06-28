import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/core/feature-permissions.ts', import.meta.url), 'utf8')

function loadFeaturePermissionsForTest() {
  const executableSource = source
    .replace(/^import type .*$/gm, '')
    .replace(/^export const /gm, 'const ')
    .replace(/^export function /gm, 'function ')
  const { outputText } = ts.transpileModule(executableSource, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2023 },
  })
  return Function(`${outputText}; return { ALL_FEATURE_KEYS, normalizeNovelImportConfig, canUseFeature, setUserFeatureGrant, grantedFeaturesForUser }`)()
}

const { ALL_FEATURE_KEYS, normalizeNovelImportConfig, canUseFeature, setUserFeatureGrant, grantedFeaturesForUser } = loadFeaturePermissionsForTest()

assert.deepEqual(ALL_FEATURE_KEYS, ['novelImport', 'importBackfill', 'imageGeneration'], 'feature registry should include import and image generation features')

const owner = { id: 'owner-1', username: 'owner', displayName: 'Owner', role: 'owner', createdAt: 1 }
const admin = { id: 'admin-1', username: 'admin', displayName: 'Admin', role: 'admin', createdAt: 1 }
const user = { id: 'user-1', username: 'baozi', displayName: '包子', role: 'user', createdAt: 1 }
const otherUser = { id: 'user-2', username: 'other', displayName: 'Other', role: 'user', createdAt: 1 }

const disabledConfig = normalizeNovelImportConfig({ enabled: false, featurePermissions: { userGrants: [{ userId: 'user-1', features: ['novelImport'] }] } })
assert.equal(canUseFeature(owner, disabledConfig, 'novelImport'), false, 'global switch should disable owner access too')

const enabledConfig = normalizeNovelImportConfig({ enabled: true })
assert.equal(canUseFeature(owner, enabledConfig, 'novelImport'), true, 'owners should have default feature access when the global switch is on')
assert.equal(canUseFeature(admin, enabledConfig, 'importBackfill'), true, 'admins should have default feature access when the global switch is on')
assert.equal(canUseFeature(user, enabledConfig, 'novelImport'), false, 'ordinary users should not get feature access without explicit grants')

const grantedImport = setUserFeatureGrant(enabledConfig, user.id, 'novelImport', true)
assert.equal(canUseFeature(user, grantedImport, 'novelImport'), true, 'explicit user grant should enable the selected feature')
assert.equal(canUseFeature(user, grantedImport, 'importBackfill'), false, 'one feature grant should not imply other feature access')
assert.equal(canUseFeature(otherUser, grantedImport, 'novelImport'), false, 'user grants should not leak to other ordinary users')

const grantedBoth = setUserFeatureGrant(grantedImport, user.id, 'importBackfill', true)
assert.deepEqual(grantedFeaturesForUser(grantedBoth, user.id), ['novelImport', 'importBackfill'], 'grant helper should preserve multiple features for the same user')

const grantedImage = setUserFeatureGrant(grantedBoth, user.id, 'imageGeneration', true)
assert.equal(canUseFeature(user, grantedImage, 'imageGeneration'), true, 'image generation should use the same explicit grant model as other gated features')

const revokedImport = setUserFeatureGrant(grantedImage, user.id, 'novelImport', false)
assert.deepEqual(grantedFeaturesForUser(revokedImport, user.id), ['importBackfill', 'imageGeneration'], 'revoking one feature should preserve the rest')

const revokedAll = setUserFeatureGrant(revokedImport, user.id, 'importBackfill', false)
const revokedImage = setUserFeatureGrant(revokedAll, user.id, 'imageGeneration', false)
assert.deepEqual(grantedFeaturesForUser(revokedImage, user.id), [], 'empty user grants should be removed from config')

console.log('feature-permissions behavior assertions passed')
