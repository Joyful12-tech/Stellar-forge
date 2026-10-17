import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input, Button, ProgressBar } from './UI'
import { useToast } from '../context/ToastContext'
import { useWalletContext } from '../context/WalletContext'
import { ipfsService, MAX_METADATA_DESCRIPTION_LENGTH } from '../services/ipfs'
import { useIpfsReady } from '../hooks/useIpfsReady'
import { isValidImageFile } from '../utils/validation'
import { DropZone } from './DropZone'
import { logger } from '../utils/logger'

interface MetadataUploadFormProps {
  onUploadComplete: (metadataUri: string) => void
  isLoading?: boolean
}

export const MetadataUploadForm: React.FC<MetadataUploadFormProps> = ({
  onUploadComplete,
  isLoading = false,
}) => {
  const { t } = useTranslation()
  const { addToast } = useToast()
  const { wallet } = useWalletContext()

  const [tokenName, setTokenName] = useState('')
  const [description, setDescription] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)

  const ipfsReadiness = useIpfsReady()
  const ipfsReady = ipfsReadiness === 'ready' && wallet.isConnected

  const [imagePreview, setImagePreview] = useState<string | null>(null)

  const handleImageSelect = async (file: File) => {
    const validation = await isValidImageFile(file)
    if (!validation.valid) {
      addToast(validation.error || 'Invalid image file', 'error')
      setImageFile(null)
      setImagePreview(null)
      return
    }

    setImageFile(file)

    // Create preview
    const reader = new FileReader()
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveImage = () => {
    setImageFile(null)
    setImagePreview(null)
    // Reset the input
    const input = document.getElementById('image') as HTMLInputElement
    if (input) input.value = ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!ipfsReady) {
      addToast('IPFS is not configured', 'error')
      return
    }

    if (!imageFile) {
      addToast('Please select an image file', 'error')
      return
    }

    if (!tokenName.trim()) {
      addToast('Please enter a token name', 'error')
      return
    }

    if (description.length > MAX_METADATA_DESCRIPTION_LENGTH) {
      addToast(
        `Description must be ${MAX_METADATA_DESCRIPTION_LENGTH} characters or fewer`,
        'error',
      )
      return
    }

    setIsUploading(true)
    try {
      const metadataUri = await ipfsService.uploadMetadata(
        imageFile,
        description,
        tokenName,
        wallet.address!,
        (progress) => setUploadProgress(progress),
        (attempt) => addToast(`Retrying upload… (attempt ${attempt}/3)`, 'warning'),
      )

      addToast('Metadata uploaded successfully!', 'success')
      onUploadComplete(metadataUri)

      // Reset form
      setTokenName('')
      setDescription('')
      setImageFile(null)
      setUploadProgress(0)
    } catch (error) {
      logger.error('Upload error:', error)
      addToast(error instanceof Error ? error.message : 'Failed to upload metadata', 'error')
    } finally {
      setIsUploading(false)
    }
  }

  // The three reasons uploads may be unavailable are distinct and used to be
  // collapsed into one "set your API keys" message — which was wrong advice
  // for two of them.
  if (ipfsReadiness === 'checking') {
    return (
      <div
        className="rounded-lg border border-gray-200 dark:border-gray-700 p-4"
        aria-busy="true"
        role="status"
      >
        <p className="text-sm text-gray-500 dark:text-gray-400">Checking upload availability…</p>
      </div>
    )
  }

  if (ipfsReadiness === 'unconfigured') {
    return (
      <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 p-4">
        <p className="text-sm text-yellow-800 dark:text-yellow-300">
          IPFS upload is disabled: this deployment has no pinning credentials. Set{' '}
          <code className="font-mono bg-yellow-100 dark:bg-yellow-900 px-1 rounded">
            PINATA_API_KEY
          </code>{' '}
          and{' '}
          <code className="font-mono bg-yellow-100 dark:bg-yellow-900 px-1 rounded">
            PINATA_API_SECRET
          </code>{' '}
          in the server environment to enable metadata uploads.
        </p>
      </div>
    )
  }

  if (!wallet.isConnected) {
    return (
      <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 p-4">
        <p className="text-sm text-yellow-800 dark:text-yellow-300">
          Connect your wallet to upload token metadata.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Input
          label={t('tokenForm.nameLabel')}
          value={tokenName}
          onChange={(e) => setTokenName(e.target.value)}
          placeholder={t('tokenForm.namePlaceholder')}
          required
        />
      </div>

      <div>
        <label
          htmlFor="description"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t('tokenForm.descriptionLabel')}
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('tokenForm.descriptionPlaceholder')}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
          rows={3}
          maxLength={MAX_METADATA_DESCRIPTION_LENGTH}
        />
      </div>

      <div>
        {/* Not a <label> — DropZone is a role="button" div with its own aria-label, not a labelable form control */}
        <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Token Image (JPEG, PNG, GIF — max 5MB)
        </p>
        <DropZone
          onFileSelect={handleImageSelect}
          acceptedTypes={['image/jpeg', 'image/png', 'image/gif']}
          maxSizeMB={5}
        />
        {imagePreview && (
          <div className="mt-4 flex flex-col items-center space-y-2">
            <img
              src={imagePreview}
              alt="Token preview"
              className="max-w-32 max-h-32 object-contain border border-gray-300 dark:border-gray-600 rounded-md"
            />
            <div className="text-center">
              <p className="text-sm text-gray-600 dark:text-gray-400">{imageFile?.name}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {(imageFile?.size || 0) / 1024 / 1024 < 1
                  ? `${Math.round((imageFile?.size || 0) / 1024)} KB`
                  : `${((imageFile?.size || 0) / 1024 / 1024).toFixed(2)} MB`}
              </p>
              <button
                type="button"
                onClick={handleRemoveImage}
                className="mt-2 text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
              >
                Remove image
              </button>
            </div>
          </div>
        )}
      </div>

      {isUploading && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">Uploading...</span>
            <span className="font-medium text-gray-900 dark:text-white">{uploadProgress}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <ProgressBar progress={uploadProgress} />
          </div>
        </div>
      )}

      <Button type="submit" disabled={!imageFile || isUploading || isLoading} className="w-full">
        {isUploading ? 'Uploading...' : 'Upload Metadata'}
      </Button>
    </form>
  )
}
