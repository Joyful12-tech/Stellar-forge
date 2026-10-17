interface MissingVar {
  key: string
  description: string
}

interface Props {
  missing: MissingVar[]
}

export function MisconfigurationScreen({ missing }: Props) {
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg max-w-2xl w-full p-8">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl" aria-hidden="true">
            ⚠️
          </span>
          <h1 className="text-xl font-bold text-red-600 dark:text-red-400">
            Configuration Required
          </h1>
        </div>
        <p className="text-gray-700 dark:text-gray-300 mb-6">
          To run this application, configure the required environment variables below. Copy{' '}
          <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded text-sm">.env.example</code> to{' '}
          <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded text-sm">.env</code> in the
          frontend directory.
        </p>
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">
            Missing Variables ({missing.length}):
          </h2>
          <ul className="space-y-3">
            {missing.map((item) => (
              <li
                key={item.key}
                className="flex items-start gap-3 text-sm text-gray-800 dark:text-gray-200 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 p-4 rounded-lg"
              >
                <span className="text-red-500 mt-0.5 font-bold">✗</span>
                <div className="flex-1">
                  <code className="block font-mono font-semibold text-red-600 dark:text-red-400 text-base">
                    {item.key}
                  </code>
                  <span className="text-xs text-gray-600 dark:text-gray-400 mt-1 block leading-relaxed">
                    {item.description}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <a
            href="https://github.com/Stellar-forge/Stellar-forge#environment-variables"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <span>📖</span>
            <span>Setup Instructions</span>
          </a>
          <a
            href="https://github.com/Zarmaijemimah/Stellar-forge/blob/main/frontend/.env.example"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 text-sm text-blue-600 dark:text-blue-400 border border-blue-600 dark:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
          >
            <span>📄</span>
            <span>View .env.example</span>
          </a>
        </div>
      </div>
    </div>
  )
}
