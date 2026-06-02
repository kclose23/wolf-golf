export default function TabBar({ tabs, active, onChange }) {
  return (
    <div className="flex overflow-x-auto border-b border-gray-800 bg-gray-900 sticky top-[53px] z-30 no-scrollbar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex-shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
            ${active === tab.id
              ? 'border-green-400 text-green-400'
              : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
