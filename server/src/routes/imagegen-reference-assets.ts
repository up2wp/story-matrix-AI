import { randomUUID } from 'crypto'
import busboy from 'busboy'
import { Router } from 'express'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import type { ImageGenerationConfig } from '../services/image-generation-config.js'
import { extensionForMime, MAX_IMAGE_BYTES, type ImageAssetVariant } from '../services/image-generation-runner.js'
import { createImagegenReferenceAsset, listImagegenReferenceAssets, readImagegenReferenceAsset, validateUploadedReferenceImage, type ImagegenReferenceAssetRecord } from '../services/imagegen-reference-assets.js'

type UploadedReferenceFile = {
  readonly buffer: Buffer
  readonly originalFilename?: string
}

type ImagegenReferenceAssetRouterInput = {
  readonly loadImageGenerationConfig: () => ImageGenerationConfig
  readonly canUseImageGeneration: (request: AuthenticatedRequest, config: ImageGenerationConfig) => boolean
  readonly safeErrorMessage: (error: unknown, fallback: string, config: ImageGenerationConfig) => string
}

function slugPart(value: string | undefined, fallback: string) {
  const normalized = String(value || fallback).trim().replace(/\s+/g, '-').replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '').slice(0, 48)
  return normalized || fallback
}

function referenceImmichFilename(ownerId: string, projectName: string | undefined, mimeType: string) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return [
    slugPart(projectName || 'story-matrix', 'story-matrix'),
    slugPart(ownerId, 'user'),
    'imagegen-reference',
    timestamp,
    randomUUID().slice(0, 8),
  ].join('-') + `.${extensionForMime(mimeType)}`
}

function imagegenReferenceAssetUrl(assetId: string, variant?: ImageAssetVariant) {
  const encoded = encodeURIComponent(assetId)
  return variant ? `/api/imagegen/reference-assets/${encoded}/${variant}` : `/api/imagegen/reference-assets/${encoded}`
}

function imageVariant(value: string | undefined): ImageAssetVariant {
  return value === 'original' ? 'original' : 'thumbnail'
}

function serializeReferenceAsset(record: ImagegenReferenceAssetRecord) {
  return {
    id: record.id,
    originalFilename: record.originalFilename,
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    storageMode: record.storageMode,
    storageStatus: record.storageStatus,
    thumbnailUrl: record.thumbnailUrl,
    originalUrl: record.originalUrl,
    createdAt: record.createdAt,
  }
}

function parseReferenceUpload(request: AuthenticatedRequest): Promise<UploadedReferenceFile> {
  return new Promise((resolve, reject) => {
    const contentType = request.headers['content-type']
    if (!contentType?.includes('multipart/form-data')) {
      reject(new Error('需要 multipart/form-data 上传参考图'))
      return
    }

    const parser = busboy({ headers: request.headers, limits: { files: 1, fields: 0, parts: 1, fileSize: MAX_IMAGE_BYTES } })
    const chunks: Buffer[] = []
    let uploadedFile: UploadedReferenceFile | undefined
    let browserMimeType = ''
    let originalFilename: string | undefined
    let invalidError: Error | undefined
    let fileCount = 0

    parser.on('file', (fieldName, file, info) => {
      fileCount += 1
      if (fieldName !== 'file') invalidError = new Error('参考图上传字段必须是 file')
      browserMimeType = info.mimeType
      originalFilename = info.filename
      file.on('limit', () => {
        invalidError = new Error('参考图不能超过 12MB')
      })
      file.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      file.on('close', () => {
        if (invalidError) return
        try {
          const buffer = Buffer.concat(chunks)
          validateUploadedReferenceImage(buffer, browserMimeType)
          uploadedFile = { buffer, originalFilename }
        } catch (error) {
          invalidError = error instanceof Error ? error : new Error('参考图上传失败')
        }
      })
    })
    parser.on('field', () => {
      invalidError = new Error('参考图上传不支持额外字段')
    })
    parser.on('filesLimit', () => {
      invalidError = new Error('一次只能上传一张参考图')
    })
    parser.on('fieldsLimit', () => {
      invalidError = new Error('参考图上传不支持额外字段')
    })
    parser.on('partsLimit', () => {
      invalidError = new Error('参考图上传只接受一个文件')
    })
    parser.on('error', reject)
    parser.on('close', () => {
      if (invalidError) {
        reject(invalidError)
        return
      }
      if (fileCount !== 1 || !uploadedFile) {
        reject(new Error('缺少参考图文件'))
        return
      }
      resolve(uploadedFile)
    })
    request.pipe(parser)
  })
}

export function createImagegenReferenceAssetRouter(input: ImagegenReferenceAssetRouterInput) {
  const router = Router()

  router.get('/', (req, res) => {
    const request = req as AuthenticatedRequest
    const config = input.loadImageGenerationConfig()
    if (!input.canUseImageGeneration(request, config)) return res.status(403).json({ error: '未授权使用生图功能' })
    return res.json(listImagegenReferenceAssets(request.currentUser.id).map(serializeReferenceAsset))
  })

  router.post('/', async (req, res) => {
    const request = req as AuthenticatedRequest
    const config = input.loadImageGenerationConfig()
    if (!input.canUseImageGeneration(request, config)) return res.status(403).json({ error: '未授权使用生图功能' })
    try {
      const upload = await parseReferenceUpload(request)
      const record = await createImagegenReferenceAsset({
        ownerId: request.currentUser.id,
        buffer: upload.buffer,
        originalFilename: upload.originalFilename,
        config,
        publicAssetUrl: imagegenReferenceAssetUrl,
        immichFilename: mimeType => referenceImmichFilename(request.currentUser.id, config.immich?.projectName, mimeType),
      })
      return res.status(201).json(serializeReferenceAsset(record))
    } catch (error) {
      return res.status(400).json({ error: input.safeErrorMessage(error, '参考图上传失败', config) })
    }
  })

  router.get('/:referenceId', async (req, res) => {
    const request = req as unknown as AuthenticatedRequest
    const config = input.loadImageGenerationConfig()
    if (!input.canUseImageGeneration(request, config)) return res.status(403).json({ error: '未授权使用生图功能' })
    try {
      const image = await readImagegenReferenceAsset(request.currentUser.id, req.params.referenceId, config, 'thumbnail')
      res.setHeader('Content-Type', image.mimeType)
      res.setHeader('Cache-Control', 'private, no-store')
      return res.end(image.buffer)
    } catch (error) {
      return res.status(404).json({ error: error instanceof Error ? error.message : '参考图不存在' })
    }
  })

  router.get('/:referenceId/:variant', async (req, res) => {
    const request = req as unknown as AuthenticatedRequest
    const config = input.loadImageGenerationConfig()
    if (!input.canUseImageGeneration(request, config)) return res.status(403).json({ error: '未授权使用生图功能' })
    try {
      const image = await readImagegenReferenceAsset(request.currentUser.id, req.params.referenceId, config, imageVariant(req.params.variant))
      res.setHeader('Content-Type', image.mimeType)
      res.setHeader('Cache-Control', 'private, no-store')
      return res.end(image.buffer)
    } catch (error) {
      return res.status(404).json({ error: error instanceof Error ? error.message : '参考图不存在' })
    }
  })

  return router
}
