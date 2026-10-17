import React, { useState, useRef } from 'react'
import {
  Button,
  ConfirmModal,
  InsufficientBalanceWarning,
  ProgressIndicator,
  ProgressBar,
} from './UI'
import type { ProgressStep } from './UI'
import { Input } from './UI/Input'
import { isValidImageFile } from '../utils/validation'
import { MAX_METADATA_DESCRIPTION_LENGTH, type UploadMetadataResult } from '../services/ipfs'
import { useToast } from '../context/ToastContext'
import { useStellarContext } from '../context/StellarContext'
import { useWalletContext } from '../context/WalletContext'
import { useBalanceCheck } from '../hooks/useBalanceCheck'
import { useNetwork } from '../context/NetworkContext'
import { useNetworkGuard } from '../hooks/useNetworkGuard'
import { useTos } from '../context/TosContext'
import { useIpfsReady } from '../hooks/useIpfsReady'
import { ExplorerLink } from './ExplorerLink'
import { useFactoryState } from '../hooks/useFactoryState'
import { TransactionSubmissionError } from '../services/transactionSubmission'

// metadata_fee from contract is in stroops (i128 string); 1 XLM = 10_000_000 stroops
const STROOPS_PER_XLM = 10_000_000

interface MetadataFormProps {
  /** Pre-fill the token address field (e.g. from a token detail page) */
  initialTokenAddress?: string
}

type Step = 'idle' | 'uploading-ipfs' | 'confirming-stellar' | 'done' | 'error'

export const MetadataForm: React.FC<MetadataFormProps> = ({ initialTokenAddress = '' }) => {
  const { ipfsService, stellarService } = useStellarContext()
  const { addToast } = useToast()
  const { wallet } = useWalletContext()
  const { network } = useNetwork()
  const { blocked: networkBlocked, reason: networkReason } = useNetworkGuard()
  const { requireTos } = useTos()
  const { state: factoryState } = useFactoryState()

  const metadataFeeXlm = factoryState?.metadataFee
    ? parseFloat(factoryState.metadataFee) / STROOPS_PER_XLM
    : 0.01
  const metadataFeeStroops = factoryState?.metadataFee ?? String(0.01 * STROOPS_PER_XLM)

  const { hasSufficientBalance, shortfall, isTestnet } = useBalanceCheck(metadataFeeXlm)

  const [tokenAddress, setTokenAddress] = useState(initialTokenAddress)
  const [description, setDescription] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [step, setStep] = useState<Step>('idle')
  const [pendingConfirm, setPendingConfirm] = useState(false)
  const [finalUri, setFinalUri] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const ipfsReadiness = useIpfsReady()
  const ipfsReady = ipfsReadiness === 'ready'
  const isSubmitting = step === 'uploading-ipfs' || step === 'confirming-stellar'

  const progressSteps: ProgressStep[] = [
    {
      label: 'Uploading to IPFS…',
      status:
        step === 'uploading-ipfs'
          ? 'in-progress'
          : step === 'confirming-stellar' || step === 'done'
            ? 'completed'
            : step === 'error' && !finalUri
              ? 'error'
              : 'pending',
    },
    {
      label: 'Confirming on Stellar…',
      status:
        step === 'confirming-stellar'
          ? 'in-progress'
          : step === 'done'
            ? 'completed'
            : step === 'error' && finalUri
              ? 'error'
              : 'pending',
    },
  ]

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const validation = await isValidImageFile(file)
    if (!validation.valid) {
      addToast(validation.error ?? 'Invalid image file', 'error')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setImagePreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const handleRemoveImage = () => {
    setImageFile(null)
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!imageFile) {
      addToast('Please select an image file', 'error')
      return
    }
    if (!tokenAddress.trim()) {
      addToast('Please enter a token address', 'error')
      return
    }
    if (description.length > MAX_METADATA_DESCRIPTION_LENGTH) {
      addToast(
        `Description must be ${MAX_METADATA_DESCRIPTION_LENGTH} characters or fewer`,
        'error',
      )
      return
    }
    requireTos(() => setPendingConfirm(true))
  }

  const handleConfirm = async () => {
    setPendingConfirm(false)
    setErrorMsg(null)
    setFinalUri(null)
    setTxHash(null)

    // Step 1: IPFS
    setStep('uploading-ipfs')
    let uploadResult: UploadMetadataResult | null = null
    try {
      uploadResult = await ipfsService.uploadMetadataDetailed(
        imageFile!,
        description,
        tokenAddress,
        wallet.address!,
        (p) => setUploadProgress(p),
        (attempt) => addToast(`Retrying upload… (attempt ${attempt}/3)`, 'warning'),
      )
      setFinalUri(uploadResult.metadataUri)
    } catch (err) {
      setStep('error')
      const msg = err instanceof Error ? err.message : 'IPFS upload failed'
      setErrorMsg(msg)
      addToast(msg, 'error')
      // If the image was pinned but the metadata JSON upload failed, reclaim
      // the image pin rather than leaving it permanently billed.
      void ipfsService.unpinLastUpload(wallet.address!).catch(() => {})
      return
    }

    // Step 2: Stellar
    setStep('confirming-stellar')
    try {
      const hash = await stellarService.setMetadata({
        tokenAddress: tokenAddress.trim(),
        metadataUri: uploadResult.metadataUri,
        feePayment: metadataFeeStroops,
      })
      setTxHash(hash)
      setStep('done')
      addToast('Metadata linked on-chain!', 'success')
    } catch (err) {
      setStep('error')
      const msg = err instanceof Error ? err.message : 'Stellar transaction failed'
      setErrorMsg(msg)
      // Only unpin when we can prove the transaction was NOT applied on-chain
      // (user rejected signature, dropped, expired, or the contract rejected
      // it).  'unconfirmed' means the network acknowledged the envelope but we
      // lost visibility — the pins may already be valid, so leave them for the
      // reconciliation job (24h grace window) instead of unpinning blindly.
      const submissionError = err instanceof TransactionSubmissionError ? err : null
      if (!submissionError || submissionError.safeToRetry) {
        void ipfsService.unpinLastUpload(wallet.address!).catch(() => {})
      }
      addToast(
        `Metadata pinned at ${uploadResult.metadataUri} but on-chain linking failed: ${msg}`,
        'error',
      )
    }
  }

  const handleReset = () => {
    setStep('idle')
    setTokenAddress(initialTokenAddress)
    setDescription('')
    setImageFile(null)
    setImagePreview(null)
    setUploadProgress(0)
    setFinalUri(null)
    setTxHash(null)
    setErrorMsg(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  if (ipfsReadiness === 'checking') {
    return (
      <div
        className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-500 dark:text-gray-400"
        aria-busy="true"
        role="status"
      >
        Checking upload availability…
      </div>
    )
  }

  if (!ipfsReady) {
    return (
      <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 p-4 text-sm text-yellow-800 dark:text-yellow-300">
        IPFS upload is disabled: this deployment has no pinning credentials. Set{' '}
        <code className="font-mono bg-yellow-100 dark:bg-yellow-900 px-1 rounded">
          PINATA_API_KEY
        </code>{' '}
        and{' '}
        <code className="font-mono bg-yellow-100 dark:bg-yellow-900 px-1 rounded">
          PINATA_API_SECRET
        </code>{' '}
        in the server environment to enable metadata uploads.
      </div>
    )
  }

  // ── Success state ────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 p-4 space-y-2">
          <p className="font-semibold text-green-800 dark:text-green-300">
            ✓ Metadata set successfully!
          </p>
          <p className="text-sm text-green-700 dark:text-green-400 break-all">
            <span className="font-medium">IPFS URI:</span> {finalUri}
          </p>
          {txHash && (
            <ExplorerLink
              type="tx"
              value={txHash}
              network={network}
              label="View transaction on Stellar Expert"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            />
          )}
        </div>
        <Button variant="outline" onClick={handleReset} className="w-full">
          Set metadata for another token
        </Button>
      </div>
    )
  }

  // ── In-progress / error state ────────────────────────────────────────────────
  if (isSubmitting || step === 'error') {
    return (
      <div className="space-y-4">
        <ProgressIndicator steps={progressSteps} />

        {step === 'uploading-ipfs' && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>Uploading…</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
              <ProgressBar
                progress={uploadProgress}
                className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
              />
            </div>
          </div>
        )}

        {step === 'error' && (
          <div className="space-y-3">
            {finalUri && (
              <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 p-3 text-sm text-blue-800 dark:text-blue-300">
                <p className="font-medium">Metadata pinned but not yet linked on-chain.</p>
                <p className="break-all mt-1">IPFS URI: {finalUri}</p>
                <p className="mt-1 text-xs">
                  You can retry the Stellar step or set this URI manually.
                </p>
              </div>
            )}
            {errorMsg && (
              <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 p-3 text-sm text-red-800 dark:text-red-300">
                {errorMsg}
              </div>
            )}
            <Button variant="outline" onClick={handleReset} className="w-full">
              Try again
            </Button>
          </div>
        )}
      </div>
    )
  }

  // ── Idle form ────────────────────────────────────────────────────────────────
  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Token Address (Contract ID)"
          value={tokenAddress}
          onChange={(e) => setTokenAddress(e.target.value)}
          placeholder="C..."
          required
        />

        {/* Image upload */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Token Image{' '}
            <span className="text-gray-400 font-normal">(JPEG, PNG, GIF · max 5 MB)</span>
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif"
            onChange={handleImageChange}
            className="block w-full text-sm text-gray-500 dark:text-gray-400
              file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0
              file:text-sm file:font-semibold
              file:bg-blue-50 file:text-blue-700
              dark:file:bg-blue-900/30 dark:file:text-blue-300
              hover:file:bg-blue-100 dark:hover:file:bg-blue-900/50"
          />
          {imagePreview && (
            <div className="mt-3 flex items-start gap-3">
              <img
                src={imagePreview}
                alt="Token preview"
                className="w-20 h-20 object-contain rounded-md border border-gray-300 dark:border-gray-600 shrink-0"
              />
              <div className="text-sm text-gray-600 dark:text-gray-400 space-y-0.5">
                <p className="font-medium text-gray-800 dark:text-gray-200 break-all">
                  {imageFile?.name}
                </p>
                <p>{imageFile ? (imageFile.size / 1024).toFixed(0) : 0} KB</p>
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs"
                >
                  Remove
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="metadata-description"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Description
          </label>
          <textarea
            id="metadata-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe your token…"
            rows={3}
            maxLength={MAX_METADATA_DESCRIPTION_LENGTH}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md
              focus:outline-none focus:ring-2 focus:ring-blue-500
              dark:bg-gray-700 dark:text-white text-sm resize-none"
          />
        </div>

        {/* Fee preview */}
        <div className="rounded-md bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 px-4 py-3 text-sm flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">Estimated fee</span>
          <span className="font-semibold text-gray-900 dark:text-white">
            {metadataFeeXlm.toFixed(7)} XLM
          </span>
        </div>

        {!hasSufficientBalance && (
          <InsufficientBalanceWarning shortfall={shortfall} isTestnet={isTestnet} />
        )}

        <Button
          type="submit"
          disabled={!imageFile || !tokenAddress.trim() || !hasSufficientBalance || networkBlocked}
          className="w-full"
        >
          Set Metadata
        </Button>

        {networkBlocked && networkReason && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {networkReason}
          </p>
        )}
      </form>

      <ConfirmModal
        isOpen={pendingConfirm}
        title="Confirm Set Metadata"
        description="This will upload your image to IPFS and link the metadata URI on-chain."
        details={[
          { label: 'Token Address', value: tokenAddress },
          { label: 'Image', value: imageFile?.name ?? '' },
          { label: 'Estimated Fee', value: `${metadataFeeXlm.toFixed(7)} XLM` },
        ]}
        onConfirm={handleConfirm}
        onCancel={() => setPendingConfirm(false)}
        confirmLabel="Upload & Set"
      />
    </>
  )
}
