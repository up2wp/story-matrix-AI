import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/core/feature-permissions.ts', import.meta.url), 'utf8')
const serverIndexSource = await readFile(new URL('../server/src/index.ts', import.meta.url), 'utf8')
const imagegenRouteSource = await readFile(new URL('../server/src/routes/imagegen.ts', import.meta.url), 'utf8')
const imagegenReferenceRouteSource = await readFile(new URL('../server/src/routes/imagegen-reference-assets.ts', import.meta.url), 'utf8')
const sidebarSource = await readFile(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8')

function loadFeaturePermissionsForTest() {
  const executableSource = source
    .replace(/^import type .*$/gm, '')
    .replace(/^export type /gm, 'type ')
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

function featureSources(novelImportConfig, imageGenerationEnabled = false) {
  return { novelImportConfig, imageGenerationConfig: { enabled: imageGenerationEnabled } }
}

const imageEnabledImportDisabled = {
  novelImportConfig: normalizeNovelImportConfig({
    enabled: false,
    featurePermissions: { userGrants: [{ userId: user.id, features: ['imageGeneration'] }] },
  }),
  imageGenerationConfig: { enabled: true },
}
assert.equal(canUseFeature(owner, imageEnabledImportDisabled, 'imageGeneration'), true, 'owners should use image generation when its switch is on even if novel import is off')
assert.equal(canUseFeature(admin, imageEnabledImportDisabled, 'imageGeneration'), true, 'admins should use image generation when its switch is on even if novel import is off')
assert.equal(canUseFeature(user, imageEnabledImportDisabled, 'imageGeneration'), true, 'image generation grants should remain in novel import feature permissions')
assert.equal(canUseFeature(otherUser, imageEnabledImportDisabled, 'imageGeneration'), false, 'ungranted users should not use image generation')
assert.equal(canUseFeature(owner, imageEnabledImportDisabled, 'novelImport'), false, 'novel import should remain disabled when only image generation is on')
assert.equal(canUseFeature(admin, imageEnabledImportDisabled, 'importBackfill'), false, 'import backfill should remain disabled when novel import is off')

const imageDisabledImportEnabled = {
  novelImportConfig: normalizeNovelImportConfig({
    enabled: true,
    featurePermissions: { userGrants: [{ userId: user.id, features: ['imageGeneration'] }] },
  }),
  imageGenerationConfig: { enabled: false },
}
assert.equal(canUseFeature(owner, imageDisabledImportEnabled, 'imageGeneration'), false, 'owners should not use image generation when its switch is off')
assert.equal(canUseFeature(admin, imageDisabledImportEnabled, 'imageGeneration'), false, 'admins should not use image generation when its switch is off')
assert.equal(canUseFeature(user, imageDisabledImportEnabled, 'imageGeneration'), false, 'granted users should not use image generation when its switch is off')
assert.equal(canUseFeature(otherUser, imageDisabledImportEnabled, 'imageGeneration'), false, 'ungranted users should not use image generation when its switch is off')

const disabledConfig = normalizeNovelImportConfig({ enabled: false, featurePermissions: { userGrants: [{ userId: 'user-1', features: ['novelImport'] }] } })
assert.equal(canUseFeature(owner, featureSources(disabledConfig), 'novelImport'), false, 'global switch should disable owner access too')

const enabledConfig = normalizeNovelImportConfig({ enabled: true })
assert.equal(canUseFeature(owner, featureSources(enabledConfig), 'novelImport'), true, 'owners should have default feature access when the global switch is on')
assert.equal(canUseFeature(admin, featureSources(enabledConfig), 'importBackfill'), true, 'admins should have default feature access when the global switch is on')
assert.equal(canUseFeature(user, featureSources(enabledConfig), 'novelImport'), false, 'ordinary users should not get feature access without explicit grants')

const grantedImport = setUserFeatureGrant(enabledConfig, user.id, 'novelImport', true)
assert.equal(canUseFeature(user, featureSources(grantedImport), 'novelImport'), true, 'explicit user grant should enable the selected feature')
assert.equal(canUseFeature(user, featureSources(grantedImport), 'importBackfill'), false, 'one feature grant should not imply other feature access')
assert.equal(canUseFeature(otherUser, featureSources(grantedImport), 'novelImport'), false, 'user grants should not leak to other ordinary users')

const grantedBoth = setUserFeatureGrant(grantedImport, user.id, 'importBackfill', true)
assert.deepEqual(grantedFeaturesForUser(grantedBoth, user.id), ['novelImport', 'importBackfill'], 'grant helper should preserve multiple features for the same user')

const grantedImage = setUserFeatureGrant(grantedBoth, user.id, 'imageGeneration', true)
assert.equal(canUseFeature(user, featureSources(grantedImage, true), 'imageGeneration'), true, 'image generation should use the same explicit grant model as other gated features')
assert.match(serverIndexSource, /app\.use\('\/api\/imagegen', requireAuth, imagegenRouter\)/, 'imagegen test API should be mounted behind the same authentication middleware as work image generation')
assert.match(imagegenRouteSource, /canUseImageGeneration[\s\S]*config\.enabled[\s\S]*features\?\.includes\('imageGeneration'\)/, 'imagegen test API should gate ordinary users through the imageGeneration feature key')
assert.match(imagegenRouteSource, /owner|admin/, 'imagegen test API should preserve owner and admin default access when image generation is enabled')
assert.match(imagegenRouteSource, /router\.use\('\/reference-assets', createImagegenReferenceAssetRouter/, 'imagegen test API should mount reference uploads under the independent owner-scoped namespace')
assert.match(imagegenReferenceRouteSource, /router\.post\('\/'[\s\S]*canUseImageGeneration[\s\S]*createImagegenReferenceAsset/, 'imagegen reference uploads should use the same imageGeneration feature gate as test generation')
assert.match(imagegenReferenceRouteSource, /router\.get\('\/'[\s\S]*canUseImageGeneration[\s\S]*listImagegenReferenceAssets/, 'imagegen reference listing should be blocked by the imageGeneration feature gate, not just authentication')
assert.match(imagegenReferenceRouteSource, /router\.get\('\/:referenceId[\s\S]*canUseImageGeneration[\s\S]*readImagegenReferenceAsset/, 'imagegen reference preview should be blocked by the imageGeneration feature gate, not just authentication')
assert.doesNotMatch(imagegenRouteSource, /import \{ canUseFeature \}|import\s+workAccess|workAccess\(/, 'imagegen test API should not reuse frontend permission helpers or work access for owner-scoped test assets')
assert.match(sidebarSource, /canOpenImagegen = imageGenerationEnabled && canUseFeature\(user, permissionSources, 'imageGeneration'\)[\s\S]*key: '\/imagegen'[\s\S]*label: '生图测试'/, 'sidebar should gate the independent imagegen console with the global switch and imageGeneration feature permission')
assert.doesNotMatch(sidebarSource, /canOpenImagegen = hasWork|canOpenImagegen = Boolean\(currentWork/, 'sidebar imagegen console should remain available without currentWork')

const revokedImport = setUserFeatureGrant(grantedImage, user.id, 'novelImport', false)
assert.deepEqual(grantedFeaturesForUser(revokedImport, user.id), ['importBackfill', 'imageGeneration'], 'revoking one feature should preserve the rest')

const revokedAll = setUserFeatureGrant(revokedImport, user.id, 'importBackfill', false)
const revokedImage = setUserFeatureGrant(revokedAll, user.id, 'imageGeneration', false)
assert.deepEqual(grantedFeaturesForUser(revokedImage, user.id), [], 'empty user grants should be removed from config')

console.log('feature-permissions behavior assertions passed')
