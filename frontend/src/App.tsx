import React, { useEffect, useState, useCallback } from 'react'
import {
  ToastContainer,
  WalletButton,
  SkeletonCard,
  SkeletonTokenCard,
  TokenDetailSkeleton,
  OnboardingModal,
} from './components/UI'
import './App.css'
import { useTranslation } from 'react-i18next'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { trackPageView } from './services/analytics'
import { WalletProvider } from './context/WalletContext'
import { ToastProvider } from './context/ToastContext'
import { NetworkProvider } from './context/NetworkContext'
import { StellarProvider } from './context/StellarContext'
import { NetworkSwitcher } from './components/NetworkSwitcher'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { FundbotButton } from './components/FundbotButton'
import { useWallet } from './hooks/useWallet'
import { truncateAddress } from './utils/formatting'
import { NavBar } from './components/NavBar'
import { Home } from './components/Home'
import { CreateToken } from './components/CreateToken'
import { MintForm } from './components/MintForm'
import { BurnForm } from './components/BurnForm'
import { TokenExplorer } from './components/TokenExplorer'
import { AdminPanel } from './components/AdminPanel'
import { MetadataForm } from './components/MetadataForm'
import { NotFound } from './components/NotFound'
import { TransactionHistory } from './components/TransactionHistory'
import { AnalyticsOptOut } from './components/AnalyticsOptOut'
import { NetworkMismatchBanner } from './components/NetworkBadge'
import { WasmHashMismatchBanner } from './components/WasmHashMismatchBanner'
import { FAQ } from './components/FAQ'

const TokenDashboard = React.lazy(() =>
  import('./components/TokenDashboard').then((m) => ({ default: m.TokenDashboard })),
)
const TokenDetail = React.lazy(() =>
  import('./components/TokenDetail').then((m) => ({ default: m.TokenDetail })),
)
const Manage = React.lazy(() => import('./components/Manage').then((m) => ({ default: m.Manage })))
import { useFactoryState } from './hooks/useFactoryState'
import { useTokens } from './hooks/useTokens'
import { isFactoryConfigured } from './config/env'
import ErrorBoundary from './components/ErrorBoundary'
import { TosProvider } from './context/TosContext'
import { ThemeProvider, useTheme } from './context/ThemeContext'
import { STELLAR_CONFIG } from './config/stellar'

const ProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { wallet } = useWallet()
  if (!wallet.isConnected) return <Navigate to="/" replace />
  return children
}

/** Wraps CreateToken so the token-list cache is refreshed (via onSuccess)
 *  after a confirmed on-chain deployment, per the reconciliation policy
 *  documented in useTransaction.ts. */
const CreateTokenWrapper: React.FC = () => {
  const { wallet } = useWallet()
  // Invalidate the per-creator and global token caches so the new token
  // appears on the Dashboard / Explorer without waiting for TTL expiry.
  // Only subscribe to per-creator tokens when a wallet is connected
  // (avoids two useTokens instances sharing the same '' cache key).
  const { refresh: refreshGlobal } = useTokens()
  const { refresh: refreshMy } = useTokens(wallet.address || undefined)

  const handleSuccess = useCallback(() => {
    refreshGlobal()
    refreshMy()
  }, [refreshGlobal, refreshMy])

  return <CreateToken onSuccess={handleSuccess} />
}

interface RouteErrorFallbackProps {
  routeName: string
  resetErrorBoundary?: () => void
}

const RouteErrorFallback: React.FC<RouteErrorFallbackProps> = ({
  routeName,
  resetErrorBoundary,
}) => (
  <div className="min-h-[300px] flex items-center justify-center bg-gray-100 dark:bg-slate-900 p-6 rounded-lg">
    <div className="bg-white dark:bg-slate-800 p-8 rounded-xl shadow-lg text-center max-w-lg w-full">
      <div className="text-red-500 mb-4">
        <svg className="h-12 w-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        {routeName} encountered an error
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        Something went wrong while loading this page. You can try again without affecting the rest
        of the app.
      </p>
      <button
        type="button"
        onClick={resetErrorBoundary}
        className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400 text-white font-medium py-2 px-6 rounded-lg transition-colors"
      >
        Try again
      </button>
    </div>
  </div>
)

const TokenDashboardFallback = () => (
  <div
    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
    aria-busy="true"
    aria-label="Loading tokens"
  >
    {Array.from({ length: 6 }).map((_, i) => (
      <SkeletonTokenCard key={i} />
    ))}
  </div>
)

const RouteBoundary: React.FC<{
  routeName: string
  fallback?: React.ReactNode
  children: React.ReactNode
}> = ({ routeName, fallback, children }) => (
  <ErrorBoundary fallback={<RouteErrorFallback routeName={routeName} />}>
    <React.Suspense fallback={fallback || <SkeletonCard />}>{children}</React.Suspense>
  </ErrorBoundary>
)

function AppContent() {
  const { wallet, error } = useWallet()
  const { t } = useTranslation()
  const [showOnboarding, setShowOnboarding] = useState(false)
  const { state: factoryState } = useFactoryState()
  const location = useLocation()

  const isAdmin = !!wallet.address && !!factoryState?.admin && wallet.address === factoryState.admin

  const { theme, toggleTheme } = useTheme()

  // Track page views on route changes
  useEffect(() => {
    trackPageView(location.pathname)
  }, [location.pathname])

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded"
      >
        {t('app.skipToMain')}
      </a>

      <div className="min-h-screen bg-gray-100 dark:bg-slate-900">
        <header
          className="bg-white/80 shadow-lg backdrop-blur-sm dark:bg-slate-800/95 dark:shadow-slate-900/50 dark:border-b dark:border-slate-700"
          role="banner"
        >
          <div className="max-w-7xl mx-auto py-4 sm:py-6 px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-3 sm:gap-4">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
                <div className="flex-1 min-w-0">
                  <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white truncate">
                    {t('app.title')}
                  </h1>
                  <p className="mt-1 sm:mt-2 text-xs sm:text-sm text-gray-600 dark:text-gray-300">
                    {t('app.subtitle')}
                  </p>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                  <button
                    onClick={toggleTheme}
                    aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                    className="p-2 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                  >
                    {theme === 'dark' ? (
                      <svg
                        className="w-5 h-5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-5 h-5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                        aria-hidden="true"
                      >
                        <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                      </svg>
                    )}
                  </button>
                  <div className="hidden sm:block">
                    <LanguageSwitcher />
                  </div>
                  <div className="hidden sm:block">
                    <NetworkSwitcher />
                  </div>

                  {wallet.isConnected && (
                    <div className="hidden sm:block">
                      <FundbotButton />
                    </div>
                  )}
                  <WalletButton />
                </div>
              </div>

              {/* Mobile-only info row */}
              <div className="flex flex-col gap-2 sm:hidden">
                {wallet.isConnected && wallet.address && (
                  <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                    <span className="truncate flex-1 mr-2" title={wallet.address}>
                      {truncateAddress(wallet.address)}
                    </span>
                    {wallet.balance && (
                      // wallet.balance is Horizon's decimal XLM string, not stroops —
                      // formatXLM would throw (BigInt on a decimal) and crash the app.
                      <span className="shrink-0">{wallet.balance} XLM</span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <LanguageSwitcher />
                  <NetworkSwitcher />
                  {wallet.isConnected && <FundbotButton />}
                </div>
              </div>
            </div>

            <NavBar onHelpClick={() => setShowOnboarding(true)} isAdmin={isAdmin} />
          </div>
        </header>
        {showOnboarding && <OnboardingModal forceOpen onClose={() => setShowOnboarding(false)} />}

        <NetworkMismatchBanner />

        <WasmHashMismatchBanner />

        {!isFactoryConfigured() && (
          <div
            className="bg-yellow-50 dark:bg-yellow-900/30 border-b border-yellow-300 dark:border-yellow-700 p-4"
            role="alert"
          >
            <div className="max-w-7xl mx-auto text-yellow-800 dark:text-yellow-300 text-sm font-medium">
              ⚠️ Factory contract not configured. Please set{' '}
              <code className="font-mono bg-yellow-100 dark:bg-yellow-900 px-1 rounded">
                VITE_FACTORY_CONTRACT_ID
              </code>{' '}
              in your{' '}
              <code className="font-mono bg-yellow-100 dark:bg-yellow-900 px-1 rounded">.env</code>{' '}
              file.
            </div>
          </div>
        )}

        <div id="main-content" className="max-w-7xl mx-auto py-4 sm:py-6 px-4 sm:px-6 lg:px-8">
          {error && (
            <div
              className="mb-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-300 px-3 sm:px-4 py-3 rounded-lg text-sm"
              role="alert"
            >
              <p className="font-medium">{t('errors.title')}</p>
              <p className="text-xs sm:text-sm mt-1">{error}</p>
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-lg shadow-sm">
            <Routes>
              <Route
                path="/"
                element={
                  <RouteBoundary routeName="Home">
                    <Home />
                  </RouteBoundary>
                }
              />
              <Route
                path="/create"
                element={
                  <ProtectedRoute>
                    <RouteBoundary routeName="Create Token">
                      <CreateTokenWrapper />
                    </RouteBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/mint"
                element={
                  <ProtectedRoute>
                    <RouteBoundary routeName="Mint">
                      <MintForm />
                    </RouteBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/burn"
                element={
                  <ProtectedRoute>
                    <RouteBoundary routeName="Burn">
                      <BurnForm />
                    </RouteBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/tokens"
                element={
                  <ProtectedRoute>
                    <RouteBoundary routeName="Tokens" fallback={<TokenDashboardFallback />}>
                      <TokenDashboard />
                    </RouteBoundary>
                  </ProtectedRoute>
                }
              />
              {/* Token detail is public so shared deep links work without a wallet (#880). */}
              <Route
                path="/tokens/:address"
                element={
                  <RouteBoundary routeName="Token Detail" fallback={<TokenDetailSkeleton />}>
                    <TokenDetail />
                  </RouteBoundary>
                }
              />
              <Route
                path="/token/:address"
                element={
                  <RouteBoundary routeName="Token Detail" fallback={<TokenDetailSkeleton />}>
                    <TokenDetail />
                  </RouteBoundary>
                }
              />
              <Route
                path="/explorer"
                element={
                  <RouteBoundary routeName="Explorer">
                    <TokenExplorer />
                  </RouteBoundary>
                }
              />
              <Route
                path="/faq"
                element={
                  <RouteBoundary routeName="FAQ">
                    <FAQ />
                  </RouteBoundary>
                }
              />
              <Route
                path="/metadata"
                element={
                  <ProtectedRoute>
                    <RouteBoundary routeName="Metadata">
                      <div className="max-w-lg mx-auto">
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                          Set Token Metadata
                        </h2>
                        <MetadataForm />
                      </div>
                    </RouteBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute>
                    <RouteBoundary routeName="Admin Panel">
                      <AdminPanel />
                    </RouteBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <RouteBoundary routeName="Dashboard" fallback={<TokenDashboardFallback />}>
                      <TokenDashboard />
                    </RouteBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/manage"
                element={
                  <ProtectedRoute>
                    <RouteBoundary routeName="Manage" fallback={<SkeletonCard />}>
                      <Manage />
                    </RouteBoundary>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/activity"
                element={
                  <ProtectedRoute>
                    <RouteBoundary routeName="Activity">
                      <TransactionHistory publicKey={wallet.address ?? ''} />
                    </RouteBoundary>
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>
        </div>

        <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 mt-4 border-t border-gray-200 dark:border-slate-700 flex flex-col items-center gap-2">
          <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Network: {STELLAR_CONFIG.network} | Contract:{' '}
            {STELLAR_CONFIG.factoryContractId?.slice(0, 8) || 'N/A'}…
            {STELLAR_CONFIG.factoryContractId?.slice(-6) || ''}
          </div>
          <AnalyticsOptOut />
        </footer>

        <ToastContainer />
      </div>
    </>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <NetworkProvider>
            <StellarProvider>
              <WalletProvider>
                <ToastProvider>
                  <TosProvider>
                    <AppContent />
                  </TosProvider>
                </ToastProvider>
              </WalletProvider>
            </StellarProvider>
          </NetworkProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
