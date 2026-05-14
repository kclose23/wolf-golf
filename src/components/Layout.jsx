export default function Layout({ children, title, right, onBack, noPad }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
      {title && (
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-40">
          {onBack && (
            <button onClick={onBack} className="text-green-600 font-medium text-sm">
              ← Back
            </button>
          )}
          <h1 className="flex-1 text-base font-semibold text-gray-900">{title}</h1>
          {right && <div>{right}</div>}
        </header>
      )}
      <main className={`flex-1 ${noPad ? '' : 'p-4'} pb-24`}>
        {children}
      </main>
    </div>
  )
}
